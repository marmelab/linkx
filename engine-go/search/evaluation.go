package search

import (
	"math/bits"

	"github.com/marmelab/linkx/engine-go/bitboard"
	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/rules"
)

// Les constantes et leur justification mesurée sont dans engineSearch.ts : ce
// fichier n'en change aucune.
const (
	n     = rules.Size
	cells = rules.Cells

	blocked           = 1 << 24
	axisUnreachable   = n + 1
	primaryAxisWeight = axisUnreachable + 1
	connectionWeight  = 100
	secondaryWeight   = 94
	zoneWeightBase    = 32
	zoneWeightFill    = 96
	pathWidthCap      = 16
	pathWidthWeight   = 79
	// Tempo est l'avantage du trait, calibré contre le biais de parité.
	Tempo = 1133

	threatDistance     = 2
	mobilityCap        = 8
	zoneStallFrom      = 2
	mobilityFrom       = 40
	topRowsUntil       = 40
	bar3Slot           = int(rules.Bar3)
	largeLSlot         = int(rules.LargeL)
	gravityUnreachable = 4 * n * n
)

// Criteria sont les critères d'évaluation à l'essai, chacun avec son poids ; à
// zéro, un critère n'est pas calculé (EvaluationCriteria). `Hanging` et
// `HangingWall` sont des seuils, pas des poids. Les poids sont entiers :
// `Reserve` doit être pair pour rendre la même valeur que le TS, qui en prend
// la moitié.
type Criteria struct {
	Gravity     int
	ZoneCount   int
	Caps        int
	Robust      int
	Mobility    int
	Reserve     int
	Bar3        int
	LargeL      int
	TopRows     int
	Hanging     int
	HangingWall int
	ZoneStall   int
}

// DefaultCriteria sont les critères du maître.
var DefaultCriteria = Criteria{HangingWall: 3, ZoneStall: 57, Caps: 84, Bar3: 1199}

// Weights sont les poids de l'évaluation de base, en points (EvaluationWeights).
type Weights struct {
	Primary   int
	Secondary int
	PathWidth int
	ZoneBase  int
	ZoneFill  int
	Tempo     int
}

// DefaultWeights sont les poids du maître.
var DefaultWeights = Weights{
	Primary:   primaryAxisWeight * connectionWeight,
	Secondary: secondaryWeight,
	PathWidth: pathWidthWeight,
	ZoneBase:  zoneWeightBase,
	ZoneFill:  zoneWeightFill,
	Tempo:     Tempo,
}

// WeightsWithSecondaryAxis exprime le second axe en crans (secondaryAxisWeight).
func WeightsWithSecondaryAxis(notches int) Weights {
	w := DefaultWeights
	w.Secondary = notches * connectionWeight
	return w
}

// columnFrom porte, à l'indice x*(n+1)+from, les cases de la colonne x situées
// à la ligne `from` ou en dessous.
var columnFrom = func() (table [n * (n + 1)]bitboard.Set) {
	for x := range n {
		for from := n - 1; from >= 0; from-- {
			slot := x*(n+1) + from
			table[slot] = table[slot+1]
			cell := from*n + x
			table[slot][bitboard.CellLimb[cell]] |= bitboard.CellBit[cell]
		}
	}
	return table
}()

// Evaluator porte les tampons de l'évaluation. Il n'est pas réentrant.
type Evaluator struct {
	// empty sont les cases vides franchissables du joueur mesuré.
	empty   bitboard.Set
	heavy   bitboard.Set
	terrain bitboard.Terrain

	horizontal, vertical, ret, cut bitboard.Layers

	primary, secondary, width int
	robust                    bool

	gravityDistance [cells]int32
	gravityHeap     [cells * 9]int32
}

func (e *Evaluator) setTerrain(own bitboard.Set) {
	e.terrain = bitboard.Terrain{Costless: own, Stepped: e.empty}
}

func (e *Evaluator) axisDistance(entry, exit bitboard.Set, layers *bitboard.Layers) int {
	if d := e.terrain.Fill(entry, exit, layers); d >= 0 {
		return d
	}
	return blocked
}

// fillMasks pose le terrain de `side` : ses cases sans coût, les cases vides
// encore atteignables à un pas.
func (e *Evaluator) fillMasks(p *board.Position, side, stackBudget int) {
	own := p.Bits[side-1]
	other := p.Bits[board.Other(side)-1]
	var f bitboard.Set
	for i := range bitboard.Limbs {
		f[i] = ^(own[i] | other[i]) & bitboard.LimbMask
	}
	if stackBudget < n-1 {
		var reach bitboard.Set
		for x := range n {
			lowest := max(int(p.Top[x])-1-stackBudget, 0)
			slot := &columnFrom[x*(n+1)+lowest]
			reach[0] |= slot[0]
			reach[1] |= slot[1]
			reach[2] |= slot[2]
		}
		f = f.And(reach)
	}
	e.empty = f
	e.setTerrain(own)
}

// axisWidth compte les cases vides situées sur au moins un plus court chemin.
func (e *Evaluator) axisWidth(near *bitboard.Layers, exit, entry bitboard.Set, best int, weighted bool) int {
	if best >= blocked {
		return 0
	}
	if weighted {
		e.terrain.FillWeighted(exit, entry, &e.ret, e.heavy)
	} else {
		e.terrain.Fill(exit, entry, &e.ret)
	}
	width := 0
	for depth := 1; depth <= best; depth++ {
		here, back := &near[depth], &e.ret[best+1-depth]
		width += bits.OnesCount32(here[0]&back[0]&e.empty[0]) +
			bits.OnesCount32(here[1]&back[1]&e.empty[1]) +
			bits.OnesCount32(here[2]&back[2]&e.empty[2])
	}
	return width
}

// suspendedMask marque les cases vides ayant `k` cases vides ou plus sous elles.
func (e *Evaluator) suspendedMask(p *board.Position, k int) {
	var low bitboard.Set
	for x := range n {
		slot := &columnFrom[x*(n+1)+max(int(p.Top[x])-k, 0)]
		low[0] |= slot[0]
		low[1] |= slot[1]
		low[2] |= slot[2]
	}
	for i := range bitboard.Limbs {
		e.heavy[i] = e.empty[i] &^ low[i]
	}
}

func (e *Evaluator) suspendedVertical(p *board.Position, side, hanging, hangingWall int) int {
	if hangingWall > 0 {
		e.suspendedMask(p, hangingWall)
		for i := range bitboard.Limbs {
			e.empty[i] &^= e.heavy[i]
		}
		e.setTerrain(p.Bits[side-1])
	}
	if hanging > 0 {
		e.suspendedMask(p, hanging)
		if d := e.terrain.FillWeighted(bitboard.EdgeTop, bitboard.EdgeBottom, &e.vertical, e.heavy); d >= 0 {
			return d
		}
		return blocked
	}
	e.heavy = bitboard.Set{}
	return e.axisDistance(bitboard.EdgeTop, bitboard.EdgeBottom, &e.vertical)
}

func finiteAxis(value int) int { return min(value, axisUnreachable) }

// threatSurvivesOneCut dit si la menace de l'axe dominant survit à la perte de
// n'importe laquelle de ses cases vides. `ret` doit tenir le retour de cet axe.
func (e *Evaluator) threatSurvivesOneCut(own bitboard.Set, near *bitboard.Layers, entry, exit bitboard.Set, best int) bool {
	var cuts bitboard.Set
	for depth := 1; depth <= best; depth++ {
		here, back := &near[depth], &e.ret[best+1-depth]
		for i := range bitboard.Limbs {
			cuts[i] |= here[i] & back[i] & e.empty[i]
		}
	}
	survives := true
	for limb := 0; limb < bitboard.Limbs && survives; limb++ {
		rest := cuts[limb]
		for rest != 0 {
			bit := rest & -rest
			rest ^= bit
			stepped := e.empty
			stepped[limb] &^= bit
			e.terrain = bitboard.Terrain{Costless: own, Stepped: stepped}
			if d := e.terrain.Fill(entry, exit, &e.cut); d < 0 || d > threatDistance {
				survives = false
				break
			}
		}
	}
	e.setTerrain(own)
	return survives
}

// measurePlayer mesure le potentiel de connexion de `side` — bas vaut mieux —
// et la largeur de son axe dominant.
func (e *Evaluator) measurePlayer(p *board.Position, side, ownBudget, stackBudget int, robust bool, hanging, hangingWall int) {
	e.fillMasks(p, side, stackBudget)
	own := p.Bits[side-1]

	horizontal := e.axisDistance(bitboard.EdgeLeft, bitboard.EdgeRight, &e.horizontal)
	suspended := hanging > 0 || hangingWall > 0
	full := e.empty
	var vertical int
	if suspended {
		vertical = e.suspendedVertical(p, side, hanging, hangingWall)
	} else {
		vertical = e.axisDistance(bitboard.EdgeTop, bitboard.EdgeBottom, &e.vertical)
	}

	reachable := func(distance int) int {
		if distance > ownBudget {
			return blocked
		}
		return distance
	}
	horizontalReach, verticalReach := reachable(horizontal), reachable(vertical)
	horizontalLeads := horizontalReach <= verticalReach
	if horizontalLeads {
		e.primary, e.secondary = finiteAxis(horizontalReach), finiteAxis(verticalReach)
	} else {
		e.primary, e.secondary = finiteAxis(verticalReach), finiteAxis(horizontalReach)
	}
	if suspended && horizontalLeads {
		e.empty = full
		e.setTerrain(own)
	}
	if horizontalLeads {
		e.width = e.axisWidth(&e.horizontal, bitboard.EdgeRight, bitboard.EdgeLeft, horizontal, false)
	} else {
		e.width = e.axisWidth(&e.vertical, bitboard.EdgeBottom, bitboard.EdgeTop, vertical, hanging > 0)
	}
	e.width = min(e.width, pathWidthCap)
	e.robust = false
	if robust && e.primary <= threatDistance {
		e.robust = e.secondary <= threatDistance
		if !e.robust {
			if horizontalLeads {
				e.robust = e.threatSurvivesOneCut(own, &e.horizontal, bitboard.EdgeLeft, bitboard.EdgeRight, e.primary)
			} else {
				e.robust = e.threatSurvivesOneCut(own, &e.vertical, bitboard.EdgeTop, bitboard.EdgeBottom, e.primary)
			}
		}
	}
}

// gravityAxis est la distance de connexion d'un axe où une case vide coûte, en
// demi-cases, deux plus le nombre de cases vides sous elle (Dijkstra sur tas).
func (e *Evaluator) gravityAxis(p *board.Position, side int, vertical bool) int {
	cost := func(cell int) int {
		occupant := int(p.Board[cell])
		if occupant == side {
			return 0
		}
		if occupant != board.Empty {
			return -1
		}
		return 2 + int(p.Top[cell%n]) - 1 - cell/n
	}
	distance := &e.gravityDistance
	for i := range distance {
		distance[i] = gravityUnreachable
	}
	heap := &e.gravityHeap
	size := 0
	push := func(d, cell int) {
		i := size
		size++
		key := int32(d*128 + cell)
		for i > 0 {
			parent := (i - 1) >> 1
			if heap[parent] <= key {
				break
			}
			heap[i] = heap[parent]
			i = parent
		}
		heap[i] = key
	}
	pop := func() int32 {
		head := heap[0]
		size--
		last := heap[size]
		i := 0
		for {
			child := 2*i + 1
			if child >= size {
				break
			}
			if child+1 < size && heap[child+1] < heap[child] {
				child++
			}
			if heap[child] >= last {
				break
			}
			heap[i] = heap[child]
			i = child
		}
		heap[i] = last
		return head
	}
	for k := range n {
		cell := k * n
		if vertical {
			cell = k
		}
		if c := cost(cell); c >= 0 {
			distance[cell] = int32(c)
			push(c, cell)
		}
	}
	for size > 0 {
		key := pop()
		cell := int(key & 127)
		d := int(key >> 7)
		if int32(d) > distance[cell] {
			continue
		}
		x, y := cell%n, cell/n
		if (vertical && y == n-1) || (!vertical && x == n-1) {
			return d
		}
		for dy := -1; dy <= 1; dy++ {
			ny := y + dy
			if ny < 0 || ny >= n {
				continue
			}
			for dx := -1; dx <= 1; dx++ {
				nx := x + dx
				if (dx == 0 && dy == 0) || nx < 0 || nx >= n {
					continue
				}
				next := ny*n + nx
				c := cost(next)
				if c < 0 || int32(d+c) >= distance[next] {
					continue
				}
				distance[next] = int32(d + c)
				push(d+c, next)
			}
		}
	}
	return gravityUnreachable
}

func (e *Evaluator) gravityReach(p *board.Position, side int) int {
	return min(e.gravityAxis(p, side, false), e.gravityAxis(p, side, true))
}

// capBalance compte les cases de `side` posées sur une case adverse, moins l'inverse.
func capBalance(p *board.Position, side int) int {
	own, other := p.Bits[side-1], p.Bits[board.Other(side)-1]
	return own.And(other.Above()).Count() - other.And(own.Above()).Count()
}

func (e *Evaluator) criteriaValue(p *board.Position, c *Criteria) int {
	side := p.Side
	opponent := board.Other(side)
	value := 0
	if c.Gravity != 0 {
		value += (e.gravityReach(p, opponent) - e.gravityReach(p, side)) * c.Gravity
	}
	if c.ZoneCount != 0 {
		value += (p.ZoneCount(opponent) - p.ZoneCount(side)) * c.ZoneCount
	}
	if c.Caps != 0 {
		value += capBalance(p, side) * c.Caps
	}
	filled := p.FilledCells()
	if c.Mobility != 0 && filled >= mobilityFrom {
		value += (p.CountMoves(side, mobilityCap) - p.CountMoves(opponent, mobilityCap)) * c.Mobility
	}
	bar3 := c.Reserve + c.Bar3
	largeL := c.LargeL - c.Reserve/2
	if bar3 != 0 || largeL != 0 {
		mine, theirs := (side-1)*7, (opponent-1)*7
		value += int(p.Inventory[mine+bar3Slot]-p.Inventory[theirs+bar3Slot])*bar3 +
			int(p.Inventory[mine+largeLSlot]-p.Inventory[theirs+largeLSlot])*largeL
	}
	if c.TopRows != 0 && filled < topRowsUntil {
		// Le premier mot du plateau de bits porte exactement les lignes 0 à 2.
		value -= (bits.OnesCount32(p.Bits[side-1][0]) - bits.OnesCount32(p.Bits[opponent-1][0])) * c.TopRows
	}
	return value
}

// roundRatio rend Math.round(num / den) pour den > 0.
func roundRatio(num, den int) int {
	twice := 2*num + den
	q := twice / (2 * den)
	if twice%(2*den) != 0 && twice < 0 {
		q--
	}
	return q
}

// Evaluate est l'évaluation statique du maître, du point de vue du joueur au trait.
func (e *Evaluator) Evaluate(p *board.Position) int {
	return e.EvaluateWith(p, &DefaultCriteria, &DefaultWeights)
}

// EvaluateWith évalue avec d'autres critères ou poids, pour les mesures.
func (e *Evaluator) EvaluateWith(p *board.Position, c *Criteria, w *Weights) int {
	side := p.Side
	opponent := board.Other(side)
	stackBudget := p.TotalRemainingCells()
	robust := c.Robust != 0

	e.measurePlayer(p, side, p.RemainingCells(side), stackBudget, robust, c.Hanging, c.HangingWall)
	myPrimary, mySecondary, myWidth, myRobust := e.primary, e.secondary, e.width, e.robust

	e.measurePlayer(p, opponent, p.RemainingCells(opponent), stackBudget, robust, c.Hanging, c.HangingWall)
	width := myWidth - e.width
	threats := 0
	if robust {
		threats = (boolToInt(myRobust) - boolToInt(e.robust)) * c.Robust
	}

	stall := min(myPrimary, e.primary) - zoneStallFrom
	zoneWeight := w.ZoneBase + roundRatio(w.ZoneFill*p.FilledCells(), cells)
	if c.ZoneStall != 0 && stall > 0 {
		zoneWeight += c.ZoneStall * stall
	}
	zone := p.LargestZone(side) - p.LargestZone(opponent)

	return (e.primary-myPrimary)*w.Primary +
		(e.secondary-mySecondary)*w.Secondary +
		width*w.PathWidth +
		zone*zoneWeight +
		e.criteriaValue(p, c) +
		threats +
		w.Tempo
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

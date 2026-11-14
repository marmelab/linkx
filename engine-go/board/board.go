// Package board porte engineBoard.ts : la position compacte du maître, ses
// coups empaquetés sur 14 bits, la pose et son annulation, le Zobrist
// incrémental, les zones et le verdict de victoire.
//
// Comme en TS, il ne redéfinit aucune règle : une colonne n'a jamais de trou,
// et un coup est légal exactement quand top[x] - maxDy[dx] vaut la même chose
// sur toutes les colonnes qu'il occupe.
package board

import (
	"github.com/marmelab/linkx/engine-go/bitboard"
	"github.com/marmelab/linkx/engine-go/rules"
)

const (
	n     = rules.Size
	cells = rules.Cells

	Empty = 0
	Blue  = int(rules.Blue)
	White = int(rules.White)

	// MaxMoves borne le nombre de coups légaux d'une position (95 au plus).
	MaxMoves = 128
	// MoveMask couvre un coup : orientation (3) | forme (3) | colonne (4) | ligne (4).
	MoveMask = 0x3fff
)

// Other rend l'adversaire de `side`.
func Other(side int) int {
	if side == Blue {
		return White
	}
	return Blue
}

// Move est un coup empaqueté ; il sert aussi d'index d'historique.
type Move uint16

func (m Move) orientation() int { return int(m & 7) }
func (m Move) shape() int       { return int(m>>3) & 7 }
func (m Move) column() int      { return int(m>>6) & 15 }
func (m Move) anchorY() int     { return int(m>>10) & 15 }

// EncodeMove empaquette un coup.
func EncodeMove(orientation, shape, column, anchorY int) Move {
	return Move(orientation | shape<<3 | column<<6 | anchorY<<10)
}

type orientation struct {
	source    *rules.Orientation
	dx, dy    [4]int8
	cellCount int
	width     int
	colDx     [4]int8
	colMaxDy  [4]int8
	colCount  int
}

var orientations = func() [rules.ShapeCount][]orientation {
	var all [rules.ShapeCount][]orientation
	for shape := rules.Shape(0); shape < rules.ShapeCount; shape++ {
		unique := rules.UniqueOrientations(shape)
		for i := range unique {
			o := &unique[i]
			entry := orientation{source: o, cellCount: len(o.Cells), width: o.Width}
			lowest := [n]int{}
			for c := range lowest {
				lowest[c] = -1
			}
			for k, p := range o.Cells {
				entry.dx[k] = int8(p.X)
				entry.dy[k] = int8(p.Y)
				lowest[p.X] = max(lowest[p.X], p.Y)
			}
			for column, dy := range lowest {
				if dy >= 0 {
					entry.colDx[entry.colCount] = int8(column)
					entry.colMaxDy[entry.colCount] = int8(dy)
					entry.colCount++
				}
			}
			all[shape] = append(all[shape], entry)
		}
	}
	return all
}()

var shapeCellCount = func() (counts [rules.ShapeCount]int) {
	for shape := range counts {
		counts[shape] = orientations[shape][0].cellCount
	}
	return counts
}()

// ToLegalMove retraduit un coup compact vers le domaine.
func ToLegalMove(m Move) rules.LegalMove {
	entry := &orientations[m.shape()][m.orientation()]
	column, anchorY := m.column(), m.anchorY()
	moveCells := make([]rules.Point, len(entry.source.Cells))
	for i, p := range entry.source.Cells {
		moveCells[i] = rules.Point{X: p.X + column, Y: p.Y + anchorY}
	}
	return rules.LegalMove{
		Shape:       rules.Shape(m.shape()),
		Orientation: entry.source,
		Column:      column,
		Cells:       moveCells,
	}
}

// --- Zobrist ------------------------------------------------------------------
// Clés tirées du même générateur congruentiel et de la même graine qu'en TS :
// les hachages, donc les collisions de la table, sont identiques.

var (
	zCellA, zCellB           [cells * 3]uint32
	zInventoryA, zInventoryB [14 * 3]uint32
	zTurnA, zTurnB           uint32
)

func init() {
	state := uint32(0x15_ba_d1_7e)
	next := func() uint32 {
		state = state*1_664_525 + 1_013_904_223
		return state
	}
	for i := range zCellA {
		zCellA[i] = next()
		zCellB[i] = next()
	}
	for i := range zInventoryA {
		zInventoryA[i] = next()
		zInventoryB[i] = next()
	}
	zTurnA = next()
	zTurnB = next()
}

// Position est la position compacte : cases, hauteur de chaque colonne, cases
// de chaque joueur en plateau de bits, réserves, trait et hachage.
type Position struct {
	Board [cells]int8
	// Top est la ligne de la case occupée la plus haute de chaque colonne, 9 si vide.
	Top [n]int8
	// Bits porte les cases de chaque joueur, indexées side-1.
	Bits [2]bitboard.Set
	// Inventory compte les exemplaires restants, indexés (side-1)*7 + forme.
	Inventory    [14]int8
	Side         int
	HashA, HashB uint32
}

func (p *Position) rehash() {
	var hashA, hashB uint32
	if p.Side != Blue {
		hashA, hashB = zTurnA, zTurnB
	}
	for cell, occupant := range p.Board {
		if occupant != Empty {
			hashA ^= zCellA[cell*3+int(occupant)]
			hashB ^= zCellB[cell*3+int(occupant)]
		}
	}
	for slot, count := range p.Inventory {
		hashA ^= zInventoryA[slot*3+int(count)]
		hashB ^= zInventoryB[slot*3+int(count)]
	}
	p.HashA, p.HashB = hashA, hashB
}

// Load recopie une position du domaine.
func (p *Position) Load(source *rules.Position) {
	*p = Position{}
	for x := range p.Top {
		p.Top[x] = n
	}
	for y := range n {
		for x := range n {
			player := source.Board[y][x]
			if player == rules.None {
				continue
			}
			index := y*n + x
			p.Board[index] = int8(player)
			p.Bits[player-1][bitboard.CellLimb[index]] |= bitboard.CellBit[index]
			if int8(y) < p.Top[x] {
				p.Top[x] = int8(y)
			}
		}
	}
	for _, player := range []rules.Player{rules.Blue, rules.White} {
		for shape := range rules.ShapeCount {
			p.Inventory[int(player-1)*7+shape] = int8(source.Inventories[player][shape])
		}
	}
	p.Side = int(source.Active)
	p.rehash()
}

// RemainingPlies majore les demi-coups restants : une pose consomme une pièce.
func (p *Position) RemainingPlies() int {
	total := 0
	for _, count := range p.Inventory {
		total += int(count)
	}
	return total
}

// FilledCells rend le nombre de cases occupées.
func (p *Position) FilledCells() int {
	filled := 0
	for _, top := range p.Top {
		filled += n - int(top)
	}
	return filled
}

// RemainingCells rend les cases que `side` peut encore poser.
func (p *Position) RemainingCells(side int) int {
	base := (side - 1) * 7
	total := 0
	for shape, cellCount := range shapeCellCount {
		total += int(p.Inventory[base+shape]) * cellCount
	}
	return total
}

// TotalRemainingCells rend les cases que les deux joueurs peuvent encore poser.
func (p *Position) TotalRemainingCells() int {
	return p.RemainingCells(Blue) + p.RemainingCells(White)
}

// GenerateMoves écrit les coups légaux du joueur au trait dans `out`, dans
// l'ordre du moteur TS, et rend leur nombre.
func (p *Position) GenerateMoves(out []Move) int {
	base := (p.Side - 1) * 7
	count := 0
	for shape := range rules.ShapeCount {
		if p.Inventory[base+shape] == 0 {
			continue
		}
		entries := orientations[shape]
		for index := range entries {
			entry := &entries[index]
			for column := 0; column <= n-entry.width; column++ {
				if anchorY, ok := p.fits(entry, column); ok {
					out[count] = EncodeMove(index, shape, column, anchorY)
					count++
				}
			}
		}
	}
	return count
}

func (p *Position) fits(entry *orientation, column int) (int, bool) {
	anchorY := int(p.Top[column+int(entry.colDx[0])]) - 1 - int(entry.colMaxDy[0])
	if anchorY < 0 {
		return 0, false
	}
	for c := 1; c < entry.colCount; c++ {
		if int(p.Top[column+int(entry.colDx[c])])-1-int(entry.colMaxDy[c]) != anchorY {
			return 0, false
		}
	}
	return anchorY, true
}

// CountMoves compte les coups légaux de `side`, jusqu'à `limit` au plus.
func (p *Position) CountMoves(side, limit int) int {
	base := (side - 1) * 7
	count := 0
	for shape := range rules.ShapeCount {
		if p.Inventory[base+shape] == 0 {
			continue
		}
		entries := orientations[shape]
		for index := range entries {
			entry := &entries[index]
			for column := 0; column <= n-entry.width; column++ {
				if _, ok := p.fits(entry, column); ok {
					count++
					if count >= limit {
						return count
					}
				}
			}
		}
	}
	return count
}

// HasAnyMove dit si `side` dispose d'au moins un coup légal.
func (p *Position) HasAnyMove(side int) bool { return p.CountMoves(side, 1) > 0 }

// FlipSide passe le trait.
func (p *Position) FlipSide() {
	p.Side = Other(p.Side)
	p.HashA ^= zTurnA
	p.HashB ^= zTurnB
}

func (p *Position) setInventory(slot int, delta int8) {
	p.HashA ^= zInventoryA[slot*3+int(p.Inventory[slot])]
	p.HashB ^= zInventoryB[slot*3+int(p.Inventory[slot])]
	p.Inventory[slot] += delta
	p.HashA ^= zInventoryA[slot*3+int(p.Inventory[slot])]
	p.HashB ^= zInventoryB[slot*3+int(p.Inventory[slot])]
}

// Apply pose le coup pour le joueur au trait, puis passe le trait.
func (p *Position) Apply(m Move) {
	side := p.Side
	shape := m.shape()
	entry := &orientations[shape][m.orientation()]
	column, anchorY := m.column(), m.anchorY()
	bits := &p.Bits[side-1]
	for i := range entry.cellCount {
		x := column + int(entry.dx[i])
		y := anchorY + int(entry.dy[i])
		cell := y*n + x
		p.Board[cell] = int8(side)
		bits[bitboard.CellLimb[cell]] |= bitboard.CellBit[cell]
		p.HashA ^= zCellA[cell*3+side]
		p.HashB ^= zCellB[cell*3+side]
		if int8(y) < p.Top[x] {
			p.Top[x] = int8(y)
		}
	}
	p.setInventory((side-1)*7+shape, -1)
	p.FlipSide()
}

// Undo annule Apply, trait compris.
func (p *Position) Undo(m Move) {
	p.FlipSide()
	side := p.Side
	shape := m.shape()
	entry := &orientations[shape][m.orientation()]
	column, anchorY := m.column(), m.anchorY()
	bits := &p.Bits[side-1]
	for i := range entry.cellCount {
		cell := (anchorY+int(entry.dy[i]))*n + column + int(entry.dx[i])
		p.Board[cell] = Empty
		bits[bitboard.CellLimb[cell]] &^= bitboard.CellBit[cell]
		p.HashA ^= zCellA[cell*3+side]
		p.HashB ^= zCellB[cell*3+side]
	}
	for c := range entry.colCount {
		p.Top[column+int(entry.colDx[c])] = int8(anchorY + int(entry.colMaxDy[c]) + 1)
	}
	p.setInventory((side-1)*7+shape, 1)
}

func touches(zone, edge bitboard.Set) bool {
	return zone[0]&edge[0]|zone[1]&edge[1]|zone[2]&edge[2] != 0
}

func connects(zone bitboard.Set) bool {
	return (touches(zone, bitboard.EdgeLeft) && touches(zone, bitboard.EdgeRight)) ||
		(touches(zone, bitboard.EdgeTop) && touches(zone, bitboard.EdgeBottom))
}

// MovePlacedWins dit si le coup que `side` vient de poser lui donne la victoire.
func (p *Position) MovePlacedWins(m Move, side int) bool {
	entry := &orientations[m.shape()][m.orientation()]
	column, anchorY := m.column(), m.anchorY()
	var seed bitboard.Set
	for i := range entry.cellCount {
		cell := (anchorY+int(entry.dy[i]))*n + column + int(entry.dx[i])
		seed[bitboard.CellLimb[cell]] |= bitboard.CellBit[cell]
	}
	return connects(bitboard.Flood(seed, p.Bits[side-1]))
}

// lowestBit rend la case allumée la plus basse d'un ensemble non vide.
func lowestBit(rest bitboard.Set) bitboard.Set {
	switch {
	case rest[0] != 0:
		return bitboard.Set{rest[0] & -rest[0], 0, 0}
	case rest[1] != 0:
		return bitboard.Set{0, rest[1] & -rest[1], 0}
	}
	return bitboard.Set{0, 0, rest[2] & -rest[2]}
}

// LargestZone rend la taille de la plus grande zone de `side`.
func (p *Position) LargestZone(side int) int {
	own := p.Bits[side-1]
	rest := own
	largest := 0
	// Une zone ne peut pas dépasser ce qui reste à inonder.
	for rest.Count() > largest {
		zone := bitboard.Flood(lowestBit(rest), own)
		largest = max(largest, zone.Count())
		rest = bitboard.Set{rest[0] &^ zone[0], rest[1] &^ zone[1], rest[2] &^ zone[2]}
	}
	return largest
}

// ZoneCount rend le nombre de zones distinctes de `side`.
func (p *Position) ZoneCount(side int) int {
	own := p.Bits[side-1]
	rest := own
	count := 0
	for !rest.Empty() {
		zone := bitboard.Flood(lowestBit(rest), own)
		count++
		rest = bitboard.Set{rest[0] &^ zone[0], rest[1] &^ zone[1], rest[2] &^ zone[2]}
	}
	return count
}

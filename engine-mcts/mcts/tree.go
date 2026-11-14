package mcts

import (
	"cmp"
	"math"
	"slices"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

// Issue d'une position prouvée : le vainqueur (board.Blue, board.White) ou
// Draw ; Unknown tant qu'elle n'est pas prouvée.
const (
	Unknown = 0
	Draw    = 3
)

const (
	noChild  = -1
	maxDepth = 64
	// Les arcs vivent par blocs fixes : l'arène croît sans jamais recopier,
	// donc sans pause pendant le budget. Les arcs d'un nœud tiennent dans un bloc.
	blockBits = 16
	blockSize = 1 << blockBits
)

// edge est un coup d'un nœud développé. value cumule les résultats du point
// de vue du joueur qui le joue.
type edge struct {
	value  float64
	prior  float32
	visits int32
	child  int32
	move   board.Move
	proof  int8
}

// node est une position. value cumule les résultats du point de vue du joueur
// au trait ; first vaut noChild tant que le nœud n'est pas développé.
type node struct {
	value      float64
	visits     int32
	first      int32
	count      int16
	proven     int16
	side       int8
	proof      int8
	solveTried bool
}

// tree est l'arbre d'un fil : arènes de nœuds et d'arcs, indices plutôt que
// pointeurs, réutilisées d'une recherche à l'autre.
type tree struct {
	params   Params
	nodes    []node
	blocks   [][]edge
	used     int32
	eval     search.Evaluator
	solver   *search.Searcher
	random   func() float64
	noise    float64
	moves    [board.MaxMoves]board.Move
	scratch  [board.MaxMoves]board.Move
	logits   [board.MaxMoves]float64
	path     [maxDepth]int32
	owners   [maxDepth]int32
	rootPos  board.Position
	position board.Position
	solves   int
}

func newTree() *tree {
	return &tree{
		nodes:  make([]node, 0, 1<<18),
		solver: search.NewSearcher(),
	}
}

func (t *tree) reset(root *board.Position, params Params, random func() float64, noise float64) {
	t.params = params
	t.nodes = t.nodes[:0]
	t.used = 0
	t.random = random
	t.noise = noise
	t.rootPos = *root
	t.solves = 0
	t.nodes = append(t.nodes, node{first: noChild, side: int8(root.Side)})
}

func other(side int8) int8 { return int8(board.Other(int(side))) }

// result rend la valeur d'une issue pour `side` : 1, ½ ou 0.
func result(proof, side int8) float64 {
	switch proof {
	case side:
		return 1
	case Draw:
		return 0.5
	}
	return 0
}

func (t *tree) edge(index int32) *edge {
	return &t.blocks[index>>blockBits][index&(blockSize-1)]
}

// edgesOf rend les arcs d'un nœud développé.
func (t *tree) edgesOf(n *node) []edge {
	return t.blocks[n.first>>blockBits][n.first&(blockSize-1) : n.first&(blockSize-1)+int32(n.count)]
}

// allocate réserve `count` arcs contigus, au plus board.MaxMoves, et rend
// l'indice du premier.
func (t *tree) allocate(count int) int32 {
	if int(t.used&(blockSize-1))+count > blockSize {
		t.used = (t.used>>blockBits + 1) << blockBits
	}
	if int(t.used>>blockBits) == len(t.blocks) {
		t.blocks = append(t.blocks, make([]edge, blockSize))
	}
	first := t.used
	t.used += int32(count)
	return first
}

// proveEdge inscrit l'issue d'un arc et en déduit, s'il le faut, celle du nœud.
func (t *tree) proveEdge(owner int32, index int32, proof int8) {
	e := t.edge(index)
	if e.proof != Unknown || proof == Unknown {
		return
	}
	e.proof = proof
	n := &t.nodes[owner]
	n.proven++
	if n.proof != Unknown {
		return
	}
	if proof == n.side {
		n.proof = n.side
		return
	}
	if int(n.proven) < int(n.count) {
		return
	}
	n.proof = other(n.side)
	for _, sibling := range t.edgesOf(n) {
		if sibling.proof == Draw {
			n.proof = Draw
		}
	}
}

// solve résout la position par l'alpha-bêta du maître, plafonné à `nodes`.
func (t *tree) solve(p *board.Position, nodes int64) (proof int8, result *search.Result) {
	t.solves++
	source := toRules(p)
	result = t.solver.TopMoves(&source, search.Options{MaxNodes: nodes})
	if result == nil || !result.Exact {
		return Unknown, result
	}
	switch {
	case result.Score > search.MateThreshold:
		return int8(p.Side), result
	case result.Score < -search.MateThreshold:
		return other(int8(p.Side)), result
	case result.Score == 0:
		// Une valeur exacte non décisive n'est sûre qu'à zéro : ailleurs, une
		// passe a pu faire évaluer une feuille avant la fin de la partie.
		return Draw, result
	}
	return Unknown, result
}

func toRules(p *board.Position) rules.Position {
	var source rules.Position
	for cell, occupant := range p.Board {
		source.Board[cell/size][cell%size] = rules.Player(occupant)
	}
	for _, player := range []rules.Player{rules.Blue, rules.White} {
		for shape := range rules.ShapeCount {
			source.Inventories[player][shape] = int(p.Inventory[int(player-1)*7+shape])
		}
	}
	source.Active = rules.Player(p.Side)
	return source
}

// expand développe le nœud : coups, prior, victoire immédiate, coups qui
// laissent une victoire immédiate à l'adversaire, résolution exacte en fin de
// partie. Rend vrai si le nœud est prouvé.
func (t *tree) expand(index int32, p *board.Position) bool {
	params := &t.params
	count := p.GenerateMoves(t.moves[:])
	zones := zonesOf(p.Bits[p.Side-1])
	winner := -1
	high := math.Inf(-1)
	for i, m := range t.moves[:count] {
		own, theirs := contacts(p, m)
		logit := params.SizeWeight*float64(moveShapes[m].size) +
			params.OwnWeight*float64(own) + params.OtherWeight*float64(theirs)
		if winner < 0 && zones.wins(m) {
			winner = i
		}
		if t.noise > 0 {
			logit += t.noise * (2*t.random() - 1)
		}
		logit /= params.Temperature
		t.logits[i] = logit
		high = max(high, logit)
	}
	total := 0.0
	for i := range count {
		t.logits[i] = math.Exp(t.logits[i] - high)
		total += t.logits[i]
	}
	first := t.allocate(count)
	n := &t.nodes[index]
	n.first, n.count = first, int16(count)
	block := t.edgesOf(n)
	for i, m := range t.moves[:count] {
		block[i] = edge{move: m, prior: float32(t.logits[i] / total), child: noChild}
	}
	slices.SortStableFunc(block, func(a, b edge) int { return cmp.Compare(b.prior, a.prior) })

	side := int8(p.Side)
	if winner >= 0 {
		for i := range block {
			if block[i].move == t.moves[winner] {
				t.proveEdge(index, first+int32(i), side)
				break
			}
		}
		return true
	}

	if opponentThreatens(p, t.scratch[:]) {
		for i := range block {
			q := *p
			q.Apply(block[i].move)
			if finished, w := outcome(&q, block[i].move, int(side)); finished {
				t.proveEdge(index, first+int32(i), int8(w))
			} else if q.Side != int(side) && hasImmediateWin(&q, t.scratch[:]) {
				t.proveEdge(index, first+int32(i), other(side))
			}
		}
		if t.nodes[index].proof != Unknown {
			return true
		}
	}

	if p.RemainingPlies() <= params.SolvePlies {
		t.nodes[index].solveTried = true
		if proof, _ := t.solve(p, params.SolveNodes); proof != Unknown {
			t.nodes[index].proof = proof
			return true
		}
	}
	return false
}

// widen rend le nombre de coups ouverts d'un nœud visité `visits` fois.
func (t *tree) widen(visits int32) int {
	return int(math.Ceil(t.params.WidenA * math.Pow(float64(visits)+1, t.params.WidenB)))
}

// selectEdge choisit l'arc PUCT parmi les coups ouverts, en sautant les coups
// prouvés perdants.
func (t *tree) selectEdge(index int32) int32 {
	n := &t.nodes[index]
	open := t.widen(n.visits)
	parentQ := 0.5
	if n.visits > 0 {
		parentQ = n.value / float64(n.visits)
	}
	fpu := parentQ - t.params.FPU
	exploration := t.params.C * math.Sqrt(float64(max(n.visits, 1)))
	loss := other(n.side)
	best, bestScore := int32(-1), math.Inf(-1)
	considered := 0
	for i := n.first; i < n.first+int32(n.count) && considered < open; i++ {
		e := t.edge(i)
		if e.proof == loss {
			continue
		}
		considered++
		q := fpu
		switch {
		case e.proof != Unknown:
			q = result(e.proof, n.side)
		case e.visits > 0:
			q = e.value / float64(e.visits)
		}
		score := q + exploration*float64(e.prior)/float64(1+e.visits)
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	return best
}

// createChild ajoute le nœud qui suit l'arc ; la position a déjà reçu le coup.
func (t *tree) createChild(owner, index int32, p *board.Position, mover int8) {
	child := int32(len(t.nodes))
	t.edge(index).child = child
	finished, winner := outcome(p, t.edge(index).move, int(mover))
	t.nodes = append(t.nodes, node{first: noChild, side: int8(p.Side)})
	if finished {
		t.nodes[child].proof = int8(winner)
		t.proveEdge(owner, index, int8(winner))
	}
}

func sigmoid(x float64) float64 { return 1 / (1 + math.Exp(-x)) }

// iterate descend l'arbre, développe une feuille, l'évalue et remonte sa
// valeur, puis les preuves.
func (t *tree) iterate() {
	p := &t.position
	*p = t.rootPos
	current := int32(0)
	depth := 0
	leaf := true
	var blue float64
	for {
		n := &t.nodes[current]
		if n.proof != Unknown {
			blue = result(n.proof, blue8)
			break
		}
		if n.first == noChild {
			if t.expand(current, p) {
				blue = result(t.nodes[current].proof, blue8)
				break
			}
			v := sigmoid(float64(t.eval.Evaluate(p)) / t.params.K)
			if p.Side != board.Blue {
				v = 1 - v
			}
			blue = v
			break
		}
		if t.params.SolveVisits > 0 && n.visits >= t.params.SolveVisits && !n.solveTried {
			n.solveTried = true
			if proof, _ := t.solve(p, t.params.SolveNodes); proof != Unknown {
				t.nodes[current].proof = proof
				blue = result(proof, blue8)
				break
			}
			n = &t.nodes[current]
		}
		chosen := t.selectEdge(current)
		if chosen < 0 {
			panic("nœud non prouvé sans coup à explorer")
		}
		t.owners[depth], t.path[depth] = current, chosen
		depth++
		e := t.edge(chosen)
		if e.proof != Unknown {
			blue = result(e.proof, blue8)
			leaf = false
			break
		}
		mover := n.side
		p.Apply(e.move)
		if e.child == noChild {
			t.createChild(current, chosen, p, mover)
		} else if p.Side != int(t.nodes[e.child].side) {
			p.FlipSide()
		}
		current = t.edge(chosen).child
	}

	if leaf {
		n := &t.nodes[current]
		n.visits++
		if n.side == blue8 {
			n.value += blue
		} else {
			n.value += 1 - blue
		}
	}
	for d := depth - 1; d >= 0; d-- {
		owner, index := t.owners[d], t.path[d]
		n := &t.nodes[owner]
		e := t.edge(index)
		v := blue
		if n.side != blue8 {
			v = 1 - blue
		}
		e.visits++
		e.value += v
		n.visits++
		n.value += v
		if e.child != noChild {
			t.proveEdge(owner, index, t.nodes[e.child].proof)
		}
	}
}

const blue8 = int8(board.Blue)

// Package search porte engineSearch.ts : l'évaluation et la recherche du
// maître — approfondissement itératif, PVS à la racine comme aux nœuds
// internes, table de transposition à taille fixe, tueurs, historique, fin de
// partie exacte. Comportement identique au TS, nœud pour nœud.
package search

import (
	"math"
	"sync/atomic"
	"time"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/rules"
)

const (
	maxPly = 40
	// Mate est la valeur d'une partie gagnée ; une victoire proche vaut mieux.
	Mate = 1_000_000
	// MateThreshold : au-delà, un score désigne une partie décidée.
	MateThreshold = Mate - maxPly - 1

	ttBits = 18
	ttSize = 1 << ttBits
	ttMask = ttSize - 1

	flagExact = 0
	flagLower = 1
	flagUpper = 2

	checkInterval = 2047

	lmrMinDepth  = 3
	lmrMinIndex  = 4
	lmrDeepIndex = 12
	orderTrusted = 1<<29 - 1

	// DefaultBudgetMs est le budget par défaut de la recherche bornée au temps.
	DefaultBudgetMs = 2_000
	// IterationGrowth est ce que coûte un palier, en multiples du précédent.
	IterationGrowth = 4
)

// Searcher porte la table, les tueurs, l'historique et les tampons d'une
// recherche. Il n'est pas réentrant : un par fil d'exécution. Ses aides de
// Lazy SMP partagent sa table et ont chacun leurs tueurs, historique et tampons.
type Searcher struct {
	eval     Evaluator
	position board.Position
	tt       []ttEntry

	moves    [maxPly * board.MaxMoves]board.Move
	order    [maxPly * board.MaxMoves]int32
	killers  [maxPly * 2]board.Move
	history  [2 * (board.MoveMask + 1)]int32
	pvLine   [(maxPly + 1) * maxPly]board.Move
	pvLength [maxPly + 1]int

	now      func() float64
	deadline float64
	maxNodes int64
	timed    bool
	reduce   bool
	criteria Criteria
	weights  Weights
	nodes    int64
	aborted  bool

	// stop n'est posé que chez un aide : le fil principal l'arrête par là.
	stop    *atomic.Bool
	helpers []*Searcher
}

// NewSearcher alloue un moteur.
func NewSearcher() *Searcher {
	return &Searcher{tt: make([]ttEntry, ttSize)}
}

// Evaluator rend l'évaluateur du moteur, pour les mesures.
func (s *Searcher) Evaluator() *Evaluator { return &s.eval }

func (s *Searcher) exhausted() bool {
	if s.aborted {
		return true
	}
	if s.nodes >= s.maxNodes {
		s.aborted = true
	} else if s.timed && s.nodes&checkInterval == 0 && s.outOfTime() {
		s.aborted = true
	}
	return s.aborted
}

// outOfTime : un aide ne lit jamais l'horloge, seulement l'ordre d'arrêt.
func (s *Searcher) outOfTime() bool {
	if s.stop != nil {
		return s.stop.Load()
	}
	return s.now() >= s.deadline
}

// scoreMoves classe les coups sans les simuler : coup de la table, tueurs,
// puis historique des coupures.
func (s *Searcher) scoreMoves(base, count int, ttBest board.Move, ply, side int) {
	killerA, killerB := s.killers[ply*2], s.killers[ply*2+1]
	history := s.history[(side-1)*(board.MoveMask+1):]
	for i := base; i < base+count; i++ {
		move := s.moves[i]
		switch move {
		case ttBest:
			s.order[i] = 1 << 30
		case killerA:
			s.order[i] = 1 << 29
		case killerB:
			s.order[i] = 1<<29 - 1
		default:
			s.order[i] = history[move]
		}
	}
}

// pickBest amène en tête le coup de meilleur score restant ; à égalité, le
// premier rencontré.
func (s *Searcher) pickBest(base, count, from int) {
	best := from
	for i := from + 1; i < count; i++ {
		if s.order[base+i] > s.order[base+best] {
			best = i
		}
	}
	if best != from {
		a, b := base+from, base+best
		s.moves[a], s.moves[b] = s.moves[b], s.moves[a]
		s.order[a], s.order[b] = s.order[b], s.order[a]
	}
}

func (s *Searcher) recordCutoff(move board.Move, ply, side, depth int) {
	if s.killers[ply*2] != move {
		s.killers[ply*2+1] = s.killers[ply*2]
		s.killers[ply*2] = move
	}
	slot := (side-1)*(board.MoveMask+1) + int(move)
	s.history[slot] += int32(depth * depth)
	if s.history[slot] > 1<<28 {
		for i := range s.history {
			s.history[i] >>= 1
		}
	}
}

func reduction(depth, index int, order int32) int {
	if depth < lmrMinDepth || index < lmrMinIndex || order >= orderTrusted {
		return 0
	}
	if index < lmrDeepIndex {
		return 1
	}
	return 2
}

// extendPrincipalVariation met `move` en tête de la ligne du pli, suivi de la
// ligne du pli d'après.
func (s *Searcher) extendPrincipalVariation(ply int, move board.Move) {
	target := ply * maxPly
	inherited := min(s.pvLength[ply+1], maxPly-1)
	s.pvLine[target] = move
	copy(s.pvLine[target+1:target+1+inherited], s.pvLine[target+maxPly:])
	s.pvLength[ply] = inherited + 1
}

func (s *Searcher) evaluate() int {
	return s.eval.EvaluateWith(&s.position, &s.criteria, &s.weights)
}

// stalemateValue est la valeur d'une fin par blocage, du point de vue de `side`.
func stalemateValue(p *board.Position, side, ply int) int {
	mine, theirs := p.LargestZone(side), p.LargestZone(board.Other(side))
	switch {
	case mine == theirs:
		return 0
	case mine > theirs:
		return Mate - ply
	}
	return -Mate + ply
}

// search est le negamax : le score est du point de vue du joueur au trait. Une
// passe forcée récurse sans négation et avec la même fenêtre.
func (s *Searcher) search(depth, alpha, beta, ply int) int {
	position := &s.position
	s.nodes++
	if s.exhausted() {
		return 0
	}
	s.pvLength[ply] = 0

	alphaOrigin := alpha
	entry := &s.tt[position.HashA&ttMask]
	key := ttKey(position)
	var ttBest board.Move
	if hit, ok := probe(entry, key); ok {
		ttBest = hit.move
		if hit.depth >= depth {
			score := hit.score
			if score > MateThreshold {
				score -= ply
			} else if score < -MateThreshold {
				score += ply
			}
			switch {
			case hit.flag == flagExact,
				hit.flag == flagLower && score >= beta,
				hit.flag == flagUpper && score <= alpha:
				return score
			}
		}
	}

	if depth <= 0 {
		return s.evaluate()
	}

	base := ply * board.MaxMoves
	count := position.GenerateMoves(s.moves[base : base+board.MaxMoves])
	if count == 0 {
		return s.evaluate()
	}
	s.scoreMoves(base, count, ttBest, ply, position.Side)

	best := -Mate - 1
	var bestMove board.Move
	mover := position.Side

	for index := range count {
		s.pickBest(base, count, index)
		move := s.moves[base+index]
		position.Apply(move)

		var score int
		switch {
		case position.MovePlacedWins(move, mover):
			score = Mate - ply
			s.pvLength[ply+1] = 0
		case position.HasAnyMove(position.Side):
			if index == 0 {
				score = -s.search(depth-1, -beta, -alpha, ply+1)
			} else {
				cut := 0
				if s.reduce {
					cut = reduction(depth, index, s.order[base+index])
				}
				score = -s.search(depth-1-cut, -alpha-1, -alpha, ply+1)
				if cut > 0 && score > alpha {
					score = -s.search(depth-1, -alpha-1, -alpha, ply+1)
				}
				if score > alpha && score < beta {
					score = -s.search(depth-1, -beta, -alpha, ply+1)
				}
			}
		default:
			position.FlipSide()
			if position.HasAnyMove(position.Side) {
				score = s.search(depth-1, alpha, beta, ply+1)
			} else {
				score = stalemateValue(position, mover, ply)
			}
			position.FlipSide()
			// La passe n'est pas un coup : la variante s'arrête ici.
			s.pvLength[ply+1] = 0
		}

		position.Undo(move)
		if s.aborted {
			return 0
		}

		if score > best {
			best = score
			bestMove = move
			if best > alpha {
				alpha = best
				s.extendPrincipalVariation(ply, move)
			}
		}
		if alpha >= beta {
			s.recordCutoff(move, ply, mover, depth)
			break
		}
	}

	stored := best
	if stored > MateThreshold {
		stored += ply
	} else if stored < -MateThreshold {
		stored -= ply
	}
	flag := uint8(flagExact)
	if best <= alphaOrigin {
		flag = flagUpper
	} else if best >= beta {
		flag = flagLower
	}
	store(entry, key, stored, bestMove, depth, flag)
	return best
}

type rootResult struct {
	moves []board.Move
	score int
	pv    []board.Move
}

// searchRoot garde la fenêtre alpha ouverte d'un point sous le meilleur score,
// pour qu'un ex æquo revienne exact, et cherche à fenêtre nulle comme ailleurs.
func (s *Searcher) searchRoot(depth int) *rootResult {
	position := &s.position
	count := position.GenerateMoves(s.moves[:board.MaxMoves])
	if count == 0 {
		return nil
	}
	var ttBest board.Move
	if hit, ok := probe(&s.tt[position.HashA&ttMask], ttKey(position)); ok {
		ttBest = hit.move
	}
	s.scoreMoves(0, count, ttBest, 0, position.Side)

	mover := position.Side
	alpha := -Mate - 1
	best := -Mate - 1
	var bestMoves []board.Move
	s.pvLength[0] = 0

	for index := range count {
		s.pickBest(0, count, index)
		move := s.moves[index]
		position.Apply(move)

		var score int
		switch {
		case position.MovePlacedWins(move, mover):
			score = Mate
			s.pvLength[1] = 0
		case position.HasAnyMove(position.Side):
			if index == 0 {
				score = -s.search(depth-1, -Mate-1, -alpha, 1)
			} else {
				score = -s.search(depth-1, -alpha-1, -alpha, 1)
				if score > alpha && !s.aborted {
					score = -s.search(depth-1, -Mate-1, -alpha, 1)
				}
			}
		default:
			position.FlipSide()
			if position.HasAnyMove(position.Side) {
				if index == 0 {
					score = s.search(depth-1, alpha, Mate+1, 1)
				} else {
					score = s.search(depth-1, alpha, alpha+1, 1)
					if score > alpha && !s.aborted {
						score = s.search(depth-1, alpha, Mate+1, 1)
					}
				}
			} else {
				score = stalemateValue(position, mover, 0)
			}
			position.FlipSide()
			s.pvLength[1] = 0
		}

		position.Undo(move)
		if s.aborted {
			break
		}
		// Un ex æquo ne remplace pas la variante : elle reste à moves[0].
		if score > best {
			best = score
			bestMoves = append(bestMoves[:0], move)
			s.extendPrincipalVariation(0, move)
		} else if score == best {
			bestMoves = append(bestMoves, move)
		}
		if best-1 > alpha {
			alpha = best - 1
		}
	}

	if len(bestMoves) == 0 {
		return nil
	}
	return &rootResult{
		moves: bestMoves,
		score: best,
		pv:    append([]board.Move(nil), s.pvLine[:s.pvLength[0]]...),
	}
}

// Options règle une recherche (MasterSearchOptions). Le zéro de chaque champ
// est la valeur par défaut, celle qui joue.
type Options struct {
	// Now est l'horloge, en millisecondes ; une horloge monotone par défaut.
	Now func() float64
	// BudgetMs borne la recherche au temps ; DefaultBudgetMs si nul.
	BudgetMs float64
	// MaxNodes, positif, remplace le budget de temps : l'horloge n'est alors
	// jamais lue et la recherche est reproductible.
	MaxNodes int64
	// MaxDepth plafonne la profondeur, si positif.
	MaxDepth int
	// SkipOddDepth jette les paliers impairs (allowOddDepth: false).
	SkipOddDepth bool
	// Reduce réduit les coups tardifs ; mesuré nuisible, faux par défaut.
	Reduce bool
	// KeepPartial retient un palier interrompu qui confirme le précédent.
	KeepPartial bool
	// Criteria et Weights remplacent ceux du maître s'ils sont fournis.
	Criteria *Criteria
	Weights  *Weights
	// Random départage les ex æquo ; absent, le premier l'emporte.
	Random func() float64
	// Threads, au-delà de 1, ajoute Threads - 1 aides de Lazy SMP. Ignoré
	// quand MaxNodes est positif : la recherche bornée aux nœuds reste
	// mono-fil, donc reproductible.
	Threads int
	// Iteration, s'il est fourni, est appelé à chaque palier achevé du fil
	// principal, avec les nœuds de ce fil depuis le début : un observateur
	// pour les mesures.
	Iteration func(depth int, nodes int64)
}

// Result est le résultat d'une recherche (MasterSearch).
type Result struct {
	// Moves sont tous les coups de valeur égale à la meilleure, avant tirage.
	Moves []board.Move
	Score int
	// Depth est la profondeur du dernier palier retenu.
	Depth int
	// Exact dit si Score est la valeur de jeu vraie.
	Exact bool
	Nodes int64
	// TotalNodes compte les nœuds de tous les fils, jusqu'à leur arrêt.
	TotalNodes int64
	// PV est la variante principale du premier des ex æquo.
	PV []board.Move
}

func monotonicClock() func() float64 {
	start := time.Now()
	return func() float64 { return float64(time.Since(start)) / float64(time.Millisecond) }
}

// TopMoves cherche le meilleur coup du joueur au trait et rend l'ensemble des
// meilleurs ex æquo (searchMasterTopMoves) ; nil s'il n'a aucun coup.
func (s *Searcher) TopMoves(source *rules.Position, options Options) *Result {
	now := options.Now
	if now == nil {
		now = monotonicClock()
	}
	budget := options.BudgetMs
	if budget <= 0 {
		budget = DefaultBudgetMs
	}
	position := &s.position
	position.Load(source)
	plies := position.RemainingPlies()
	ceiling := min(plies, maxPly-1)
	if options.MaxDepth > 0 {
		ceiling = min(ceiling, options.MaxDepth)
	}

	clear(s.killers[:])
	clear(s.history[:])
	clear(s.tt)

	s.now = now
	s.timed = options.MaxNodes <= 0
	s.maxNodes = math.MaxInt64
	s.deadline = math.Inf(1)
	if s.timed {
		s.deadline = now() + budget
	} else {
		s.maxNodes = options.MaxNodes
	}
	s.criteria = DefaultCriteria
	if options.Criteria != nil {
		s.criteria = *options.Criteria
	}
	s.weights = DefaultWeights
	if options.Weights != nil {
		s.weights = *options.Weights
	}
	s.nodes = 0
	s.aborted = false

	threads := options.Threads
	if !s.timed {
		threads = 1
	}
	var stopHelpers func() int64
	if threads > 1 {
		stopHelpers = s.startHelpers(threads-1, ceiling, plies, options)
	}

	var decision *Result
	for depth := 1; depth <= ceiling; depth++ {
		iterationStart := 0.0
		if s.timed {
			iterationStart = now()
		}
		// L'itération qui atteint la fin de partie prouve : pas de réduction.
		s.reduce = options.Reduce && depth < plies
		result := s.searchRoot(depth)
		if result == nil {
			break
		}

		partial := s.aborted
		var exact bool
		if partial {
			exact = result.score > MateThreshold
		} else {
			exact = depth >= plies || abs(result.score) > MateThreshold
		}
		retained := !options.SkipOddDepth || depth%2 == 0 || depth == 1 || exact
		improves := decision == nil || result.score >= decision.Score
		if retained && (!partial || (options.KeepPartial && improves)) {
			decision = &Result{
				Moves: result.moves,
				Score: result.score,
				Depth: depth,
				Exact: exact,
				Nodes: s.nodes,
				PV:    result.pv,
			}
		}
		if options.Iteration != nil && !partial {
			options.Iteration(depth, s.nodes)
		}
		if partial || exact {
			break
		}
		// Ne pas s'engager dans un palier qu'on n'a pas le temps de finir.
		if s.timed {
			spent := now() - iterationStart
			if now()+spent*IterationGrowth > s.deadline {
				break
			}
		}
	}
	total := s.nodes
	if stopHelpers != nil {
		total += stopHelpers()
	}
	if decision != nil {
		decision.TotalNodes = total
		return decision
	}

	// Budget épuisé avant la première itération : un coup légal plutôt que rien.
	count := position.GenerateMoves(s.moves[:board.MaxMoves])
	if count == 0 {
		return nil
	}
	first := s.moves[0]
	return &Result{Moves: []board.Move{first}, Nodes: s.nodes, TotalNodes: total, PV: []board.Move{first}}
}

// Decision est le coup du maître (MasterDecision).
type Decision struct {
	Move       rules.LegalMove
	Score      int
	Depth      int
	Exact      bool
	Nodes      int64
	TotalNodes int64
}

// Choose rend le coup du maître, tiré parmi les ex æquo par options.Random
// (chooseMasterMove) ; nil s'il n'a aucun coup.
func (s *Searcher) Choose(source *rules.Position, options Options) *Decision {
	result := s.TopMoves(source, options)
	if result == nil {
		return nil
	}
	return &Decision{
		Move:       board.ToLegalMove(PickTied(result.Moves, options.Random)),
		Score:      result.Score,
		Depth:      result.Depth,
		Exact:      result.Exact,
		Nodes:      result.Nodes,
		TotalNodes: result.TotalNodes,
	}
}

// PickTied tire un élément comme le TS : min(floor(random() * n), n - 1), sans
// consommer l'aléa quand il n'y a qu'un candidat.
func PickTied[T any](candidates []T, random func() float64) T {
	if len(candidates) == 1 || random == nil {
		return candidates[0]
	}
	index := min(int(math.Floor(random()*float64(len(candidates)))), len(candidates)-1)
	return candidates[index]
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

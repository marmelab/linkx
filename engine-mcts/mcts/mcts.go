// Package mcts est une recherche Monte-Carlo hybride pour Linkx : sélection
// PUCT, valeur des feuilles tirée de l'évaluation du maître, prior bon marché
// avec élargissement progressif, MCTS-Solver, résolution exacte par
// l'alpha-bêta d'engine-go, parallélisme à la racine. Le plateau, les règles,
// l'évaluation, le livre et l'alpha-bêta viennent d'engine-go, sans
// redéfinition.
package mcts

import (
	"math"
	"sync"
	"time"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/book"
	"github.com/marmelab/linkx/engine-go/rng"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

// DefaultBudgetMs est le budget du maître dans le jeu.
const DefaultBudgetMs = 2_500

// Options règle un coup.
type Options struct {
	// BudgetMs borne au temps, DefaultBudgetMs si nul.
	BudgetMs float64
	// MaxIterations, positif, remplace le budget de temps : l'horloge n'est
	// jamais lue et le coup est reproductible. Réparties entre les fils.
	MaxIterations int
	// Threads arbres indépendants, un par fil (parallélisme à la racine).
	Threads int
	// Seed alimente le livre, le départage des ex æquo et le bruit des aides.
	Seed uint32
	// Book consulte le livre d'ouverture avant la recherche.
	Book   bool
	Params Params
	// Now est l'horloge en millisecondes ; monotone par défaut.
	Now func() float64
}

// Decision est le coup choisi.
type Decision struct {
	Move board.Move
	// Iterations compte les itérations de tous les fils.
	Iterations int
	// Visits sont les visites du coup choisi, tous fils additionnés.
	Visits int
	// Value est la probabilité de gain estimée pour le joueur au trait.
	Value float64
	// Proof est l'issue prouvée de la position : vainqueur, Draw ou Unknown.
	Proof    int8
	FromBook bool
	// FromSolver dit que l'alpha-bêta de la racine a prouvé la valeur.
	FromSolver bool
	Nodes      int
	Solves     int
}

// Player joue les coups. Il garde ses arbres d'une requête à l'autre ; il
// n'est pas réentrant.
type Player struct {
	trees []*tree
}

// NewPlayer alloue un joueur.
func NewPlayer() *Player { return &Player{} }

func (pl *Player) treesFor(count int) []*tree {
	for len(pl.trees) < count {
		pl.trees = append(pl.trees, newTree())
	}
	return pl.trees[:count]
}

func monotonicClock() func() float64 {
	start := time.Now()
	return func() float64 { return float64(time.Since(start)) / float64(time.Millisecond) }
}

// threadSeed dérive la graine d'un fil ; le fil 0 garde celle de la requête.
func threadSeed(seed uint32, thread int) uint32 {
	return seed ^ uint32(thread)*0x9e3779b1
}

// Choose rend le coup du joueur au trait, ou nil s'il n'en a aucun.
func (pl *Player) Choose(source *rules.Position, options Options) *Decision {
	now := options.Now
	if now == nil {
		now = monotonicClock()
	}
	start := 0.0
	timed := options.MaxIterations <= 0
	if timed {
		start = now()
	}
	random := rng.Mulberry32(options.Seed)
	if options.Book {
		if move := book.Opening.Lookup(source, random); move != nil {
			return &Decision{Move: encode(*move), FromBook: true, Value: 0.5}
		}
	}
	var root board.Position
	root.Load(source)
	var buffer [board.MaxMoves]board.Move
	if root.GenerateMoves(buffer[:]) == 0 {
		return nil
	}
	params := options.Params
	threads := max(options.Threads, 1)
	trees := pl.treesFor(threads)

	if params.RootSolveNodes > 0 {
		if proof, solved := trees[0].solve(&root, params.RootSolveNodes); proof != Unknown {
			return &Decision{
				Move:       search.PickTied(solved.Moves, random),
				Value:      result(proof, int8(root.Side)),
				Proof:      proof,
				FromSolver: true,
				Solves:     1,
			}
		}
	}

	budget := options.BudgetMs
	if budget <= 0 {
		budget = DefaultBudgetMs
	}
	deadline := start + budget - params.MarginMs
	checkEvery := max(params.CheckEvery, 1)
	var group sync.WaitGroup
	counts := make([]int, threads)
	for i, t := range trees {
		noise := 0.0
		if i > 0 {
			noise = params.Noise
		}
		t.reset(&root, params, rng.Mulberry32(threadSeed(options.Seed, i)), noise)
		quota := 0
		if !timed {
			quota = options.MaxIterations / threads
			if i < options.MaxIterations%threads {
				quota++
			}
		}
		group.Add(1)
		go func() {
			defer group.Done()
			iterations := 0
			for t.nodes[0].proof == Unknown {
				if timed {
					if iterations%checkEvery == 0 && now() >= deadline {
						break
					}
				} else if iterations >= quota {
					break
				}
				t.iterate()
				iterations++
			}
			counts[i] = iterations
		}()
	}
	group.Wait()

	decision := decide(trees, int8(root.Side), random)
	for i, t := range trees {
		decision.Iterations += counts[i]
		decision.Nodes += len(t.nodes)
		decision.Solves += t.solves
	}
	return decision
}

type rootMove struct {
	move   board.Move
	visits int
	value  float64
	proof  int8
}

// decide additionne les arcs racine des fils et choisit : un coup prouvé
// gagnant, sinon le plus visité parmi ceux qui ne sont pas prouvés perdants ;
// les ex æquo sont tirés par la graine.
func decide(trees []*tree, side int8, random func() float64) *Decision {
	var moves []rootMove
	index := map[board.Move]int{}
	rootProof := int8(Unknown)
	for _, t := range trees {
		root := &t.nodes[0]
		if root.proof != Unknown && rootProof == Unknown {
			rootProof = root.proof
		}
		if root.first == noChild {
			continue
		}
		for _, e := range t.edgesOf(root) {
			k, seen := index[e.move]
			if !seen {
				k = len(moves)
				index[e.move] = k
				moves = append(moves, rootMove{move: e.move})
			}
			m := &moves[k]
			m.visits += int(e.visits)
			m.value += e.value
			if m.proof == Unknown {
				m.proof = e.proof
			}
		}
	}
	rank := func(m *rootMove) float64 {
		switch m.proof {
		case side:
			return math.Inf(1)
		case other(side):
			// Perdu de toute façon : le plus visité, faute de mieux.
			return float64(m.visits) - math.MaxInt32
		}
		return float64(m.visits)
	}
	var tied []int
	best := math.Inf(-1)
	for k := range moves {
		r := rank(&moves[k])
		if r > best {
			best, tied = r, append(tied[:0], k)
		} else if r == best {
			tied = append(tied, k)
		}
	}
	chosen := &moves[search.PickTied(tied, random)]
	value := 0.5
	switch {
	case chosen.proof != Unknown:
		value = result(chosen.proof, side)
	case chosen.visits > 0:
		value = chosen.value / float64(chosen.visits)
	}
	return &Decision{Move: chosen.move, Visits: chosen.visits, Value: value, Proof: rootProof}
}

// encode retrouve le coup empaqueté d'un coup du domaine.
func encode(move rules.LegalMove) board.Move {
	for index, o := range rules.UniqueOrientations(move.Shape) {
		if rules.SameCells(o.Cells, move.Orientation.Cells) {
			anchorY := move.Cells[0].Y - move.Orientation.Cells[0].Y
			return board.EncodeMove(index, int(move.Shape), move.Column, anchorY)
		}
	}
	panic("orientation inconnue")
}

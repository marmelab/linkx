// Package master est l'entrée du niveau maître (chooseMoveForDifficulty(…,
// 'master', …)) : le livre d'ouverture d'abord, puis la recherche, avec le même
// aléa pour départager les ex æquo de l'un comme de l'autre.
package master

import (
	"github.com/marmelab/linkx/engine-go/book"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

// BudgetMs est le budget du maître dans le jeu (MASTER_BUDGET_MS).
const BudgetMs = 2_500

// Options règle un coup du maître.
type Options struct {
	search.Options
	// Book consulte le livre d'ouverture avant la recherche.
	Book bool
}

// Decision est le coup choisi. Un coup du livre a un score, une profondeur et
// un nombre de nœuds nuls, comme en TS.
type Decision struct {
	search.Decision
	FromBook bool
}

// Player joue les coups du maître. Il n'est pas réentrant.
type Player struct {
	searcher *search.Searcher
}

// NewPlayer alloue un maître.
func NewPlayer() *Player { return &Player{searcher: search.NewSearcher()} }

// Choose rend le coup du joueur au trait, ou nil s'il n'en a aucun.
func (m *Player) Choose(position *rules.Position, options Options) *Decision {
	if options.Book {
		if move := book.Opening.Lookup(position, options.Random); move != nil {
			return &Decision{Decision: search.Decision{Move: *move}, FromBook: true}
		}
	}
	if options.MaxNodes <= 0 && options.BudgetMs <= 0 {
		options.BudgetMs = BudgetMs
	}
	decision := m.searcher.Choose(position, options.Options)
	if decision == nil {
		return nil
	}
	return &Decision{Decision: *decision}
}

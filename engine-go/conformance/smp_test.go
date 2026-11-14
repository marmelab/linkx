package conformance

import (
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

// Bornée aux nœuds, la recherche reste mono-fil : Threads n'y change rien.
func TestLazySMPIgnoredWhenNodeBounded(t *testing.T) {
	ref := load(t)
	searcher := search.NewSearcher()
	for _, c := range ref.Search[:20] {
		position := &parse(t, c.Record).Position
		alone := searcher.TopMoves(position, search.Options{MaxNodes: c.MaxNodes})
		parallel := searcher.TopMoves(position, search.Options{MaxNodes: c.MaxNodes, Threads: 4})
		if !reflect.DeepEqual(alone, parallel) {
			t.Errorf("%q à %d nœuds : %+v à quatre fils, %+v à un", c.Record, c.MaxNodes, *parallel, *alone)
		}
	}
}

// Au temps, plusieurs fils rendent un coup légal, et la même valeur de jeu
// quand la fin de partie est résolue.
func TestLazySMPTimed(t *testing.T) {
	ref := load(t)
	tokens := strings.Fields(ref.Reference)
	single, parallel := search.NewSearcher(), search.NewSearcher()
	for moveCount := 0; moveCount <= len(tokens); moveCount++ {
		game := parse(t, strings.Join(tokens[:moveCount], " "))
		if game.Finished {
			continue
		}
		position := &game.Position
		top := parallel.TopMoves(position, search.Options{BudgetMs: 80, Threads: 4})
		legal := moveTokens(top.Moves)
		for _, move := range legal {
			if !slices.Contains(legalTokens(position), move) {
				t.Errorf("après %d coups : %s n'est pas légal", moveCount, move)
			}
		}
		if top.TotalNodes < top.Nodes {
			t.Errorf("après %d coups : %d nœuds en tout pour %d au fil principal", moveCount, top.TotalNodes, top.Nodes)
		}
		if !top.Exact {
			continue
		}
		alone := single.TopMoves(position, search.Options{BudgetMs: 60_000})
		if !alone.Exact || alone.Score != top.Score {
			t.Errorf("après %d coups : valeur %d à quatre fils, %d (exacte %v) à un", moveCount, top.Score, alone.Score, alone.Exact)
		}
	}
}

func legalTokens(position *rules.Position) []string {
	return tokens(position.Board.EnumerateLegalMoves(&position.Inventories[position.Active]))
}

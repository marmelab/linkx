package conformance

import (
	"flag"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/marmelab/linkx/engine-go/search"
)

var (
	benchNodes  = flag.Int64("nodes", 200_000, "plafond de nœuds de BenchmarkReferenceGame")
	benchBudget = flag.Float64("budget", 0, "budget en millisecondes de BenchmarkReferenceGame, à la place des nœuds")
)

// BenchmarkReferenceGame cherche chaque position en cours de la partie de
// référence, comme scripts/bench-go.ts côté TS :
//
//	go test ./conformance -run '^$' -bench ReferenceGame -benchtime 1x -args -nodes 200000 -budget 2500
func BenchmarkReferenceGame(b *testing.B) {
	ref := load(&testing.T{})
	tokens := strings.Fields(ref.Reference)
	searcher := search.NewSearcher()
	options := search.Options{MaxNodes: *benchNodes}
	if *benchBudget > 0 {
		options = search.Options{BudgetMs: *benchBudget}
	}
	var nodes int64
	var elapsed time.Duration
	var depths []string
	for b.Loop() {
		depths = depths[:0]
		for moveCount := 0; moveCount <= len(tokens); moveCount++ {
			game := parse(&testing.T{}, strings.Join(tokens[:moveCount], " "))
			if game.Finished {
				continue
			}
			start := time.Now()
			result := searcher.TopMoves(&game.Position, options)
			elapsed += time.Since(start)
			nodes += result.Nodes
			depths = append(depths, fmt.Sprint(result.Depth))
		}
	}
	b.ReportMetric(float64(nodes)/elapsed.Seconds(), "nodes/s")
	b.Logf("%d nœuds ; profondeurs : %s", nodes/int64(b.N), strings.Join(depths, " "))
}

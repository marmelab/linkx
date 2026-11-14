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
	benchNodes   = flag.Int64("nodes", 200_000, "plafond de nœuds de BenchmarkReferenceGame")
	benchBudget  = flag.Float64("budget", 0, "budget en millisecondes de BenchmarkReferenceGame, à la place des nœuds")
	benchDepth   = flag.Int("depth", 0, "profondeur visée par BenchmarkReferenceGame, au temps et sans budget")
	benchThreads = flag.Int("threads", 1, "fils de BenchmarkReferenceGame, hors plafond de nœuds")
)

// BenchmarkReferenceGame cherche chaque position en cours de la partie de
// référence, comme scripts/bench-go.ts côté TS :
//
//	go test ./conformance -run '^$' -bench ReferenceGame -benchtime 1x -args -nodes 200000 -budget 2500
//
// nodes/s ne compte que les nœuds des paliers retenus du fil principal,
// all-nodes/s tous ceux de tous les fils. -depth D mesure le temps pour
// atteindre la profondeur D, -threads N avec N fils.
func BenchmarkReferenceGame(b *testing.B) {
	ref := load(&testing.T{})
	tokens := strings.Fields(ref.Reference)
	searcher := search.NewSearcher()
	options := search.Options{MaxNodes: *benchNodes}
	if *benchDepth > 0 {
		options = search.Options{BudgetMs: 1e12, MaxDepth: *benchDepth}
	} else if *benchBudget > 0 {
		options = search.Options{BudgetMs: *benchBudget}
	}
	options.Threads = *benchThreads
	var nodes, total int64
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
			total += result.TotalNodes
			depths = append(depths, fmt.Sprint(result.Depth))
		}
	}
	b.ReportMetric(float64(nodes)/elapsed.Seconds(), "nodes/s")
	b.ReportMetric(float64(total)/elapsed.Seconds(), "all-nodes/s")
	b.ReportMetric(float64(elapsed.Milliseconds())/float64(b.N), "ms/op")
	b.Logf("%d nœuds ; profondeurs : %s", nodes/int64(b.N), strings.Join(depths, " "))
}

package search

import (
	"math"
	"sync"
	"sync/atomic"
)

// startHelpers lance les aides de Lazy SMP sur la position du fil principal,
// qui doit être prête. Chaque aide mène son propre approfondissement
// itératif dans la table partagée, sans rien rendre : seul le fil principal
// décide du coup. La fonction rendue arrête les aides, les attend et rend
// leur total de nœuds.
func (s *Searcher) startHelpers(count, ceiling, plies int, options Options) func() int64 {
	for len(s.helpers) < count {
		s.helpers = append(s.helpers, &Searcher{})
	}
	stop := new(atomic.Bool)
	var group sync.WaitGroup
	for i, h := range s.helpers[:count] {
		h.tt = s.tt
		h.position = s.position
		clear(h.killers[:])
		clear(h.history[:])
		h.criteria, h.weights = s.criteria, s.weights
		h.timed, h.maxNodes, h.deadline = true, math.MaxInt64, math.Inf(1)
		h.nodes, h.aborted = 0, false
		h.stop = stop
		// Un aide sur deux cherche un palier plus loin que le fil principal.
		offset := (i + 1) & 1
		group.Add(1)
		go func() {
			defer group.Done()
			for depth := 1 + offset; depth <= ceiling && !h.aborted; depth++ {
				h.reduce = options.Reduce && depth < plies
				if h.searchRoot(depth) == nil {
					return
				}
			}
		}()
	}
	return func() int64 {
		stop.Store(true)
		group.Wait()
		var nodes int64
		for _, h := range s.helpers[:count] {
			nodes += h.nodes
		}
		return nodes
	}
}

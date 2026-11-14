package search

import (
	"sync/atomic"

	"github.com/marmelab/linkx/engine-go/board"
)

// La table de transposition est partagée sans verrou entre les fils de Lazy
// SMP : chaque entrée tient en deux mots atomiques, la donnée et la clé
// mêlée à la donnée. Une lecture qui croise deux écritures concurrentes ne
// retrouve pas sa clé et passe pour un défaut de table.
type ttEntry struct {
	check atomic.Uint64
	data  atomic.Uint64
}

const (
	ttMoveShift  = 32
	ttDepthShift = 48
	ttFlagShift  = 56
	ttFilled     = 1 << 63
)

type ttHit struct {
	score int
	move  board.Move
	depth int
	flag  uint8
}

func ttKey(p *board.Position) uint64 { return uint64(p.HashA)<<32 | uint64(p.HashB) }

func probe(entry *ttEntry, key uint64) (ttHit, bool) {
	data := entry.data.Load()
	if data&ttFilled == 0 || entry.check.Load()^data != key {
		return ttHit{}, false
	}
	return ttHit{
		score: int(int32(uint32(data))),
		move:  board.Move(data >> ttMoveShift),
		depth: int(int8(data >> ttDepthShift)),
		flag:  uint8(data>>ttFlagShift) & 3,
	}, true
}

func store(entry *ttEntry, key uint64, score int, move board.Move, depth int, flag uint8) {
	data := uint64(uint32(int32(score))) | uint64(move)<<ttMoveShift |
		uint64(uint8(int8(depth)))<<ttDepthShift | uint64(flag)<<ttFlagShift | ttFilled
	entry.check.Store(key ^ data)
	entry.data.Store(data)
}

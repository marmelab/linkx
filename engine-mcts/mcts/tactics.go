package mcts

import (
	"github.com/marmelab/linkx/engine-go/bitboard"
	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/rules"
)

const size = rules.Size

// moveShape porte, pour chaque coup empaqueté, ses cases et leur voisinage à
// huit cases (cases du coup exclues). Les coups suivent l'ordre des
// orientations de rules.UniqueOrientations, celui de board.
type moveShape struct {
	cells, ring bitboard.Set
	size        int8
}

var moveShapes = func() (table [board.MoveMask + 1]moveShape) {
	for shape := range rules.ShapeCount {
		for index, o := range rules.UniqueOrientations(rules.Shape(shape)) {
			for column := 0; column+o.Width <= size; column++ {
				for anchorY := 0; anchorY+o.Height <= size; anchorY++ {
					var entry moveShape
					var inside [size * size]bool
					for _, p := range o.Cells {
						inside[(anchorY+p.Y)*size+column+p.X] = true
					}
					for cell, own := range inside {
						if own {
							add(&entry.cells, cell)
							entry.size++
						}
					}
					for cell, own := range inside {
						if own {
							continue
						}
						x, y := cell%size, cell/size
						for dy := -1; dy <= 1; dy++ {
							for dx := -1; dx <= 1; dx++ {
								nx, ny := x+dx, y+dy
								if nx >= 0 && nx < size && ny >= 0 && ny < size && inside[ny*size+nx] {
									add(&entry.ring, cell)
								}
							}
						}
					}
					table[board.EncodeMove(index, shape, column, anchorY)] = entry
				}
			}
		}
	}
	return table
}()

func add(s *bitboard.Set, cell int) { s[bitboard.CellLimb[cell]] |= bitboard.CellBit[cell] }

func meets(a, b bitboard.Set) bool { return a[0]&b[0]|a[1]&b[1]|a[2]&b[2] != 0 }

// edgeZones porte les cases d'un joueur reliées à chacun des quatre bords.
type edgeZones struct{ left, right, top, bottom bitboard.Set }

func zonesOf(own bitboard.Set) edgeZones {
	return edgeZones{
		left:   bitboard.Flood(own.And(bitboard.EdgeLeft), own),
		right:  bitboard.Flood(own.And(bitboard.EdgeRight), own),
		top:    bitboard.Flood(own.And(bitboard.EdgeTop), own),
		bottom: bitboard.Flood(own.And(bitboard.EdgeBottom), own),
	}
}

// wins dit si poser `m` relie deux bords opposés. La zone formée est le coup
// et les zones voisines : elle touche un bord si le coup le touche ou s'il
// borde une zone qui le touche. Même verdict que board.MovePlacedWins.
func (z *edgeZones) wins(m board.Move) bool {
	s := &moveShapes[m]
	left := meets(s.cells, bitboard.EdgeLeft) || meets(s.ring, z.left)
	right := meets(s.cells, bitboard.EdgeRight) || meets(s.ring, z.right)
	if left && right {
		return true
	}
	top := meets(s.cells, bitboard.EdgeTop) || meets(s.ring, z.top)
	bottom := meets(s.cells, bitboard.EdgeBottom) || meets(s.ring, z.bottom)
	return top && bottom
}

// hasImmediateWin dit si le joueur au trait gagne en un coup. `buffer` reçoit
// ses coups.
func hasImmediateWin(p *board.Position, buffer []board.Move) bool {
	count := p.GenerateMoves(buffer)
	zones := zonesOf(p.Bits[p.Side-1])
	for _, m := range buffer[:count] {
		if zones.wins(m) {
			return true
		}
	}
	return false
}

// opponentThreatens dit si l'adversaire du joueur au trait gagnerait en un
// coup s'il avait le trait.
func opponentThreatens(p *board.Position, buffer []board.Move) bool {
	q := *p
	q.FlipSide()
	return hasImmediateWin(&q, buffer)
}

// contacts rend les cases du joueur au trait, puis de l'adversaire, voisines du coup.
func contacts(p *board.Position, m board.Move) (own, other int) {
	ring := moveShapes[m].ring
	return ring.And(p.Bits[p.Side-1]).Count(), ring.And(p.Bits[board.Other(p.Side)-1]).Count()
}

// outcome résout la position qui suit la pose de `m` par `mover` : victoire,
// trait à l'adversaire, passe forcée, ou blocage départagé par les zones.
// Rend le vainqueur (Draw pour une nulle) si la partie est finie, et ajuste
// le trait en cas de passe.
func outcome(p *board.Position, m board.Move, mover int) (finished bool, winner int) {
	if p.MovePlacedWins(m, mover) {
		return true, mover
	}
	if p.HasAnyMove(p.Side) {
		return false, 0
	}
	p.FlipSide()
	if p.HasAnyMove(p.Side) {
		return false, 0
	}
	mine, theirs := p.LargestZone(mover), p.LargestZone(board.Other(mover))
	switch {
	case mine > theirs:
		return true, mover
	case mine < theirs:
		return true, board.Other(mover)
	}
	return true, Draw
}

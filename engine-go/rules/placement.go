package rules

// DropReason dit pourquoi une pose est refusée.
type DropReason string

const (
	DropValid            DropReason = ""
	DropHorizontalBounds DropReason = "horizontal-bounds"
	DropOverflow         DropReason = "overflow"
	DropUnsupported      DropReason = "unsupported"
)

func cellsAt(o *Orientation, anchorX, anchorY int) []Point {
	cells := make([]Point, len(o.Cells))
	for i, p := range o.Cells {
		cells[i] = Point{p.X + anchorX, p.Y + anchorY}
	}
	return cells
}

func (b *Board) collides(o *Orientation, anchorX, anchorY int) bool {
	for _, p := range o.Cells {
		x, y := p.X+anchorX, p.Y+anchorY
		if x < 0 || x >= Size || y >= Size || (y >= 0 && b[y][x] != None) {
			return true
		}
	}
	return false
}

func (b *Board) fullySupported(cells []Point) bool {
	for _, c := range cells {
		if c.Y == Size-1 || b[c.Y+1][c.X] != None {
			continue
		}
		own := false
		for _, other := range cells {
			if other.X == c.X && other.Y == c.Y+1 {
				own = true
				break
			}
		}
		if !own {
			return false
		}
	}
	return true
}

// CalculateDrop fait tomber l'orientation ancrée en colonne `anchorX` (placement.ts).
// Les cases ne sont rendues que pour une pose valide.
func (b *Board) CalculateDrop(o *Orientation, anchorX int) ([]Point, DropReason) {
	if anchorX < 0 || anchorX+o.Width > Size {
		return nil, DropHorizontalBounds
	}
	anchorY := -o.Height
	for !b.collides(o, anchorX, anchorY+1) {
		anchorY++
	}
	cells := cellsAt(o, anchorX, anchorY)
	for _, c := range cells {
		if c.Y < 0 {
			return nil, DropOverflow
		}
	}
	if !b.fullySupported(cells) {
		return nil, DropUnsupported
	}
	return cells, DropValid
}

// LegalMove est un coup légal du domaine.
type LegalMove struct {
	Shape       Shape
	Orientation *Orientation
	Column      int
	Cells       []Point
}

// EnumerateLegalMoves suit l'ordre de legalMoves.ts : formes, orientations
// distinctes, colonnes.
func (b *Board) EnumerateLegalMoves(inv *Inventory) []LegalMove {
	var moves []LegalMove
	for shape := Shape(0); shape < ShapeCount; shape++ {
		if inv[shape] == 0 {
			continue
		}
		orientations := UniqueOrientations(shape)
		for i := range orientations {
			o := &orientations[i]
			for column := 0; column <= Size-o.Width; column++ {
				if cells, reason := b.CalculateDrop(o, column); reason == DropValid {
					moves = append(moves, LegalMove{Shape: shape, Orientation: o, Column: column, Cells: cells})
				}
			}
		}
	}
	return moves
}

// HasLegalMove dit si la réserve permet au moins une pose.
func (b *Board) HasLegalMove(inv *Inventory) bool {
	for shape := Shape(0); shape < ShapeCount; shape++ {
		if inv[shape] == 0 {
			continue
		}
		orientations := UniqueOrientations(shape)
		for i := range orientations {
			o := &orientations[i]
			for column := 0; column <= Size-o.Width; column++ {
				if _, reason := b.CalculateDrop(o, column); reason == DropValid {
					return true
				}
			}
		}
	}
	return false
}

// flood inonde la composante de `player` depuis `start` (voisinage à huit) et
// rend sa taille et les bords touchés : 1 gauche, 2 droite, 4 haut, 8 bas.
func (b *Board) flood(player Player, start int, visited *[Cells]bool) (size, edges int) {
	stack := []int{start}
	visited[start] = true
	for len(stack) > 0 {
		cell := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		size++
		x, y := cell%Size, cell/Size
		if x == 0 {
			edges |= 1
		}
		if x == Size-1 {
			edges |= 2
		}
		if y == 0 {
			edges |= 4
		}
		if y == Size-1 {
			edges |= 8
		}
		for dy := -1; dy <= 1; dy++ {
			for dx := -1; dx <= 1; dx++ {
				nx, ny := x+dx, y+dy
				if (dx == 0 && dy == 0) || nx < 0 || nx >= Size || ny < 0 || ny >= Size {
					continue
				}
				next := ny*Size + nx
				if visited[next] || b[ny][nx] != player {
					continue
				}
				visited[next] = true
				stack = append(stack, next)
			}
		}
	}
	return size, edges
}

// HasWinningConnection dit si une zone de `player` relie deux bords opposés.
func (b *Board) HasWinningConnection(player Player) bool {
	var visited [Cells]bool
	for start := range Cells {
		if visited[start] || b[start/Size][start%Size] != player {
			continue
		}
		if _, edges := b.flood(player, start, &visited); edges&3 == 3 || edges&12 == 12 {
			return true
		}
	}
	return false
}

// LargestZone rend la taille de la plus grande zone connexe de `player`.
func (b *Board) LargestZone(player Player) int {
	var visited [Cells]bool
	largest := 0
	for start := range Cells {
		if visited[start] || b[start/Size][start%Size] != player {
			continue
		}
		size, _ := b.flood(player, start, &visited)
		largest = max(largest, size)
	}
	return largest
}

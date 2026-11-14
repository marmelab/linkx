// Package rules porte les règles de Linkx telles que src/game/ les définit :
// pièces, orientations, chute, connexion et enchaînement des tours.
//
// Correspondance : types.ts, pieces.ts, transforms.ts, placement.ts,
// legalMoves.ts, connectivity.ts, simulation.ts et le reducer pour la pose.
package rules

import "slices"

// Size est le côté du plateau (BOARD_SIZE).
const Size = 9

// Cells est le nombre de cases du plateau.
const Cells = Size * Size

// Player désigne un camp. La valeur sert aussi de contenu de case.
type Player uint8

const (
	None  Player = 0
	Blue  Player = 1
	White Player = 2
)

// Other rend l'adversaire.
func (p Player) Other() Player {
	if p == Blue {
		return White
	}
	return Blue
}

func (p Player) String() string {
	switch p {
	case Blue:
		return "blue"
	case White:
		return "white"
	}
	return "none"
}

// Shape est l'indice d'une forme dans l'ordre de SHAPE_IDS.
type Shape uint8

const (
	Mono Shape = iota
	Domino
	Bar3
	SmallL
	S
	T
	LargeL
	ShapeCount = 7
)

var shapeNames = [ShapeCount]string{"mono", "domino", "bar3", "smallL", "s", "t", "largeL"}

func (s Shape) String() string { return shapeNames[s] }

var baseShapes = [ShapeCount][][]uint8{
	Mono:   {{1}},
	Domino: {{1, 1}},
	Bar3:   {{1, 1, 1}},
	SmallL: {{1, 1}, {1, 0}},
	S:      {{0, 1}, {1, 1}, {1, 0}},
	T:      {{1, 1, 1}, {0, 1, 0}},
	LargeL: {{1, 1, 1}, {1, 0, 0}},
}

// InitialCopies est le nombre d'exemplaires de chaque forme en début de partie.
const InitialCopies = 2

// Point est une case, x vers la droite, y vers le bas.
type Point struct{ X, Y int }

// Orientation est une forme tournée puis éventuellement retournée.
type Orientation struct {
	Cells    []Point
	Width    int
	Height   int
	Rotation int
	Flipped  bool
}

func matrixToPoints(matrix [][]uint8) []Point {
	var points []Point
	for y, row := range matrix {
		for x, filled := range row {
			if filled != 0 {
				points = append(points, Point{x, y})
			}
		}
	}
	return points
}

func normalizePoints(points []Point) []Point {
	minX, minY := points[0].X, points[0].Y
	for _, p := range points {
		minX = min(minX, p.X)
		minY = min(minY, p.Y)
	}
	out := make([]Point, len(points))
	for i, p := range points {
		out[i] = Point{p.X - minX, p.Y - minY}
	}
	slices.SortStableFunc(out, func(a, b Point) int {
		if a.Y != b.Y {
			return a.Y - b.Y
		}
		return a.X - b.X
	})
	return out
}

func rotateOnce(points []Point) []Point {
	out := make([]Point, len(points))
	for i, p := range points {
		out[i] = Point{-p.Y, p.X}
	}
	return normalizePoints(out)
}

func reflect(points []Point) []Point {
	out := make([]Point, len(points))
	for i, p := range points {
		out[i] = Point{-p.X, p.Y}
	}
	return normalizePoints(out)
}

// NewOrientation rend la forme retournée (avant la rotation) puis tournée de
// `rotation` quarts de tour horaires, comme getOrientation.
func NewOrientation(shape Shape, rotation int, flipped bool) Orientation {
	cells := matrixToPoints(baseShapes[shape])
	if flipped {
		cells = reflect(cells)
	}
	cells = normalizePoints(cells)
	for turn := 0; turn < rotation; turn++ {
		cells = rotateOnce(cells)
	}
	width, height := 0, 0
	for _, p := range cells {
		width = max(width, p.X+1)
		height = max(height, p.Y+1)
	}
	return Orientation{Cells: cells, Width: width, Height: height, Rotation: rotation, Flipped: flipped}
}

// SameCells dit si deux orientations normalisées couvrent les mêmes cases.
func SameCells(a, b []Point) bool { return slices.Equal(a, b) }

var uniqueOrientations = func() [ShapeCount][]Orientation {
	var all [ShapeCount][]Orientation
	for shape := Shape(0); shape < ShapeCount; shape++ {
		for _, flipped := range []bool{false, true} {
			for rotation := 0; rotation < 4; rotation++ {
				candidate := NewOrientation(shape, rotation, flipped)
				if !slices.ContainsFunc(all[shape], func(o Orientation) bool { return SameCells(o.Cells, candidate.Cells) }) {
					all[shape] = append(all[shape], candidate)
				}
			}
		}
	}
	return all
}()

// UniqueOrientations rend les orientations distinctes d'une forme, dans l'ordre
// de transforms.ts. Le tableau est partagé : lecture seule.
func UniqueOrientations(shape Shape) []Orientation { return uniqueOrientations[shape] }

// Board est indexé [y][x].
type Board [Size][Size]Player

// Inventory compte les exemplaires restants de chaque forme.
type Inventory [ShapeCount]int

// Total rend le nombre de pièces restantes.
func (inv Inventory) Total() int {
	total := 0
	for _, n := range inv {
		total += n
	}
	return total
}

// FullInventory rend la réserve d'un joueur en début de partie.
func FullInventory() Inventory {
	var inv Inventory
	for i := range inv {
		inv[i] = InitialCopies
	}
	return inv
}

// Position est ce que la recherche lit : plateau, réserves, joueur au trait
// (GamePosition).
type Position struct {
	Board       Board
	Inventories [3]Inventory // indexées par Player ; l'indice 0 est inutilisé
	Active      Player
}

// NewPosition rend la grille vide, `first` au trait.
func NewPosition(first Player) Position {
	return Position{
		Inventories: [3]Inventory{{}, FullInventory(), FullInventory()},
		Active:      first,
	}
}

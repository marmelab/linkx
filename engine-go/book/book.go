// Package book porte openingBook.ts : le livre d'ouverture du maître, réduit
// par la seule symétrie gauche-droite.
//
// book.json est généré depuis src/game/openingBook.data.ts ; ne pas l'éditer.
package book

//go:generate sh -c "cd ../.. && node node_modules/vite-node/dist/cli.mjs scripts/livre-go.ts"

import (
	_ "embed"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/marmelab/linkx/engine-go/rules"
)

// MaxPlayedMoves est le nombre de coups déjà posés par le joueur au trait
// au-delà duquel le livre ne s'applique plus (BOOK_MAX_PLAYED_MOVES).
const MaxPlayedMoves = 1

const n = rules.Size

//go:embed book.json
var data []byte

// Book associe une clé canonique à ses meilleurs coups ex æquo, chacun donné
// par les indices y*9+x de ses cases, triés, en repère canonique.
type Book map[string][][]int

// Opening est le livre embarqué.
var Opening = func() Book {
	var book Book
	if err := json.Unmarshal(data, &book); err != nil {
		panic("livre d'ouverture illisible : " + err.Error())
	}
	return book
}()

func movesPlayedBy(p *rules.Position, player rules.Player) int {
	return rules.ShapeCount*rules.InitialCopies - p.Inventories[player].Total()
}

// WithinRange dit si la position est dans le périmètre du livre.
func WithinRange(p *rules.Position) bool {
	return movesPlayedBy(p, p.Active) <= MaxPlayedMoves
}

func boardString(b *rules.Board, mirror bool) string {
	var out strings.Builder
	for y := range n {
		for x := range n {
			column := x
			if mirror {
				column = n - 1 - x
			}
			switch b[y][column] {
			case rules.Blue:
				out.WriteByte('B')
			case rules.White:
				out.WriteByte('W')
			default:
				out.WriteByte('.')
			}
		}
	}
	return out.String()
}

// CanonicalKey rend la clé d'une position et dit si le miroir a été appliqué.
func CanonicalKey(p *rules.Position) (string, bool) {
	plain := boardString(&p.Board, false)
	mirrored := boardString(&p.Board, true)
	mirror := mirrored < plain
	var key strings.Builder
	key.WriteString(p.Active.String())
	key.WriteByte('|')
	for _, player := range []rules.Player{rules.Blue, rules.White} {
		for _, count := range p.Inventories[player] {
			key.WriteString(strconv.Itoa(count))
		}
	}
	key.WriteByte('|')
	if mirror {
		key.WriteString(mirrored)
	} else {
		key.WriteString(plain)
	}
	return key.String(), mirror
}

func mirrorIndex(index int) int {
	x := index % n
	return index - x + n - 1 - x
}

// Lookup rend le coup du livre pour cette position, ou nil. `random` départage
// les ex æquo ; absent, le premier l'emporte.
func (b Book) Lookup(p *rules.Position, random func() float64) *rules.LegalMove {
	if !WithinRange(p) {
		return nil
	}
	key, mirror := CanonicalKey(p)
	moves := b[key]
	if len(moves) == 0 {
		return nil
	}
	stored := moves[0]
	if random != nil && len(moves) > 1 {
		stored = moves[min(int(random()*float64(len(moves))), len(moves)-1)]
	}
	wanted := make(map[int]bool, len(stored))
	for _, index := range stored {
		if mirror {
			index = mirrorIndex(index)
		}
		wanted[index] = true
	}
	for _, move := range p.Board.EnumerateLegalMoves(&p.Inventories[p.Active]) {
		if len(move.Cells) != len(wanted) {
			continue
		}
		match := true
		for _, c := range move.Cells {
			if !wanted[c.Y*n+c.X] {
				match = false
				break
			}
		}
		if match {
			return &move
		}
	}
	return nil
}

// Package notation lit et écrit la notation d'une partie (moveNotation.ts ;
// grammaire dans plan.md, « Notation d'une partie »).
package notation

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/marmelab/linkx/engine-go/rules"
)

// PassToken est le jeton d'une passe forcée.
const PassToken = "--"

var shapeTokens = [rules.ShapeCount]string{"1", "2", "3I", "3L", "4S", "4T", "4L"}

var movePattern = regexp.MustCompile(`(?i)^(1|2|3I|3L|4S|4T|4L)(S?)(?:([RL])([123]))?([1-9])$`)

var firstPlayerTokens = map[string]rules.Player{
	"b": rules.Blue, "blue": rules.Blue, "w": rules.White, "white": rules.White,
}

var reasonMessages = map[string]string{
	"syntax":            "notation de coup invalide",
	"exhausted":         "cette pièce n’est plus en réserve",
	"horizontal-bounds": "la pièce sort du plateau sur les côtés",
	"overflow":          "la pièce dépasse par le haut du plateau",
	"unsupported":       "la pièce laisserait un vide sous elle",
	"game-over":         "la partie est déjà terminée",
	"unexpected-pass":   "aucun tour n’est passé à cet endroit",
}

// Error désigne le jeton refusé : son rang hors indication de premier joueur,
// à partir de 0, et la raison structurée du refus.
type Error struct {
	Index  int
	Token  string
	Reason string
}

func (e *Error) Error() string {
	return fmt.Sprintf("Coup %d (« %s ») : %s.", e.Index+1, e.Token, reasonMessages[e.Reason])
}

// canonical ramène une orientation à celle que conservent les orientations
// distinctes de la forme.
func canonical(shape rules.Shape, rotation int, flipped bool) (int, bool) {
	cells := rules.NewOrientation(shape, rotation, flipped).Cells
	for _, o := range rules.UniqueOrientations(shape) {
		if rules.SameCells(o.Cells, cells) {
			return o.Rotation, o.Flipped
		}
	}
	panic("orientation introuvable")
}

// ParseMove lit un jeton de coup isolé, ramené à son orientation canonique.
func ParseMove(token string) (rules.RecordedMove, bool) {
	// Le /i de JavaScript ne replie aucun caractère non ASCII sur un ASCII (ſ, K) :
	// un tel jeton n'y correspond jamais au motif.
	for i := range len(token) {
		if token[i] >= utf8.RuneSelf {
			return rules.RecordedMove{}, false
		}
	}
	match := movePattern.FindStringSubmatch(token)
	if match == nil {
		return rules.RecordedMove{}, false
	}
	shape := rules.Shape(0)
	for shape < rules.ShapeCount && shapeTokens[shape] != strings.ToUpper(match[1]) {
		shape++
	}
	turns := 0
	if match[4] != "" {
		turns, _ = strconv.Atoi(match[4])
	}
	rotation := turns % 4
	if match[3] != "" && strings.ToLower(match[3]) == "l" {
		rotation = (4 - turns) % 4
	}
	column, _ := strconv.Atoi(match[5])
	rotation, flipped := canonical(shape, rotation, match[2] != "")
	return rules.RecordedMove{Shape: shape, Rotation: rotation, Flipped: flipped, Column: column - 1}, true
}

// SerializeMove écrit un coup dans sa seule forme canonique.
func SerializeMove(move rules.RecordedMove) string {
	rotation, flipped := canonical(move.Shape, move.Rotation, move.Flipped)
	var b strings.Builder
	b.WriteString(shapeTokens[move.Shape])
	if flipped {
		b.WriteByte('s')
	}
	if rotation != 0 {
		b.WriteByte('r')
		b.WriteString(strconv.Itoa(rotation))
	}
	b.WriteString(strconv.Itoa(move.Column + 1))
	return b.String()
}

// SerializeLegalMove écrit un coup légal de la recherche.
func SerializeLegalMove(move rules.LegalMove) string {
	return SerializeMove(rules.RecordedMove{
		Shape:    move.Shape,
		Rotation: move.Orientation.Rotation,
		Flipped:  move.Orientation.Flipped,
		Column:   move.Column,
	})
}

// isSeparator reprend /[\s,+]/ : les blancs de JavaScript, la virgule et le plus.
func isSeparator(r rune) bool {
	return (unicode.IsSpace(r) && r != '\u0085') || r == '\uFEFF' || r == ',' || r == '+'
}

// Parse rejoue une partie et rend son état final. En cas de refus, rien n'est
// rendu que l'erreur.
func Parse(source string) (*rules.Game, *Error) {
	game, _, err := replay(source, false)
	return game, err
}

// ParseTimeline rejoue une partie et rend toutes les positions traversées :
// l'indice k porte la position après k entrées d'historique, passes comprises.
func ParseTimeline(source string) ([]rules.Game, *Error) {
	_, states, err := replay(source, true)
	return states, err
}

func replay(source string, keep bool) (*rules.Game, []rules.Game, *Error) {
	tokens := strings.FieldsFunc(source, isSeparator)
	first, declared := rules.Blue, false
	if len(tokens) > 0 {
		if player, ok := firstPlayerTokens[strings.ToLower(tokens[0])]; ok {
			first, declared = player, true
		}
	}
	offset := 0
	if declared {
		offset = 1
	}

	game := rules.NewGame(first)
	var states []rules.Game
	if keep {
		states = append(states, snapshot(game))
	}
	pendingPass := false
	for index := offset; index < len(tokens); index++ {
		token := tokens[index]
		rank := index - offset
		if token == PassToken {
			if !pendingPass {
				return nil, nil, &Error{rank, token, "unexpected-pass"}
			}
			pendingPass = false
			continue
		}
		if game.Finished {
			return nil, nil, &Error{rank, token, "game-over"}
		}
		move, ok := ParseMove(token)
		if !ok {
			return nil, nil, &Error{rank, token, "syntax"}
		}
		if reason := game.Play(move); reason != "" {
			return nil, nil, &Error{rank, token, reason}
		}
		if keep {
			for len(states) <= len(game.History) {
				states = append(states, snapshot(game))
			}
		}
		pendingPass = game.History[len(game.History)-1].Pass
	}
	return game, states, nil
}

func snapshot(game *rules.Game) rules.Game {
	state := *game
	state.History = append([]rules.Entry(nil), game.History...)
	return state
}

// Serialize écrit la partie dans sa forme canonique.
func Serialize(game *rules.Game) string {
	tokens := make([]string, 0, len(game.History)+1)
	if game.FirstPlayer == rules.White {
		tokens = append(tokens, "w")
	}
	for _, entry := range game.History {
		if entry.Pass {
			tokens = append(tokens, PassToken)
		} else {
			tokens = append(tokens, SerializeMove(entry.Move))
		}
	}
	return strings.Join(tokens, " ")
}

package rules

// RecordedMove est un coup tel qu'il est rejouable depuis une partie vierge.
type RecordedMove struct {
	Shape    Shape
	Rotation int
	Flipped  bool
	Column   int // colonne d'ancrage, à partir de 0
}

// Entry est une entrée d'historique : un coup, ou une passe forcée.
type Entry struct {
	Pass bool
	Move RecordedMove
}

// ResultReason dit comment une partie s'est terminée.
type ResultReason string

const (
	ReasonConnection ResultReason = "connection"
	ReasonStalemate  ResultReason = "stalemate"
	ReasonDraw       ResultReason = "draw"
)

// Result est le verdict d'une partie finie.
type Result struct {
	Winner       Player // None pour une nulle
	Reason       ResultReason
	LargestZones [3]int // par Player, au blocage seulement
}

// Game est l'état que rejoue la notation : la partie du reducer, sans ce qui ne
// sert qu'à l'affichage.
type Game struct {
	Position
	FirstPlayer Player
	History     []Entry
	Finished    bool
	Result      *Result
}

// NewGame ouvre une partie, `first` au trait.
func NewGame(first Player) *Game {
	return &Game{Position: NewPosition(first), FirstPlayer: first}
}

// PlaceReason dit pourquoi Play refuse un coup.
type PlaceReason string

const (
	PlaceExhausted PlaceReason = "exhausted"
	PlaceGameOver  PlaceReason = "game-over"
)

// Play pose le coup pour le joueur au trait et résout la fin du coup —
// victoire, passe forcée, blocage — comme placeSelection et
// advanceAfterPlacement. Un refus ne modifie rien et rend sa raison.
func (g *Game) Play(move RecordedMove) string {
	if g.Finished {
		return string(PlaceGameOver)
	}
	player := g.Active
	if g.Inventories[player][move.Shape] == 0 {
		return string(PlaceExhausted)
	}
	orientation := NewOrientation(move.Shape, move.Rotation, move.Flipped)
	cells, reason := g.Board.CalculateDrop(&orientation, move.Column)
	if reason != DropValid {
		return string(reason)
	}
	for _, c := range cells {
		g.Board[c.Y][c.X] = player
	}
	g.Inventories[player][move.Shape]--
	g.History = append(g.History, Entry{Move: move})

	if g.Board.HasWinningConnection(player) {
		g.Finished = true
		g.Result = &Result{Winner: player, Reason: ReasonConnection}
		return ""
	}
	next := player.Other()
	switch {
	case g.Board.HasLegalMove(&g.Inventories[next]):
		g.Active = next
	case g.Board.HasLegalMove(&g.Inventories[player]):
		g.History = append(g.History, Entry{Pass: true})
	default:
		g.Finished = true
		g.Result = stalemateResult(&g.Board)
	}
	return ""
}

func stalemateResult(b *Board) *Result {
	result := &Result{Reason: ReasonDraw}
	result.LargestZones[Blue] = b.LargestZone(Blue)
	result.LargestZones[White] = b.LargestZone(White)
	switch {
	case result.LargestZones[Blue] > result.LargestZones[White]:
		result.Winner, result.Reason = Blue, ReasonStalemate
	case result.LargestZones[Blue] < result.LargestZones[White]:
		result.Winner, result.Reason = White, ReasonStalemate
	}
	return result
}

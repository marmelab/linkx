package conformance

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/book"
	"github.com/marmelab/linkx/engine-go/master"
	"github.com/marmelab/linkx/engine-go/notation"
	"github.com/marmelab/linkx/engine-go/rng"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

type criteriaJSON struct {
	Gravity     int `json:"gravity"`
	ZoneCount   int `json:"zoneCount"`
	Caps        int `json:"caps"`
	Robust      int `json:"robust"`
	Mobility    int `json:"mobility"`
	Reserve     int `json:"reserve"`
	Bar3        int `json:"bar3"`
	LargeL      int `json:"largeL"`
	TopRows     int `json:"topRows"`
	Hanging     int `json:"hanging"`
	HangingWall int `json:"hangingWall"`
	ZoneStall   int `json:"zoneStall"`
}

type weightsJSON struct {
	Primary   int `json:"primary"`
	Secondary int `json:"secondary"`
	PathWidth int `json:"pathWidth"`
	ZoneBase  int `json:"zoneBase"`
	ZoneFill  int `json:"zoneFill"`
	Tempo     int `json:"tempo"`
}

type reference struct {
	Reference string `json:"reference"`
	Games     []struct {
		Record     string `json:"record"`
		Serialized string `json:"serialized"`
		Result     *struct {
			Winner       *string        `json:"winner"`
			Reason       string         `json:"reason"`
			LargestZones map[string]int `json:"largestZones"`
		} `json:"result"`
		Positions []struct {
			Active      string   `json:"active"`
			Finished    bool     `json:"finished"`
			Legal       []string `json:"legal"`
			EngineMoves []int    `json:"engineMoves"`
			Hash        []uint32 `json:"hash"`
			Zones       []int    `json:"zones"`
			Wins        []bool   `json:"wins"`
		} `json:"positions"`
	} `json:"games"`
	Notation []struct {
		Input  string  `json:"input"`
		Output *string `json:"output"`
		Error  *struct {
			Index   int    `json:"index"`
			Token   string `json:"token"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		} `json:"error"`
	} `json:"notation"`
	Evaluation struct {
		RandomGames         [][]int      `json:"randomGames"`
		AllCriteria         criteriaJSON `json:"allCriteria"`
		CustomWeights       weightsJSON  `json:"customWeights"`
		Values              []int        `json:"values"`
		ValuesAllCriteria   []int        `json:"valuesAllCriteria"`
		ValuesCustomWeights []int        `json:"valuesCustomWeights"`
	} `json:"evaluation"`
	Search []struct {
		Record   string   `json:"record"`
		MaxNodes int64    `json:"maxNodes"`
		Seed     int64    `json:"seed"`
		Variant  string   `json:"variant"`
		Moves    []string `json:"moves"`
		PV       []string `json:"pv"`
		Score    int      `json:"score"`
		Depth    int      `json:"depth"`
		Exact    bool     `json:"exact"`
		Nodes    int64    `json:"nodes"`
		Chosen   string   `json:"chosen"`
	} `json:"search"`
	Book struct {
		Entries int `json:"entries"`
		Lookups []struct {
			Record string  `json:"record"`
			Seed   *int64  `json:"seed"`
			Move   *string `json:"move"`
		} `json:"lookups"`
	} `json:"book"`
	Master []struct {
		Record   string `json:"record"`
		Seed     int64  `json:"seed"`
		MaxNodes int64  `json:"maxNodes"`
		Move     string `json:"move"`
		FromBook bool   `json:"fromBook"`
	} `json:"master"`
}

var (
	loadOnce sync.Once
	data     reference
	loadErr  error
)

// load relit les données écrites par scripts/empreinte-go.ts.
func load(t *testing.T) *reference {
	t.Helper()
	loadOnce.Do(func() {
		raw, err := os.ReadFile("testdata/empreinte.json")
		if err != nil {
			loadErr = err
			return
		}
		loadErr = json.Unmarshal(raw, &data)
	})
	if loadErr != nil {
		t.Fatalf("données de référence illisibles : %v", loadErr)
	}
	return &data
}

func parse(t *testing.T, record string) *rules.Game {
	t.Helper()
	game, err := notation.Parse(record)
	if err != nil {
		t.Fatalf("%q : %v", record, err)
	}
	return game
}

func tokens(moves []rules.LegalMove) []string {
	out := make([]string, len(moves))
	for i, move := range moves {
		out[i] = notation.SerializeLegalMove(move)
	}
	return out
}

func moveTokens(moves []board.Move) []string {
	out := make([]string, len(moves))
	for i, move := range moves {
		out[i] = notation.SerializeLegalMove(board.ToLegalMove(move))
	}
	return out
}

func TestLegalMovesZonesAndVerdicts(t *testing.T) {
	ref := load(t)
	positions := 0
	var engine board.Position
	var buffer [board.MaxMoves]board.Move
	for _, game := range ref.Games {
		timeline, err := notation.ParseTimeline(game.Record)
		if err != nil {
			t.Fatalf("%q : %v", game.Record, err)
		}
		if len(timeline) != len(game.Positions) {
			t.Fatalf("%q : %d positions, attendu %d", game.Record, len(timeline), len(game.Positions))
		}
		final := &timeline[len(timeline)-1]
		if got := notation.Serialize(final); got != game.Serialized {
			t.Errorf("%q réécrit en %q, attendu %q", game.Record, got, game.Serialized)
		}
		if (game.Result == nil) != (final.Result == nil) {
			t.Fatalf("%q : résultat %v, attendu %v", game.Record, final.Result, game.Result)
		}
		if game.Result != nil {
			winner := "null"
			if game.Result.Winner != nil {
				winner = *game.Result.Winner
			}
			gotWinner := final.Result.Winner.String()
			if final.Result.Winner == rules.None {
				gotWinner = "null"
			}
			if gotWinner != winner || string(final.Result.Reason) != game.Result.Reason ||
				(game.Result.LargestZones != nil && (final.Result.LargestZones[rules.Blue] != game.Result.LargestZones["blue"] ||
					final.Result.LargestZones[rules.White] != game.Result.LargestZones["white"])) {
				t.Errorf("%q : résultat %+v, attendu %+v", game.Record, *final.Result, *game.Result)
			}
		}
		for k, want := range game.Positions {
			state := &timeline[k]
			positions++
			where := func() string { return fmt.Sprintf("%q après %d entrées", game.Record, k) }
			if state.Active.String() != want.Active || state.Finished != want.Finished {
				t.Fatalf("%s : trait %v fini %v, attendu %v %v", where(), state.Active, state.Finished, want.Active, want.Finished)
			}
			legal := tokens(state.Board.EnumerateLegalMoves(&state.Inventories[state.Active]))
			if !slices.Equal(legal, want.Legal) {
				t.Fatalf("%s : coups du domaine\n%v\nattendu\n%v", where(), legal, want.Legal)
			}
			engine.Load(&state.Position)
			count := engine.GenerateMoves(buffer[:])
			engineMoves := make([]int, count)
			for i := range count {
				engineMoves[i] = int(buffer[i])
			}
			if !slices.Equal(engineMoves, want.EngineMoves) {
				t.Fatalf("%s : coups du moteur %v, attendu %v", where(), engineMoves, want.EngineMoves)
			}
			if engine.HashA != want.Hash[0] || engine.HashB != want.Hash[1] {
				t.Fatalf("%s : hachage %d/%d, attendu %v", where(), engine.HashA, engine.HashB, want.Hash)
			}
			zones := []int{engine.LargestZone(board.Blue), engine.LargestZone(board.White)}
			domainZones := []int{state.Board.LargestZone(rules.Blue), state.Board.LargestZone(rules.White)}
			if !slices.Equal(zones, want.Zones) || !slices.Equal(domainZones, want.Zones) {
				t.Fatalf("%s : zones %v / %v, attendu %v", where(), zones, domainZones, want.Zones)
			}
			wins := []bool{state.Board.HasWinningConnection(rules.Blue), state.Board.HasWinningConnection(rules.White)}
			if !slices.Equal(wins, want.Wins) {
				t.Fatalf("%s : victoires %v, attendu %v", where(), wins, want.Wins)
			}
		}
	}
	t.Logf("%d parties, %d positions identiques", len(ref.Games), positions)
}

func TestNotation(t *testing.T) {
	ref := load(t)
	for _, game := range ref.Games {
		if got := notation.Serialize(parse(t, game.Serialized)); got != game.Serialized {
			t.Errorf("aller-retour de %q : %q", game.Serialized, got)
		}
	}
	for _, c := range ref.Notation {
		game, err := notation.Parse(c.Input)
		switch {
		case c.Error != nil:
			if err == nil || err.Index != c.Error.Index || err.Token != c.Error.Token || err.Reason != c.Error.Reason || err.Error() != c.Error.Message {
				t.Errorf("%q : %v, attendu le refus %+v", c.Input, err, *c.Error)
			}
		case err != nil:
			t.Errorf("%q : refus %v, attendu %q", c.Input, err, *c.Output)
		default:
			if got := notation.Serialize(game); got != *c.Output {
				t.Errorf("%q : %q, attendu %q", c.Input, got, *c.Output)
			}
		}
	}
}

// corpus rejoue le corpus de scripts/empreinte-evaluation.ts et évalue chaque
// position puis chacun de ses enfants, dans le même ordre.
func corpus(t *testing.T, ref *reference, evaluate func(*board.Position) int) []int {
	referenceTokens := strings.Fields(ref.Reference)
	var loaders []func(*board.Position)
	for moveCount := 0; moveCount <= len(referenceTokens); moveCount++ {
		game := parse(t, strings.Join(referenceTokens[:moveCount], " "))
		loaders = append(loaders, func(p *board.Position) { p.Load(&game.Position) })
	}
	empty := rules.NewPosition(rules.Blue)
	for _, steps := range ref.Evaluation.RandomGames {
		for end, step := range steps {
			if step < 0 {
				continue
			}
			replay := steps[:end+1]
			loaders = append(loaders, func(p *board.Position) {
				p.Load(&empty)
				for _, s := range replay {
					if s < 0 {
						p.FlipSide()
					} else {
						p.Apply(board.Move(s))
					}
				}
			})
		}
	}
	var values []int
	var position board.Position
	var buffer [board.MaxMoves]board.Move
	for _, loadPosition := range loaders {
		loadPosition(&position)
		values = append(values, evaluate(&position))
		count := position.GenerateMoves(buffer[:])
		for _, move := range buffer[:count] {
			position.Apply(move)
			values = append(values, evaluate(&position))
			position.Undo(move)
		}
	}
	return values
}

func compareValues(t *testing.T, name string, got, want []int) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s : %d valeurs, attendu %d", name, len(got), len(want))
	}
	differ := 0
	for i := range got {
		if got[i] != want[i] {
			if differ < 5 {
				t.Errorf("%s : valeur %d vaut %d, attendu %d", name, i, got[i], want[i])
			}
			differ++
		}
	}
	if differ > 0 {
		t.Fatalf("%s : %d valeurs sur %d diffèrent", name, differ, len(want))
	}
	t.Logf("%s : %d valeurs identiques", name, len(want))
}

func TestEvaluation(t *testing.T) {
	ref := load(t)
	evaluator := search.NewSearcher().Evaluator()
	compareValues(t, "critères du maître", corpus(t, ref, evaluator.Evaluate), ref.Evaluation.Values)

	all := search.Criteria(ref.Evaluation.AllCriteria)
	compareValues(t, "tous les critères", corpus(t, ref, func(p *board.Position) int {
		return evaluator.EvaluateWith(p, &all, &search.DefaultWeights)
	}), ref.Evaluation.ValuesAllCriteria)

	weights := search.Weights(ref.Evaluation.CustomWeights)
	compareValues(t, "autres poids", corpus(t, ref, func(p *board.Position) int {
		return evaluator.EvaluateWith(p, &search.DefaultCriteria, &weights)
	}), ref.Evaluation.ValuesCustomWeights)
}

func TestSearch(t *testing.T) {
	ref := load(t)
	all := search.Criteria(ref.Evaluation.AllCriteria)
	weights := search.Weights(ref.Evaluation.CustomWeights)
	searcher := search.NewSearcher()
	var nodes int64
	for _, c := range ref.Search {
		position := &parse(t, c.Record).Position
		options := search.Options{MaxNodes: c.MaxNodes}
		switch c.Variant {
		case "reduce":
			options.Reduce = true
		case "evenDepth":
			options.SkipOddDepth = true
		case "keepPartial":
			options.KeepPartial = true
		case "allCriteria":
			options.Criteria = &all
		case "customWeights":
			options.Weights = &weights
		case "":
		default:
			t.Fatalf("réglage inconnu %q", c.Variant)
		}
		top := searcher.TopMoves(position, options)
		got := moveTokens(top.Moves)
		pv := moveTokens(top.PV)
		if !slices.Equal(got, c.Moves) || !slices.Equal(pv, c.PV) || top.Score != c.Score ||
			top.Depth != c.Depth || top.Exact != c.Exact || top.Nodes != c.Nodes {
			t.Errorf("%q à %d nœuds %s : coups %v pv %v score %d prof. %d exact %v nœuds %d ; attendu %v %v %d %d %v %d",
				c.Record, c.MaxNodes, c.Variant, got, pv, top.Score, top.Depth, top.Exact, top.Nodes,
				c.Moves, c.PV, c.Score, c.Depth, c.Exact, c.Nodes)
			continue
		}
		options.Random = rng.Mulberry32(uint32(c.Seed))
		if chosen := notation.SerializeLegalMove(searcher.Choose(position, options).Move); chosen != c.Chosen {
			t.Errorf("%q à %d nœuds : tirage %s, attendu %s", c.Record, c.MaxNodes, chosen, c.Chosen)
		}
		nodes += top.Nodes
	}
	t.Logf("%d recherches identiques, %d nœuds au total", len(ref.Search), nodes)
}

func TestBook(t *testing.T) {
	ref := load(t)
	if len(book.Opening) != ref.Book.Entries {
		t.Fatalf("livre de %d entrées, attendu %d : relancer go generate ./book", len(book.Opening), ref.Book.Entries)
	}
	hits := 0
	for _, c := range ref.Book.Lookups {
		var random func() float64
		if c.Seed != nil {
			random = rng.Mulberry32(uint32(*c.Seed))
		}
		move := book.Opening.Lookup(&parse(t, c.Record).Position, random)
		got := "null"
		if move != nil {
			got = notation.SerializeLegalMove(*move)
			hits++
		}
		want := "null"
		if c.Move != nil {
			want = *c.Move
		}
		if got != want {
			t.Errorf("%q graine %v : %s, attendu %s", c.Record, c.Seed, got, want)
		}
	}
	t.Logf("%d lectures identiques, dont %d dans le livre", len(ref.Book.Lookups), hits)
}

func TestMasterEntry(t *testing.T) {
	ref := load(t)
	player := master.NewPlayer()
	for _, c := range ref.Master {
		options := master.Options{Book: true}
		options.MaxNodes = c.MaxNodes
		options.Random = rng.Mulberry32(uint32(c.Seed))
		decision := player.Choose(&parse(t, c.Record).Position, options)
		if got := notation.SerializeLegalMove(decision.Move); got != c.Move || decision.FromBook != c.FromBook {
			t.Errorf("%q : %s (livre %v), attendu %s (livre %v)", c.Record, got, decision.FromBook, c.Move, c.FromBook)
		}
	}
}

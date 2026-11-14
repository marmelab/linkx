package mcts

import (
	"testing"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/rng"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

// randomLine joue une partie au hasard et rend les positions traversées, la
// dernière comprise, ainsi que son issue.
func randomLine(seed uint32) ([]board.Position, int) {
	random := rng.Mulberry32(seed)
	var p board.Position
	start := rules.NewPosition(rules.Blue)
	p.Load(&start)
	var moves [board.MaxMoves]board.Move
	line := []board.Position{p}
	for {
		count := p.GenerateMoves(moves[:])
		m := moves[int(random()*float64(count))]
		mover := p.Side
		p.Apply(m)
		finished, winner := outcome(&p, m, mover)
		if finished {
			return line, winner
		}
		line = append(line, p)
	}
}

func recorded(m board.Move) rules.RecordedMove {
	legal := board.ToLegalMove(m)
	return rules.RecordedMove{
		Shape:    legal.Shape,
		Rotation: legal.Orientation.Rotation,
		Flipped:  legal.Orientation.Flipped,
		Column:   legal.Column,
	}
}

func TestWinsMatchesBoard(t *testing.T) {
	var moves [board.MaxMoves]board.Move
	checked, winning := 0, 0
	for seed := range uint32(60) {
		line, _ := randomLine(seed)
		for _, p := range line {
			zones := zonesOf(p.Bits[p.Side-1])
			count := p.GenerateMoves(moves[:])
			for _, m := range moves[:count] {
				q := p
				q.Apply(m)
				want := q.MovePlacedWins(m, p.Side)
				if zones.wins(m) != want {
					t.Fatalf("graine %d, coup %v : wins %v, board %v", seed, m, !want, want)
				}
				placed := q.Bits[p.Side-1]
				cells := moveShapes[m].cells
				if cells.And(placed) != cells || cells.And(p.Bits[p.Side-1]).Count() != 0 {
					t.Fatalf("cases du coup %v fausses", m)
				}
				checked++
				if want {
					winning++
				}
			}
		}
	}
	if winning == 0 {
		t.Fatal("aucun coup gagnant rencontré")
	}
	t.Logf("%d coups vérifiés, %d gagnants", checked, winning)
}

func TestEncodeRoundTrip(t *testing.T) {
	var moves [board.MaxMoves]board.Move
	line, _ := randomLine(7)
	for _, p := range line {
		count := p.GenerateMoves(moves[:])
		for _, m := range moves[:count] {
			if got := encode(board.ToLegalMove(m)); got != m {
				t.Fatalf("encode(%v) = %v", m, got)
			}
		}
	}
}

func quick(iterations int) Options {
	params := DefaultParams
	return Options{MaxIterations: iterations, Params: params}
}

func TestSelfPlayIsLegal(t *testing.T) {
	player := NewPlayer()
	for seed := range uint32(4) {
		game := rules.NewGame(rules.Blue)
		options := quick(400)
		options.Book = true
		options.Threads = 1 + int(seed%2)
		for turn := 0; !game.Finished; turn++ {
			if turn > 40 {
				t.Fatal("partie trop longue")
			}
			options.Seed = seed*1000 + uint32(turn)
			decision := player.Choose(&game.Position, options)
			if decision == nil {
				t.Fatal("aucun coup alors que la partie continue")
			}
			if reason := game.Play(recorded(decision.Move)); reason != "" {
				t.Fatalf("graine %d, demi-coup %d : coup refusé (%s)", seed, turn, reason)
			}
		}
	}
}

func TestDeterministicAtFixedIterations(t *testing.T) {
	line, _ := randomLine(3)
	source := toRules(&line[4])
	for _, threads := range []int{1, 3} {
		options := quick(3000)
		options.Threads = threads
		options.Seed = 42
		a := NewPlayer().Choose(&source, options)
		player := NewPlayer()
		player.Choose(&source, quick(500))
		b := player.Choose(&source, options)
		if *a != *b {
			t.Fatalf("%d fils : %+v puis %+v", threads, *a, *b)
		}
		if a.Iterations != 3000 {
			t.Fatalf("%d itérations au lieu de 3000", a.Iterations)
		}
	}
}

// tacticalPositions rend des positions de parties au hasard, au trait d'un
// joueur qui gagne en un coup (wins), ou qui ne gagne pas mais doit parer une
// victoire adverse en un coup, avec au moins une parade et un coup qui n'en
// est pas une (parries).
func tacticalPositions(limit int) (wins, parries []board.Position) {
	var buffer, moves [board.MaxMoves]board.Move
	for seed := uint32(100); len(wins) < limit || len(parries) < limit; seed++ {
		line, _ := randomLine(seed)
		for _, p := range line {
			if hasImmediateWin(&p, buffer[:]) {
				if len(wins) < limit {
					wins = append(wins, p)
				}
				continue
			}
			if !opponentThreatens(&p, buffer[:]) {
				continue
			}
			parry, fail := false, false
			count := p.GenerateMoves(moves[:])
			for _, m := range moves[:count] {
				if leavesWin(&p, m, buffer[:]) {
					fail = true
				} else {
					parry = true
				}
			}
			if parry && fail && len(parries) < limit {
				parries = append(parries, p)
			}
		}
	}
	return wins, parries
}

func leavesWin(p *board.Position, m board.Move, buffer []board.Move) bool {
	q := *p
	q.Apply(m)
	if finished, _ := outcome(&q, m, p.Side); finished {
		return false
	}
	return q.Side != p.Side && hasImmediateWin(&q, buffer)
}

func TestFindsWinAndParriesThreat(t *testing.T) {
	wins, parries := tacticalPositions(20)
	player := NewPlayer()
	options := quick(200)
	// Sans l'alpha-bêta de la racine : c'est l'arbre qu'on teste.
	options.Params.RootSolveNodes = 0
	for i, p := range wins {
		source := toRules(&p)
		decision := player.Choose(&source, options)
		q := p
		q.Apply(decision.Move)
		if !q.MovePlacedWins(decision.Move, p.Side) {
			t.Fatalf("position gagnante %d : %v ne gagne pas", i, decision.Move)
		}
		if decision.Proof != int8(p.Side) {
			t.Fatalf("position gagnante %d : non prouvée", i)
		}
	}
	var buffer [board.MaxMoves]board.Move
	for i, p := range parries {
		source := toRules(&p)
		decision := player.Choose(&source, options)
		if leavesWin(&p, decision.Move, buffer[:]) {
			t.Fatalf("menace %d : %v laisse gagner l'adversaire", i, decision.Move)
		}
	}
}

func TestSolverAgreesWithAlphaBeta(t *testing.T) {
	searcher := search.NewSearcher()
	player := NewPlayer()
	options := quick(20_000)
	options.Params.RootSolveNodes = 0
	options.Params.SolvePlies = 0
	proven, total := 0, 0
	for seed := uint32(500); total < 30; seed++ {
		line, _ := randomLine(seed)
		if len(line) < 6 {
			continue
		}
		p := line[len(line)-4]
		source := toRules(&p)
		reference := searcher.TopMoves(&source, search.Options{MaxNodes: 3_000_000})
		if !reference.Exact {
			continue
		}
		want := int8(Draw)
		switch {
		case reference.Score > search.MateThreshold:
			want = int8(p.Side)
		case reference.Score < -search.MateThreshold:
			want = other(int8(p.Side))
		case reference.Score != 0:
			continue
		}
		total++
		decision := player.Choose(&source, options)
		if decision.Proof == Unknown {
			continue
		}
		proven++
		if decision.Proof != want {
			t.Fatalf("graine %d : MCTS prouve %d, alpha-bêta %d", seed, decision.Proof, want)
		}
		if want == int8(p.Side) {
			q := p
			q.Apply(decision.Move)
			if finished, winner := outcome(&q, decision.Move, p.Side); finished && winner != p.Side {
				t.Fatalf("graine %d : le coup prouvé gagnant perd", seed)
			}
		}
	}
	if proven < total/2 {
		t.Fatalf("seulement %d fins prouvées sur %d", proven, total)
	}
	t.Logf("%d fins prouvées sur %d, toutes conformes", proven, total)
}

func TestEndgameSolveInjectsProof(t *testing.T) {
	searcher := search.NewSearcher()
	player := NewPlayer()
	options := quick(50)
	options.Params.RootSolveNodes = 0
	options.Params.SolvePlies = 40
	options.Params.SolveNodes = 200_000
	checked := 0
	for seed := uint32(900); checked < 10; seed++ {
		line, _ := randomLine(seed)
		if len(line) < 8 {
			continue
		}
		p := line[len(line)-6]
		source := toRules(&p)
		reference := searcher.TopMoves(&source, search.Options{MaxNodes: 200_000})
		if !reference.Exact || (reference.Score != 0 && abs(reference.Score) <= search.MateThreshold) {
			continue
		}
		checked++
		decision := player.Choose(&source, options)
		want := int8(Draw)
		if reference.Score > search.MateThreshold {
			want = int8(p.Side)
		} else if reference.Score < -search.MateThreshold {
			want = other(int8(p.Side))
		}
		if decision.Proof != want {
			t.Fatalf("graine %d : preuve %d, attendu %d", seed, decision.Proof, want)
		}
	}
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func TestRootSolverShortCircuits(t *testing.T) {
	wins, _ := tacticalPositions(3)
	player := NewPlayer()
	for _, p := range wins {
		source := toRules(&p)
		decision := player.Choose(&source, quick(1000))
		if !decision.FromSolver || decision.Iterations != 0 || decision.Proof != int8(p.Side) {
			t.Fatalf("gain en un coup non tranché par l'alpha-bêta de la racine : %+v", *decision)
		}
	}
}

func TestParallelRootSumsVisits(t *testing.T) {
	line, _ := randomLine(11)
	source := toRules(&line[2])
	options := quick(4000)
	options.Threads = 4
	options.Seed = 9
	decision := NewPlayer().Choose(&source, options)
	if decision.Iterations != 4000 {
		t.Fatalf("%d itérations", decision.Iterations)
	}
	if decision.Visits <= 0 || decision.Visits > 4000 {
		t.Fatalf("%d visites du coup choisi", decision.Visits)
	}
}

func TestAllocateCrossesBlocks(t *testing.T) {
	tr := &tree{}
	for range 3 * blockSize / 90 {
		first := tr.allocate(90)
		if int(first&(blockSize-1))+90 > blockSize || int(first>>blockBits) >= len(tr.blocks) {
			t.Fatalf("bloc mal réservé à %d", first)
		}
	}
	tr.used = blockSize
	if first := tr.allocate(10); first != blockSize || len(tr.blocks) < 2 {
		t.Fatalf("frontière de bloc : %d, %d blocs", first, len(tr.blocks))
	}
}

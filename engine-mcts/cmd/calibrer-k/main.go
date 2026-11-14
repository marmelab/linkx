// Commande calibrer-k : ajuste l'échelle K de la sigmoïde qui convertit
// l'évaluation du maître en probabilité de gain (méthode Texel, à un seul
// paramètre). Lit des journaux de duel (JSONL, champs record et winnerColor,
// ceux de scripts/duel-go.ts), évalue chaque position en cours du point de vue
// du joueur au trait et maximise la vraisemblance de l'issue, une nulle
// comptant ½.
//
//	go run ./cmd/calibrer-k duel-a.jsonl duel-b.jsonl
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/notation"
	"github.com/marmelab/linkx/engine-go/rules"
	"github.com/marmelab/linkx/engine-go/search"
)

type sample struct {
	eval    float64
	outcome float64
	game    int
}

type game struct {
	Record      string  `json:"record"`
	WinnerColor *string `json:"winnerColor"`
}

func load(paths []string) ([]sample, int) {
	var samples []sample
	var evaluator search.Evaluator
	games := 0
	seen := map[string]bool{}
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			panic(err)
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 1<<20), 1<<20)
		for scanner.Scan() {
			var g game
			if json.Unmarshal(scanner.Bytes(), &g) != nil || g.Record == "" || seen[g.Record] {
				continue
			}
			seen[g.Record] = true
			states, parseErr := notation.ParseTimeline(g.Record)
			if parseErr != nil {
				panic(parseErr)
			}
			games++
			winner := rules.None
			if g.WinnerColor != nil && *g.WinnerColor == "blue" {
				winner = rules.Blue
			} else if g.WinnerColor != nil && *g.WinnerColor == "white" {
				winner = rules.White
			}
			for ply, state := range states {
				if state.Finished || ply == 0 {
					continue
				}
				var p board.Position
				p.Load(&state.Position)
				outcome := 0.5
				if winner != rules.None {
					outcome = 0
					if winner == state.Active {
						outcome = 1
					}
				}
				samples = append(samples, sample{float64(evaluator.Evaluate(&p)), outcome, games})
			}
		}
		file.Close()
	}
	return samples, games
}

// loss est l'entropie croisée moyenne de sigmoïde((éval − offset)/k).
func loss(samples []sample, k, offset float64) float64 {
	total := 0.0
	for _, s := range samples {
		p := 1 / (1 + math.Exp(-(s.eval-offset)/k))
		p = min(max(p, 1e-9), 1-1e-9)
		total -= s.outcome*math.Log(p) + (1-s.outcome)*math.Log(1-p)
	}
	return total / float64(len(samples))
}

// golden minimise f sur [lo, hi] par la section dorée.
func golden(f func(float64) float64, lo, hi float64) float64 {
	ratio := (math.Sqrt(5) - 1) / 2
	a, b := lo, hi
	for b-a > 1e-3*(hi-lo) {
		c, d := b-ratio*(b-a), a+ratio*(b-a)
		if f(c) < f(d) {
			b = d
		} else {
			a = c
		}
	}
	return (a + b) / 2
}

func main() {
	samples, games := load(os.Args[1:])
	var train, test []sample
	// Un tiers des parties tenu à part : leurs positions sont corrélées.
	for _, s := range samples {
		if s.game%3 == 2 {
			test = append(test, s)
		} else {
			train = append(train, s)
		}
	}
	fit := func(offset float64) float64 {
		return math.Exp(golden(func(logK float64) float64 { return loss(train, math.Exp(logK), offset) }, math.Log(50), math.Log(50_000)))
	}
	k := fit(0)
	fmt.Printf("%d parties, %d positions (%d d'ajustement, %d de test)\n", games, len(samples), len(train), len(test))
	fmt.Printf("K = %.0f : entropie croisée %.4f en ajustement, %.4f en test (constante : %.4f)\n",
		k, loss(train, k, 0), loss(test, k, 0), loss(test, math.Inf(1), 0))
	offset := golden(func(o float64) float64 { return loss(train, k, o) }, -3000, 3000)
	fmt.Printf("décalage libre : %.0f points (TEMPO = %d), entropie de test %.4f\n", offset, search.Tempo, loss(test, k, offset))
	kNoTempo := fit(search.Tempo)
	fmt.Printf("sans TEMPO : K = %.0f, entropie de test %.4f\n", kNoTempo, loss(test, kNoTempo, search.Tempo))
	fmt.Println("calibration (test) : tranche de probabilité prédite, effectif, fréquence observée")
	var count [10]int
	var sum [10]float64
	for _, s := range test {
		p := 1 / (1 + math.Exp(-s.eval/k))
		bucket := min(int(p*10), 9)
		count[bucket]++
		sum[bucket] += s.outcome
	}
	for b := range count {
		if count[b] > 0 {
			fmt.Printf("  [%.1f, %.1f) %5d  %.3f\n", float64(b)/10, float64(b+1)/10, count[b], sum[b]/float64(count[b]))
		}
	}
}

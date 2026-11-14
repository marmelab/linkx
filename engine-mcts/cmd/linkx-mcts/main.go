// Commande linkx-mcts : le MCTS hybride en processus longue durée, au même
// protocole que linkx-maitre. Une requête JSON par ligne sur l'entrée, une
// réponse par ligne sur la sortie, vidée aussitôt.
//
//	{"record": "4Lsr21 4Ss3", "budgetMs": 2500, "seed": 123, "book": true, "threads": 1, "params": {"c": 1.5}}
//	{"move": "4Lsr32", "iterations": 182000, "visits": 41000, "value": 0.61, "proven": "aucun", "elapsedMs": 2452, "fromBook": false}
//
// maxIterations positif borne aux itérations sans lire l'horloge ; sinon
// budgetMs borne au temps (2 500 ms par défaut). maxNodes, que le maître
// comprend, est ignoré. params remplace, champ par champ, les réglages par
// défaut. proven vaut gain, perte, nulle ou aucun, pour le joueur au trait.
// Une erreur rend {"error": "…"}.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/marmelab/linkx/engine-go/board"
	"github.com/marmelab/linkx/engine-go/notation"
	"github.com/marmelab/linkx/engine-mcts/mcts"
)

type request struct {
	Record        string          `json:"record"`
	BudgetMs      float64         `json:"budgetMs"`
	MaxIterations int             `json:"maxIterations"`
	Seed          *int64          `json:"seed"`
	Book          bool            `json:"book"`
	Threads       int             `json:"threads"`
	Params        json.RawMessage `json:"params"`
}

type response struct {
	Move       string  `json:"move"`
	Iterations int     `json:"iterations"`
	Visits     int     `json:"visits"`
	Value      float64 `json:"value"`
	Proven     string  `json:"proven"`
	FromBook   bool    `json:"fromBook"`
	FromSolver bool    `json:"fromSolver"`
	Nodes      int     `json:"nodes"`
	Solves     int     `json:"solves"`
	ElapsedMs  int64   `json:"elapsedMs"`
}

type failure struct {
	Error string `json:"error"`
}

func provenLabel(proof, side int8) string {
	switch proof {
	case mcts.Unknown:
		return "aucun"
	case mcts.Draw:
		return "nulle"
	case side:
		return "gain"
	}
	return "perte"
}

func answer(player *mcts.Player, line []byte, threads int) (any, error) {
	req := request{Threads: threads}
	if err := json.Unmarshal(line, &req); err != nil {
		return nil, fmt.Errorf("requête illisible : %w", err)
	}
	params := mcts.DefaultParams
	if len(req.Params) > 0 {
		decoder := json.NewDecoder(bytes.NewReader(req.Params))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&params); err != nil {
			return nil, fmt.Errorf("params illisibles : %w", err)
		}
	}
	game, parseErr := notation.Parse(req.Record)
	if parseErr != nil {
		return nil, parseErr
	}
	if game.Finished {
		return nil, errors.New("la partie est déjà terminée")
	}
	options := mcts.Options{
		BudgetMs:      req.BudgetMs,
		MaxIterations: req.MaxIterations,
		Threads:       req.Threads,
		Book:          req.Book,
		Params:        params,
	}
	if req.Seed != nil {
		options.Seed = uint32(*req.Seed)
	}
	start := time.Now()
	decision := player.Choose(&game.Position, options)
	elapsed := time.Since(start).Milliseconds()
	if decision == nil {
		return response{Move: notation.PassToken, Proven: "aucun", ElapsedMs: elapsed}, nil
	}
	return response{
		Move:       notation.SerializeLegalMove(board.ToLegalMove(decision.Move)),
		Iterations: decision.Iterations,
		Visits:     decision.Visits,
		Value:      decision.Value,
		Proven:     provenLabel(decision.Proof, int8(game.Active)),
		FromBook:   decision.FromBook,
		FromSolver: decision.FromSolver,
		Nodes:      decision.Nodes,
		Solves:     decision.Solves,
		ElapsedMs:  elapsed,
	}, nil
}

func serve(in io.Reader, out io.Writer, threads int) error {
	player := mcts.NewPlayer()
	reader := bufio.NewReaderSize(in, 1<<16)
	writer := bufio.NewWriter(out)
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			result, err := answer(player, line, threads)
			if err != nil {
				result = failure{Error: err.Error()}
			}
			if err := encoder.Encode(result); err != nil {
				return err
			}
			if err := writer.Flush(); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			return nil
		}
		if readErr != nil {
			return readErr
		}
	}
}

func main() {
	threads := flag.Int("threads", 1, "fils par défaut d'une requête sans champ threads")
	flag.Parse()
	if err := serve(os.Stdin, os.Stdout, *threads); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

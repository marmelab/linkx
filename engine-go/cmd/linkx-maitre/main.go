// Commande linkx-maitre : le maître en processus longue durée. Une requête JSON
// par ligne sur l'entrée standard, une réponse JSON par ligne sur la sortie.
//
//	{"record": "4Lsr21 4Ss3", "budgetMs": 2500, "maxNodes": 0, "seed": 123, "book": true}
//	{"move": "4Lsr32", "depth": 6, "nodes": 1305375, "score": 662, "exact": false, "fromBook": false, "elapsedMs": 2240}
//
// maxNodes positif borne la recherche aux nœuds sans lire l'horloge ; sinon
// budgetMs la borne au temps (2 500 ms par défaut). seed, s'il est fourni,
// alimente le tirage parmi les ex æquo. Une erreur rend {"error": "…"}.
package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/marmelab/linkx/engine-go/master"
	"github.com/marmelab/linkx/engine-go/notation"
	"github.com/marmelab/linkx/engine-go/rng"
	"github.com/marmelab/linkx/engine-go/search"
)

type request struct {
	Record   string  `json:"record"`
	BudgetMs float64 `json:"budgetMs"`
	MaxNodes int64   `json:"maxNodes"`
	Seed     *int64  `json:"seed"`
	Book     bool    `json:"book"`
}

type response struct {
	Move      string `json:"move"`
	Depth     int    `json:"depth"`
	Nodes     int64  `json:"nodes"`
	Score     int    `json:"score"`
	Exact     bool   `json:"exact"`
	FromBook  bool   `json:"fromBook"`
	ElapsedMs int64  `json:"elapsedMs"`
}

type failure struct {
	Error string `json:"error"`
}

func answer(player *master.Player, line []byte) (any, error) {
	var req request
	if err := json.Unmarshal(line, &req); err != nil {
		return nil, fmt.Errorf("requête illisible : %w", err)
	}
	game, parseErr := notation.Parse(req.Record)
	if parseErr != nil {
		return nil, parseErr
	}
	if game.Finished {
		return nil, errors.New("la partie est déjà terminée")
	}
	options := master.Options{
		Options: search.Options{BudgetMs: req.BudgetMs, MaxNodes: req.MaxNodes},
		Book:    req.Book,
	}
	if req.Seed != nil {
		options.Random = rng.Mulberry32(uint32(*req.Seed))
	}
	start := time.Now()
	decision := player.Choose(&game.Position, options)
	elapsed := time.Since(start).Milliseconds()
	// Le rejeu applique toute passe forcée : le joueur au trait d'une partie
	// en cours a toujours un coup, et ce cas ne se présente pas en pratique.
	if decision == nil {
		return response{Move: notation.PassToken, ElapsedMs: elapsed}, nil
	}
	return response{
		Move:      notation.SerializeLegalMove(decision.Move),
		Depth:     decision.Depth,
		Nodes:     decision.Nodes,
		Score:     decision.Score,
		Exact:     decision.Exact,
		FromBook:  decision.FromBook,
		ElapsedMs: elapsed,
	}, nil
}

func serve(in io.Reader, out io.Writer) error {
	player := master.NewPlayer()
	reader := bufio.NewReaderSize(in, 1<<16)
	writer := bufio.NewWriter(out)
	encoder := json.NewEncoder(writer)
	encoder.SetEscapeHTML(false)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 && len(trimSpace(line)) > 0 {
			result, err := answer(player, line)
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

func trimSpace(line []byte) []byte {
	start, end := 0, len(line)
	for start < end && (line[start] == ' ' || line[start] == '\t' || line[start] == '\r' || line[start] == '\n') {
		start++
	}
	for end > start && (line[end-1] == ' ' || line[end-1] == '\t' || line[end-1] == '\r' || line[end-1] == '\n') {
		end--
	}
	return line[start:end]
}

func main() {
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

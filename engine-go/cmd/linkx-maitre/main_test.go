package main

import (
	"bufio"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestServeAnswersOneLinePerRequest(t *testing.T) {
	requests := strings.Join([]string{
		`{"record": "4Lsr21 4Ss3", "maxNodes": 20000, "seed": 1}`,
		``,
		`{"record": "w", "book": true, "seed": 3, "maxNodes": 1000}`,
		`{"record": "15 15 15 15 15"}`,
		`pas du JSON`,
	}, "\n")
	var out strings.Builder
	if err := serve(strings.NewReader(requests), &out, 1); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("%d réponses, attendu 4 : %q", len(lines), out.String())
	}

	var searched response
	if err := json.Unmarshal([]byte(lines[0]), &searched); err != nil || searched.Move == "" || searched.FromBook || searched.Nodes == 0 || searched.Nodes > 20000 {
		t.Errorf("recherche : %s (%v)", lines[0], err)
	}
	var booked response
	if err := json.Unmarshal([]byte(lines[1]), &booked); err != nil || !booked.FromBook || booked.Nodes != 0 {
		t.Errorf("livre : %s (%v)", lines[1], err)
	}
	for _, line := range lines[2:] {
		var failed failure
		if err := json.Unmarshal([]byte(line), &failed); err != nil || failed.Error == "" {
			t.Errorf("erreur attendue : %s", line)
		}
	}
}

// Le champ threads l'emporte sur le drapeau ; au temps, totalNodes compte les aides.
func TestServeThreads(t *testing.T) {
	requests := `{"record": "4Lsr21 4Ss3", "budgetMs": 100}` + "\n" + `{"record": "4Lsr21 4Ss3", "budgetMs": 100, "threads": 1}`
	var out strings.Builder
	if err := serve(strings.NewReader(requests), &out, 3); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	var parallel, single response
	if len(lines) != 2 || json.Unmarshal([]byte(lines[0]), &parallel) != nil || json.Unmarshal([]byte(lines[1]), &single) != nil {
		t.Fatalf("réponses %q", out.String())
	}
	if parallel.TotalNodes <= parallel.Nodes || single.TotalNodes < single.Nodes {
		t.Errorf("trois fils : %s ; un fil : %s", lines[0], lines[1])
	}
}

// Une réponse sort dès sa ligne traitée, sans attendre la fin de l'entrée.
func TestServeFlushesEachAnswer(t *testing.T) {
	inReader, inWriter := io.Pipe()
	outReader, outWriter := io.Pipe()
	done := make(chan error, 1)
	go func() { done <- serve(inReader, outWriter, 1) }()
	go inWriter.Write([]byte(`{"record": "", "maxNodes": 5000}` + "\n"))
	line, err := bufio.NewReader(outReader).ReadString('\n')
	if err != nil || !strings.Contains(line, `"move"`) {
		t.Fatalf("réponse %q (%v)", line, err)
	}
	inWriter.Close()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

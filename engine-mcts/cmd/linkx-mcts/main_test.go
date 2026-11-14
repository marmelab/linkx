package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestServeAnswersOneLinePerRequest(t *testing.T) {
	requests := strings.Join([]string{
		`{"record": "4Lsr21 4Ss3", "maxIterations": 2000, "seed": 1, "params": {"c": 2.5, "a": 3}}`,
		``,
		`{"record": "w", "book": true, "seed": 3, "maxIterations": 100}`,
		`{"record": "4Lsr21 4Ss3", "maxIterations": 2000, "seed": 1, "threads": 2}`,
		`{"record": "15 15 15 15 15"}`,
		`{"record": "4Lsr21", "params": {"inconnu": 1}}`,
		`pas du JSON`,
	}, "\n")
	var out strings.Builder
	if err := serve(strings.NewReader(requests), &out, 1); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(out.String(), "\n"), "\n")
	if len(lines) != 6 {
		t.Fatalf("%d réponses, attendu 6 : %q", len(lines), out.String())
	}
	var searched response
	if err := json.Unmarshal([]byte(lines[0]), &searched); err != nil || searched.Move == "" || searched.FromBook ||
		searched.Iterations != 2000 || searched.Visits == 0 || searched.Proven != "aucun" || searched.Value <= 0 || searched.Value >= 1 {
		t.Errorf("recherche : %s (%v)", lines[0], err)
	}
	var booked response
	if err := json.Unmarshal([]byte(lines[1]), &booked); err != nil || !booked.FromBook || booked.Iterations != 0 {
		t.Errorf("livre : %s (%v)", lines[1], err)
	}
	var parallel response
	if err := json.Unmarshal([]byte(lines[2]), &parallel); err != nil || parallel.Iterations != 2000 {
		t.Errorf("deux fils : %s (%v)", lines[2], err)
	}
	for _, line := range lines[3:] {
		var failed failure
		if err := json.Unmarshal([]byte(line), &failed); err != nil || failed.Error == "" {
			t.Errorf("erreur attendue : %s", line)
		}
	}
}

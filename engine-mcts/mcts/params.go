package mcts

// Params règle la recherche. Le zéro d'un champ ne vaut pas défaut :
// partir de DefaultParams et n'en changer que ce qu'on mesure.
type Params struct {
	// C pondère l'exploration PUCT : Q + C·P·√N/(1+n).
	C float64 `json:"c"`
	// K est l'échelle de la sigmoïde qui convertit l'évaluation du maître en
	// probabilité de gain du joueur au trait.
	K float64 `json:"k"`
	// Temperature divise les logits du prior avant le softmax.
	Temperature float64 `json:"temperature"`
	// WidenA et WidenB : un nœud visité N fois n'ouvre que ses
	// ceil(WidenA·(N+1)^WidenB) meilleurs coups selon le prior.
	WidenA float64 `json:"a"`
	WidenB float64 `json:"b"`
	// Poids des logits du prior : cases posées, voisines à soi, voisines à
	// l'adversaire.
	SizeWeight  float64 `json:"size"`
	OwnWeight   float64 `json:"own"`
	OtherWeight float64 `json:"other"`
	// FPU retranche à la valeur du parent celle d'un coup jamais visité.
	FPU float64 `json:"fpu"`
	// RootSolveNodes plafonne la recherche alpha-bêta lancée à la racine
	// avant le MCTS ; si elle prouve la valeur, son coup est joué. 0 l'ôte.
	RootSolveNodes int64 `json:"rootSolveNodes"`
	// SolvePlies : un nœud développé à SolvePlies demi-coups restants ou
	// moins est résolu par l'alpha-bêta, plafonné à SolveNodes nœuds.
	SolvePlies int `json:"solvePlies"`
	// SolveVisits : un nœud qui atteint ce nombre de visites est soumis à la
	// même résolution. 0 l'ôte.
	SolveVisits int32 `json:"solveVisits"`
	SolveNodes  int64 `json:"solveNodes"`
	// Noise perturbe les logits des fils d'aide, pour que les arbres du
	// parallélisme à la racine diffèrent. Le fil 0 n'en a jamais.
	Noise float64 `json:"noise"`
	// MarginMs est retranché au budget de temps.
	MarginMs float64 `json:"marginMs"`
	// CheckEvery : l'horloge est lue toutes les CheckEvery itérations.
	CheckEvery int `json:"checkEvery"`
}

// DefaultParams sont les réglages retenus ; leur mesure est dans
// .claude/rules/moteur-mcts.md.
var DefaultParams = Params{
	C:              3,
	K:              1900,
	Temperature:    1,
	WidenA:         2,
	WidenB:         0.4,
	SizeWeight:     1,
	OwnWeight:      0.3,
	OtherWeight:    0.3,
	FPU:            0,
	RootSolveNodes: 20_000,
	SolvePlies:     4,
	SolveVisits:    0,
	SolveNodes:     3_000,
	Noise:          0.5,
	MarginMs:       50,
	CheckEvery:     32,
}

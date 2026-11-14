package rng

import "testing"

// Valeurs relevées sous Node avec seededRandom de scripts/duel-appariee.ts.
func TestMulberry32MatchesTypeScript(t *testing.T) {
	cases := []struct {
		seed int64
		want []float64
	}{
		{123, []float64{0.7872516233474016, 0.1785435655619949, 0.49531551403924823, 0.23136196262203157}},
		{-5, []float64{0.48384718922898173, 0.05296749505214393, 0.9390332337934524, 0.7963776015676558}},
		{0xdeadbeef, []float64{0.9413696140982211, 0.26719574979506433, 0.772033357527107, 0.35816076025366783}},
	}
	for _, c := range cases {
		random := Mulberry32(uint32(c.seed))
		for i, want := range c.want {
			if got := random(); got != want {
				t.Errorf("graine %d, tirage %d : %v, attendu %v", c.seed, i, got, want)
			}
		}
	}
}

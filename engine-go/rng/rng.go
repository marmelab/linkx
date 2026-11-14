// Package rng porte le générateur graine des scripts de duel
// (mulberry32 de scripts/duel-appariee.ts) : à graine égale, il rend la même
// suite que le TS, donc le même tirage parmi les ex æquo.
package rng

// Mulberry32 rend un générateur de flottants dans [0, 1).
func Mulberry32(seed uint32) func() float64 {
	state := seed
	return func() float64 {
		state += 0x6d2b79f5
		t := state
		t = (t ^ t>>15) * (t | 1)
		t ^= t + (t^t>>7)*(t|61)
		return float64(t^t>>14) / 4_294_967_296
	}
}

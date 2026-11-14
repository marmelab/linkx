// Package bitboard porte bitboard.ts : les 81 cases en trois mots de 27 bits,
// trois lignes par mot, la case (x, y) au bit y*9+x du mot y/3.
package bitboard

import "math/bits"

const (
	size     = 9
	cells    = size * size
	Limbs    = 3
	limbBits = 27
	// LimbMask garde les 27 bits utiles d'un mot.
	LimbMask  = 1<<limbBits - 1
	rowShift  = size
	limbCarry = limbBits - rowShift
	// MaxLayers borne le nombre de couches d'un parcours.
	MaxLayers = cells + 1
)

func init() {
	if cells != Limbs*limbBits {
		panic("le plateau de bits suppose 81 cases en trois mots de 27 bits")
	}
}

// Set est un ensemble de cases.
type Set [Limbs]uint32

// Empty dit si l'ensemble est vide.
func (s Set) Empty() bool { return s[0]|s[1]|s[2] == 0 }

// And rend l'intersection.
func (s Set) And(o Set) Set { return Set{s[0] & o[0], s[1] & o[1], s[2] & o[2]} }

// Count rend le nombre de cases.
func (s Set) Count() int {
	return bits.OnesCount32(s[0]) + bits.OnesCount32(s[1]) + bits.OnesCount32(s[2])
}

// Mot portant une case, et bit de cette case dans ce mot.
var (
	CellLimb = func() (limbs [cells]uint8) {
		for cell := range cells {
			limbs[cell] = uint8(cell / limbBits)
		}
		return limbs
	}()
	CellBit = func() (bits [cells]uint32) {
		for cell := range cells {
			bits[cell] = 1 << (cell % limbBits)
		}
		return bits
	}()
)

// Above rend les cases situées juste au-dessus d'une case de l'ensemble.
func (s Set) Above() Set {
	return Set{
		s[0]>>rowShift | (s[1]<<limbCarry)&LimbMask,
		s[1]>>rowShift | (s[2]<<limbCarry)&LimbMask,
		s[2] >> rowShift,
	}
}

// MaskOf rend l'ensemble des cases satisfaisant un prédicat.
func MaskOf(inside func(x, y int) bool) Set {
	var s Set
	for y := range size {
		for x := range size {
			if inside(x, y) {
				cell := y*size + x
				s[CellLimb[cell]] |= CellBit[cell]
			}
		}
	}
	return s
}

var (
	EdgeLeft   = MaskOf(func(x, _ int) bool { return x == 0 })
	EdgeRight  = MaskOf(func(x, _ int) bool { return x == size-1 })
	EdgeTop    = MaskOf(func(_, y int) bool { return y == 0 })
	EdgeBottom = MaskOf(func(_, y int) bool { return y == size-1 })
)

// Cases ayant une voisine à l'est, à l'ouest : identiques dans les trois mots.
const (
	innerEast = 0x03fdfeff
	innerWest = 0x07fbfdfe
)

func init() {
	east := MaskOf(func(x, _ int) bool { return x != size-1 })
	west := MaskOf(func(x, _ int) bool { return x != 0 })
	if east != (Set{innerEast, innerEast, innerEast}) || west != (Set{innerWest, innerWest, innerWest}) {
		panic("masques de bord incohérents")
	}
}

// La dilatation d'un cran dans les huit directions, lui-même compris : un
// étalement horizontal (spread) de chaque mot, puis vertical, mot du haut, du
// milieu, du bas. Découpée en petites fonctions pour que le compilateur les
// insère dans les boucles chaudes.

func spread(a uint32) uint32 { return a | (a&innerEast)<<1 | (a&innerWest)>>1 }

func boxTop(h0, h1 uint32) uint32 {
	return h0 | (h0<<rowShift)&LimbMask | h0>>rowShift | (h1<<limbCarry)&LimbMask
}

func boxMiddle(h0, h1, h2 uint32) uint32 {
	return h1 | (h1<<rowShift)&LimbMask | h1>>rowShift | h0>>limbCarry | (h2<<limbCarry)&LimbMask
}

func boxBottom(h1, h2 uint32) uint32 {
	return h2 | (h2<<rowShift)&LimbMask | h2>>rowShift | h1>>limbCarry
}

// grow étend le front `f` par les cases de `w` non encore visitées (`v`),
// jusqu'à saturation. Rend les cases ajoutées et le visité mis à jour.
func grow(f0, f1, f2, w0, w1, w2, v0, v1, v2 uint32) (a0, a1, a2, r0, r1, r2 uint32) {
	for f0|f1|f2 != 0 {
		h0, h1, h2 := spread(f0), spread(f1), spread(f2)
		f0 = boxTop(h0, h1) & w0 &^ v0
		f1 = boxMiddle(h0, h1, h2) & w1 &^ v1
		f2 = boxBottom(h1, h2) & w2 &^ v2
		v0 |= f0
		v1 |= f1
		v2 |= f2
		a0 |= f0
		a1 |= f1
		a2 |= f2
	}
	return a0, a1, a2, v0, v1, v2
}

// Flood rend la composante connexe — voisinage à huit — de `within` atteinte
// depuis `seed`, qui doit y être inclus.
func Flood(seed, within Set) Set {
	_, _, _, r0, r1, r2 := grow(seed[0], seed[1], seed[2], within[0], within[1], within[2], seed[0], seed[1], seed[2])
	return Set{r0, r1, r2}
}

// Layers reçoit les couches d'un parcours : la couche d est ce qu'on atteint
// en franchissant d cases à un pas.
type Layers [MaxLayers]Set

// Terrain d'un parcours 0-1 : les cases sans coût, puis celles qui coûtent un
// pas ; tout le reste est infranchissable. L'ordre des deux est le seul piège.
type Terrain struct {
	Costless Set
	Stepped  Set
}

// Fill remplit les couches depuis `entry` et s'arrête au bord `exit` : rend sa
// distance, ou -1 s'il est hors d'atteinte (fillLayers).
func (t *Terrain) Fill(entry, exit Set, layers *Layers) int {
	c0, c1, c2 := t.Costless[0], t.Costless[1], t.Costless[2]
	s0, s1, s2 := t.Stepped[0], t.Stepped[1], t.Stepped[2]
	x0, x1, x2 := exit[0], exit[1], exit[2]

	l0, l1, l2 := entry[0]&c0, entry[1]&c1, entry[2]&c2
	a0, a1, a2, v0, v1, v2 := grow(l0, l1, l2, c0, c1, c2, l0, l1, l2)
	l0 |= a0
	l1 |= a1
	l2 |= a2
	layers[0] = Set{l0, l1, l2}
	if l0&x0|l1&x1|l2&x2 != 0 {
		return 0
	}
	// Le bord d'entrée est une porte à un pas, même sans voisine gratuite.
	p0, p1, p2 := entry[0]&s0, entry[1]&s1, entry[2]&s2
	for depth := 1; depth < MaxLayers; depth++ {
		h0, h1, h2 := spread(l0), spread(l1), spread(l2)
		n0 := (boxTop(h0, h1)&s0 | p0) &^ v0
		n1 := (boxMiddle(h0, h1, h2)&s1 | p1) &^ v1
		n2 := (boxBottom(h1, h2)&s2 | p2) &^ v2
		p0, p1, p2 = 0, 0, 0
		if n0|n1|n2 == 0 {
			return -1
		}
		a0, a1, a2, v0, v1, v2 = grow(n0, n1, n2, c0, c1, c2, v0|n0, v1|n1, v2|n2)
		l0, l1, l2 = n0|a0, n1|a1, n2|a2
		layers[depth] = Set{l0, l1, l2}
		if l0&x0|l1&x1|l2&x2 != 0 {
			return depth
		}
	}
	return -1
}

// FillWeighted est Fill où les cases à un pas de `heavy` en coûtent deux
// (fillLayersWeighted). À `heavy` vide, il rend exactement Fill.
func (t *Terrain) FillWeighted(entry, exit Set, layers *Layers, heavy Set) int {
	var light, weighty Set
	for i := range Limbs {
		light[i] = t.Stepped[i] &^ heavy[i]
		weighty[i] = t.Stepped[i] & heavy[i]
	}
	c := t.Costless
	l := Set{entry[0] & c[0], entry[1] & c[1], entry[2] & c[2]}
	a0, a1, a2, v0, v1, v2 := grow(l[0], l[1], l[2], c[0], c[1], c[2], l[0], l[1], l[2])
	v := Set{v0, v1, v2}
	l = Set{l[0] | a0, l[1] | a1, l[2] | a2}
	layers[0] = l
	if l[0]&exit[0]|l[1]&exit[1]|l[2]&exit[2] != 0 {
		return 0
	}
	// Les cases légères du bord entrent à la couche 1, les lourdes à la 2.
	p := Set{entry[0] & light[0], entry[1] & light[1], entry[2] & light[2]}
	for depth := 1; depth < MaxLayers; depth++ {
		h0, h1, h2 := spread(l[0]), spread(l[1]), spread(l[2])
		b0, b1, b2 := boxTop(h0, h1), boxMiddle(h0, h1, h2), boxBottom(h1, h2)
		n := Set{
			(b0&light[0] | p[0]) &^ v[0],
			(b1&light[1] | p[1]) &^ v[1],
			(b2&light[2] | p[2]) &^ v[2],
		}
		p = Set{b0 & weighty[0] &^ v[0], b1 & weighty[1] &^ v[1], b2 & weighty[2] &^ v[2]}
		if depth == 1 {
			for i := range Limbs {
				p[i] |= entry[i] & weighty[i] &^ v[i]
			}
		}
		if n[0]|n[1]|n[2]|p[0]|p[1]|p[2] == 0 {
			return -1
		}
		a0, a1, a2, v0, v1, v2 = grow(n[0], n[1], n[2], c[0], c[1], c[2], v[0]|n[0], v[1]|n[1], v[2]|n[2])
		v = Set{v0, v1, v2}
		n = Set{n[0] | a0, n[1] | a1, n[2] | a2}
		layers[depth] = n
		if n[0]&exit[0]|n[1]&exit[1]|n[2]&exit[2] != 0 {
			return depth
		}
		l = n
	}
	return -1
}

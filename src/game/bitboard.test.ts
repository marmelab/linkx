import { describe, expect, it } from 'vitest'
import {
  CELL_BIT,
  CELL_LIMB,
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  FLOOD,
  LIMBS,
  createLayers,
  fillLayers,
  floodFrom,
  popcount,
  setTerrain,
} from './bitboard'
import { BOARD_SIZE } from './types'

const N = BOARD_SIZE
const CELLS = N * N

function toLimbs(cells: readonly boolean[]): number[] {
  const limbs = [0, 0, 0]
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (cells[cell]) limbs[CELL_LIMB[cell]] |= CELL_BIT[cell]
  }
  return limbs
}

function toCells(limbs: readonly number[], offset = 0): boolean[] {
  return Array.from(
    { length: CELLS },
    (_, cell) => (limbs[offset + CELL_LIMB[cell]] & CELL_BIT[cell]) !== 0,
  )
}

/** Voisines à huit d'une case, en indices. */
function neighbours(cell: number): number[] {
  const x = cell % N
  const y = (cell - x) / N
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue
      out.push(ny * N + nx)
    }
  }
  return out
}

/** Un tirage à graine : les cas se rejouent à l'identique. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x80000000
  }
}

/** Composante connexe, case par case, pour comparaison. */
function naiveFlood(seed: readonly boolean[], within: readonly boolean[]): boolean[] {
  const reached = seed.map((value, cell) => value && within[cell])
  let growing = true
  while (growing) {
    growing = false
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (!reached[cell]) continue
      for (const next of neighbours(cell)) {
        if (!within[next] || reached[next]) continue
        reached[next] = true
        growing = true
      }
    }
  }
  return reached
}

/** Distances d'un parcours 0-1, case par case, pour comparaison. */
function naiveDistances(
  free: readonly boolean[],
  step: readonly boolean[],
  entry: readonly boolean[],
): number[] {
  const distance = Array.from({ length: CELLS }, () => Number.POSITIVE_INFINITY)
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (entry[cell] && free[cell]) distance[cell] = 0
    else if (entry[cell] && step[cell]) distance[cell] = 1
  }
  let improving = true
  while (improving) {
    improving = false
    for (let cell = 0; cell < CELLS; cell += 1) {
      if (distance[cell] === Number.POSITIVE_INFINITY) continue
      for (const next of neighbours(cell)) {
        const cost = free[next] ? 0 : step[next] ? 1 : Number.POSITIVE_INFINITY
        const candidate = distance[cell] + cost
        if (candidate < distance[next]) {
          distance[next] = candidate
          improving = true
        }
      }
    }
  }
  return distance
}

describe('plateau de bits', () => {
  it('compte les bits d’un mot', () => {
    expect(popcount(0)).toBe(0)
    expect(popcount(1)).toBe(1)
    expect(popcount(0x7ffffff)).toBe(27)
    expect(popcount(0b1011011)).toBe(5)
  })

  it('place les bords là où ils sont', () => {
    expect(toCells(Array.from(EDGE_LEFT)).filter(Boolean)).toHaveLength(N)
    expect(toCells(Array.from(EDGE_LEFT)).every((set, cell) => set === (cell % N === 0))).toBe(true)
    expect(toCells(Array.from(EDGE_RIGHT)).every((set, cell) => set === (cell % N === N - 1))).toBe(true)
    expect(toCells(Array.from(EDGE_TOP)).every((set, cell) => set === (cell < N))).toBe(true)
    expect(
      toCells(Array.from(EDGE_BOTTOM)).every((set, cell) => set === (cell >= CELLS - N)),
    ).toBe(true)
  })

  it('inonde comme un parcours case par case', () => {
    const random = seeded(7)
    for (let round = 0; round < 200; round += 1) {
      const within = Array.from({ length: CELLS }, () => random() < 0.45)
      const start = Math.floor(random() * CELLS)
      if (!within[start]) continue
      const seed = Array.from({ length: CELLS }, (_, cell) => cell === start)
      const [s0, s1, s2] = toLimbs(seed)
      const [w0, w1, w2] = toLimbs(within)
      floodFrom(s0, s1, s2, w0, w1, w2)
      expect(toCells(Array.from(FLOOD))).toEqual(naiveFlood(seed, within))
    }
  })

  it('rend les mêmes distances qu’un parcours 0-1 case par case', () => {
    const random = seeded(13)
    const layers = createLayers()
    for (let round = 0; round < 200; round += 1) {
      const free: boolean[] = []
      const step: boolean[] = []
      for (let cell = 0; cell < CELLS; cell += 1) {
        const draw = random()
        free.push(draw < 0.2)
        step.push(draw >= 0.2 && draw < 0.75)
      }
      const [f0, f1, f2] = toLimbs(free)
      const [p0, p1, p2] = toLimbs(step)
      setTerrain(f0, f1, f2, p0, p1, p2)
      const distance = fillLayers(EDGE_LEFT, EDGE_RIGHT, layers)

      const expected = naiveDistances(free, step, toCells(Array.from(EDGE_LEFT)))
      let best = Number.POSITIVE_INFINITY
      for (let y = 0; y < N; y += 1) {
        best = Math.min(best, expected[y * N + (N - 1)])
      }
      expect(distance).toBe(Number.isFinite(best) ? best : -1)
      if (distance < 0) continue

      // Chaque couche jusqu'au bord d'arrivée porte exactement les cases de
      // cette distance : c'est d'elles que se déduit la largeur du chemin.
      for (let depth = 0; depth <= distance; depth += 1) {
        const inLayer = toCells(Array.from(layers), depth * LIMBS)
        for (let cell = 0; cell < CELLS; cell += 1) {
          expect(inLayer[cell]).toBe(expected[cell] === depth)
        }
      }
    }
  })
})

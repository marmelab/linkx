import { describe, expect, it } from 'vitest'
import {
  MATE_THRESHOLD,
  TEMPO,
  chooseMasterMove,
  searchMasterTopMoves,
  NO_CRITERIA,
  DEFAULT_CRITERIA,
  DEFAULT_WEIGHTS,
  evaluate,
  evaluationTerms,
  evaluationWeights,
} from './engineSearch.ts'
import type { EvaluationCriteria, EvaluationWeights } from './engineSearch.ts'
import { applyMove, createEnginePosition, generateMoves, loadPosition, undoMove } from './engineBoard.ts'
import { referencePositionAfter } from './referenceGame.ts'
import { chooseMoveForDifficulty } from './minimax.ts'
import { createGamePosition, simulateLegalMove } from './simulation.ts'
import type { GamePosition } from './simulation.ts'
import { boardFromText } from './boardText.ts'
import { createInitialInventory } from './pieces.ts'
import { enumerateLegalMoves } from './legalMoves.ts'
import type { Inventory, PlayerId } from './types.ts'

describe('recherche du maître', () => {
  /**
   * Valeurs de jeu établies indépendamment, en remontant la partie perdue avec
   * un solveur exhaustif. La recherche doit les **retrouver**, et les annoncer
   * comme exactes plutôt que comme une estimation.
   */
  it.each([
    [21, 'white', 'loss'],
    [20, 'blue', 'win'],
    [19, 'white', 'loss'],
    [18, 'blue', 'win'],
    [17, 'white', 'loss'],
    [16, 'blue', 'win'],
  ] as const)(
    'résout exactement la position après %i coups (%s est %s)',
    (moveCount, expectedMover, verdict) => {
      const position = referencePositionAfter(moveCount)
      expect(position.activePlayer).toBe(expectedMover)

      const decision = chooseMasterMove(position, { budgetMs: 20_000 })
      expect(decision).not.toBeNull()
      expect(decision!.exact).toBe(true)
      if (verdict === 'win') {
        expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)
      } else {
        expect(decision!.score).toBeLessThan(-MATE_THRESHOLD)
      }
    },
    30_000,
  )

  it('joue un coup qui gagne immédiatement', () => {
    // Bleu relie déjà sept colonnes sur la ligne du fond : un mono en colonne 8
    // referme la connexion gauche-droite.
    const board = boardFromText(`
      .........
      .........
      .........
      .........
      .........
      .........
      .........
      WWWWWWW..
      BBBBBBBB.
    `)
    const inventories: Record<PlayerId, Inventory> = {
      blue: createInitialInventory(),
      white: createInitialInventory(),
    }
    const position: GamePosition = { board, inventories, activePlayer: 'blue' }

    const decision = chooseMasterMove(position, { budgetMs: 2_000 })
    expect(decision).not.toBeNull()
    expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)

    const after = simulateLegalMove(position, decision!.move)
    expect(after.result?.winner).toBe('blue')
    expect(after.result?.reason).toBe('connection')
  })

  it('rend le même conseil deux fois quand il est borné aux nœuds', () => {
    const position = referencePositionAfter(9)
    const first = chooseMasterMove(position, { maxNodes: 30_000 })
    const second = chooseMasterMove(position, { maxNodes: 30_000 })

    expect(first).not.toBeNull()
    expect(second!.score).toBe(first!.score)
    expect(second!.depth).toBe(first!.depth)
    expect(second!.nodes).toBe(first!.nodes)
    expect(second!.move.cells).toEqual(first!.move.cells)
    expect(second!.move.shapeId).toBe(first!.move.shapeId)
  })

  it('ne consulte jamais l’horloge quand il est borné aux nœuds', () => {
    let clockReads = 0
    const position = referencePositionAfter(9)
    chooseMasterMove(position, {
      maxNodes: 20_000,
      now: () => {
        clockReads += 1
        return 0
      },
    })
    expect(clockReads).toBe(0)
  })

  it('respecte le budget de temps qu’on lui donne', () => {
    let clock = 0
    // Horloge injectée qui avance d'elle-même : la recherche doit s'arrêter
    // sans dépendre du temps réel de la machine de test.
    const decision = chooseMasterMove(referencePositionAfter(0), {
      budgetMs: 1_000,
      now: () => {
        clock += 25
        return clock
      },
    })
    expect(decision).not.toBeNull()
    expect(decision!.depth).toBeGreaterThanOrEqual(1)
  })

  it('ne rend que des coups légaux, sur toute une partie contre lui-même', () => {
    let position = createGamePosition('blue')
    for (let ply = 0; ply < 30; ply += 1) {
      const legal = enumerateLegalMoves(
        position.board,
        position.inventories[position.activePlayer],
      )
      if (legal.length === 0) break

      const decision = chooseMasterMove(position, { maxNodes: 4_000 })
      expect(decision).not.toBeNull()
      const played = decision!.move
      expect(
        legal.some(
          (move) =>
            move.shapeId === played.shapeId &&
            move.column === played.column &&
            JSON.stringify(move.cells) === JSON.stringify(played.cells),
        ),
      ).toBe(true)

      const transition = simulateLegalMove(position, played)
      if (transition.result) break
      position = transition.position
    }
  })

  /**
   * Une position vide est symétrique : les deux joueurs ont les mêmes réserves
   * et la même distance à chaque bord. Il ne doit donc rester que l'avantage du
   * trait, qui est précisément ce que `TEMPO` chiffre.
   */
  it('évalue une position vide comme équilibrée, au trait près', () => {
    const engine = loadPosition(createEnginePosition(), createGamePosition('blue'))
    expect(evaluate(engine)).toBe(TEMPO)
    const white = loadPosition(createEnginePosition(), createGamePosition('white'))
    expect(evaluate(white)).toBe(TEMPO)
  })

  describe("critères à l'essai", () => {
    const enginePositionOf = (rows: string, inventories: Partial<Record<PlayerId, Inventory>>) =>
      loadPosition(createEnginePosition(), {
        board: boardFromText(rows),
        inventories: { blue: createInitialInventory(), white: createInitialInventory(), ...inventories },
        activePlayer: 'blue',
      })
    const gain = (
      rows: string,
      criteria: Partial<EvaluationCriteria>,
      inventories: Partial<Record<PlayerId, Inventory>> = {},
    ) => {
      const position = enginePositionOf(rows, inventories)
      return evaluate(position, undefined, { ...NO_CRITERIA, ...criteria }) - evaluate(position, undefined, NO_CRITERIA)
    }
    const empty = '.........\n'.repeat(7)

    it('ne change rien à poids nul', () => {
      expect(gain(`${empty}.........\nBB.....WW`, { ...NO_CRITERIA })).toBe(0)
    })

    it('compte les cases posées sur une case adverse', () => {
      expect(gain(`${empty}B........\nW.......W`, { caps: 200 })).toBe(200)
    })

    it('pénalise les zones distinctes', () => {
      expect(gain(`${empty}.........\nB...B...W`, { zoneCount: 300 })).toBe(-300)
    })

    it('ne voit aucune avance de gravité dans une position symétrique', () => {
      expect(gain(`${empty}.........\nBB.....WW`, { gravity: 150 })).toBe(0)
    })

    it('fait payer la case vide qui reste sous la case à prendre', () => {
      // Chacun est à une case du bord droit, mais celle de blanc est perchée.
      const rows = `${'.........\n'.repeat(6)}WWWWWWWW.\nBBBBBBBB.\nBBBBBBBB.`
      expect(gain(rows, { gravity: 150 })).toBe(150)
    })

    it('récompense une menace à deux cases que rien ne coupe', () => {
      // Un domino blanc sur le trou laisse passer bleu par-dessus, en diagonale.
      expect(gain(`${empty}.........\nBBB..BBBB`, { robust: 1000 })).toBe(1000)
      expect(gain(`${empty}.........\nBB.....WW`, { robust: 1000 })).toBe(0)
    })

    it('compte la mobilité une fois le plateau à moitié plein', () => {
      const stripes = `${'.........\n'.repeat(4)}${'BWBWBWBWB\n'.repeat(5)}`.trim()
      expect(gain(stripes, { mobility: 150 })).toBe(0)
      const none = { ...createInitialInventory(), mono: 0, domino: 0, bar3: 0, smallL: 0, s: 0, t: 0, largeL: 0 } as Inventory
      expect(gain(stripes, { mobility: 150 }, { white: none })).toBe(8 * 150)
      expect(gain(`${empty}.........\nBB.....WW`, { mobility: 150 }, { white: none })).toBe(0)
    })

    it('valorise la barre de 3 gardée et pénalise le grand L gardé', () => {
      const rows = `${empty}.........\nBB.....WW`
      expect(gain(rows, { reserve: 300 }, { blue: { ...createInitialInventory(), bar3: 1 } })).toBe(-300)
      expect(gain(rows, { reserve: 300 }, { blue: { ...createInitialInventory(), largeL: 1 } })).toBe(150)
    })

    it('pénalise les cases des trois lignes du haut en début de partie', () => {
      const rows = `${'B........\n'.repeat(3)}${'W........\n'.repeat(6)}`.trim()
      expect(gain(rows, { topRows: 150 })).toBe(-450)
    })

    // Bleu est à une case du haut, mais cette case — deuxième colonne, troisième
    // ligne — a deux cases vides sous elle : il faut combler la colonne d'abord.
    const perched = [
      '..B......',
      '..B......',
      '..W......',
      'B.W......',
      'B.W......',
      'BWW......',
      'BWW......',
      'BWW......',
      'BWW......',
    ].join('\n')
    const swapped = perched.replace(/[BW]/g, (cell) => (cell === 'B' ? 'W' : 'B'))

    // Le camp sans réserve n'a plus d'axe vivant : seul l'autre est mesuré.
    const spent = { ...createInitialInventory(), mono: 0, domino: 0, bar3: 0, smallL: 0, s: 0, t: 0, largeL: 0 } as Inventory

    it('fait payer deux pas à la case suspendue dans la distance verticale', () => {
      expect(gain(perched, { hanging: 2 }, { white: spent })).toBeLessThan(-1000)
      expect(gain(swapped, { hanging: 2 }, { blue: spent })).toBeGreaterThan(1000)
      // Le seuil compte : à trois cases vides dessous, la case perchée reste à un
      // pas, et seul le haut de la première colonne s'alourdit.
      expect(gain(perched, { hanging: 3 }, { white: spent })).toBe(0)
    })

    it('rend la case suspendue infranchissable, plus sévèrement encore', () => {
      expect(gain(perched, { hangingWall: 2 }, { white: spent })).toBeLessThan(
        gain(perched, { hanging: 2 }, { white: spent }),
      )
    })

    it('relève le poids de la plus grande zone quand personne ne connectera bientôt', () => {
      // Bleu à six cases de connecter, blanc à sept : 4 crans au-delà de deux,
      // et une case de plus dans la plus grande zone bleue.
      expect(gain(`${empty}.........\nBBB....WW`, { zoneStall: 10 })).toBe(40)
      // À une case de connecter, rien ne change.
      expect(gain(`${empty}.........\nBBBBBBB.W`, { zoneStall: 10 })).toBe(0)
    })
  })

  /**
   * La variante principale sert au livre d'ouverture, qui y récolte des coups
   * sans les rechercher. Elle doit donc être une suite **rejouable par le
   * domaine** : c'est ce qui autorise à écrire ses positions dans le livre.
   */
  it('rend une variante principale rejouable, partant du coup choisi', () => {
    for (const moveCount of [0, 6, 12]) {
      const position = moveCount === 0 ? createGamePosition('blue') : referencePositionAfter(moveCount)
      const search = searchMasterTopMoves(position, { maxNodes: 40_000 })
      expect(search).not.toBeNull()

      const pv = search!.pv
      expect(pv.length).toBeGreaterThan(0)
      expect(pv.length).toBeLessThanOrEqual(Math.max(search!.depth, 1))
      expect(pv[0].cells).toEqual(search!.moves[0].cells)

      let cursor = position
      for (const [index, move] of pv.entries()) {
        const legal = enumerateLegalMoves(cursor.board, cursor.inventories[cursor.activePlayer])
        expect(
          legal.some(
            (candidate) =>
              candidate.cells.length === move.cells.length &&
              candidate.cells.every((cell, i) => cell.x === move.cells[i].x && cell.y === move.cells[i].y),
          ),
        ).toBe(true)
        const transition = simulateLegalMove(cursor, move)
        if (transition.result) {
          expect(index).toBe(pv.length - 1)
          break
        }
        cursor = transition.position
      }
    }
  })

  /**
   * `TEMPO` n'est pas une constante d'ajustement libre : c'est la mesure de
   * l'avantage du trait, et c'est elle qui autorise à jouer une profondeur
   * impaire. Si l'évaluation change sans qu'on la recalibre, les paliers
   * impairs se remettent à surestimer et la recherche joue des scores qui ne se
   * comparent plus d'un palier à l'autre.
   *
   * Le test porte sur la **moyenne** et non sur chaque position : l'avantage du
   * trait varie d'une position à l'autre et un terme constant ne peut pas
   * suivre cette variation. C'est bien la moyenne qu'il doit annuler.
   *
   * Recalibrage : `node node_modules/vite-node/dist/cli.mjs scripts/bench-moteur.ts`
   * affiche le score de chaque palier ; la correction à apporter à `TEMPO` est
   * la moitié de l'écart moyen entre paliers impairs et pairs.
   */
  it('garde un avantage du trait calibré, sans quoi les paliers ne se comparent plus', () => {
    const gaps: number[] = []
    for (const moveCount of [7, 9, 11, 13, 15]) {
      const position = referencePositionAfter(moveCount)
      const scores = [4, 5].map(
        (maxDepth) =>
          searchMasterTopMoves(position, { maxDepth, maxNodes: 400_000 })?.score ?? 0,
      )
      if (scores.some((score) => Math.abs(score) > MATE_THRESHOLD)) continue
      gaps.push(scores[1] - scores[0])
    }
    expect(gaps.length).toBeGreaterThan(2)
    const mean = gaps.reduce((total, gap) => total + gap, 0) / gaps.length
    // Sans terme de tempo, cet écart valait environ 1 250 points, soit plus d'un
    // cran d'axe principal.
    expect(Math.abs(mean)).toBeLessThan(400)
  })

  describe("poids de l'évaluation", () => {
    /** La partie de référence, et tous les enfants d'une position sur trois. */
    const eachPosition = (visit: (position: ReturnType<typeof createEnginePosition>) => void) => {
      const moves = new Int32Array(256)
      for (let moveCount = 0; moveCount <= 20; moveCount += 1) {
        const position = loadPosition(createEnginePosition(), referencePositionAfter(moveCount))
        visit(position)
        if (moveCount % 3 !== 0) continue
        const count = generateMoves(position, moves, 0)
        for (let index = 0; index < count; index += 1) {
          applyMove(position, moves[index])
          visit(position)
          undoMove(position, moves[index])
        }
      }
    }

    it('rend exactement l\'évaluation des constantes quand les poids sont ceux par défaut', () => {
      expect(evaluationWeights()).toEqual(DEFAULT_WEIGHTS)
      eachPosition((position) => {
        const value = evaluate(position)
        expect(evaluate(position, undefined, DEFAULT_CRITERIA, evaluationWeights())).toBe(value)
        expect(evaluate(position, 5, DEFAULT_CRITERIA, evaluationWeights())).toBe(value)
      })
    })

    it('ne change aucun coup ni aucun score de la recherche avec les poids par défaut', () => {
      for (const moveCount of [6, 10, 14]) {
        const position = referencePositionAfter(moveCount)
        const plain = searchMasterTopMoves(position, { maxNodes: 30_000 })
        const weighted = searchMasterTopMoves(position, { maxNodes: 30_000, weights: { ...DEFAULT_WEIGHTS } })
        expect(weighted?.score).toBe(plain?.score)
        expect(weighted?.moves.map((move) => move.cells)).toEqual(plain?.moves.map((move) => move.cells))
        expect(weighted?.nodes).toBe(plain?.nodes)
      }
    })

    /** `evaluate` recomposée depuis ses termes bruts : c'est ce qu'ajuste `evaluationTerms`. */
    const recompose = (
      position: ReturnType<typeof createEnginePosition>,
      criteria: EvaluationCriteria,
      weights: EvaluationWeights,
    ): number => {
      const t = evaluationTerms(position, criteria)
      return (
        t.primary * weights.primary +
        t.secondary * weights.secondary +
        t.width * weights.pathWidth +
        t.zone * (weights.zoneBase + Math.round((weights.zoneFill * t.filled) / 81)) +
        t.zoneStall * criteria.zoneStall +
        t.gravity * criteria.gravity +
        t.zoneCount * criteria.zoneCount +
        t.caps * criteria.caps +
        t.mobility * criteria.mobility +
        t.bar3 * criteria.bar3 +
        t.largeL * criteria.largeL +
        t.topRows * criteria.topRows +
        t.robust * criteria.robust +
        weights.tempo
      )
    }

    it('se recompose depuis ses termes bruts, critères et seuils compris', () => {
      const criteria = { ...NO_CRITERIA, gravity: 7, zoneCount: 11, caps: 13, mobility: 17, bar3: 19, largeL: 23, topRows: 29, robust: 31, zoneStall: 37 }
      const weights = evaluationWeights(3, { primary: 1000, secondary: 250, pathWidth: 41, zoneBase: 9, zoneFill: 70, tempo: 500 })
      eachPosition((position) => {
        expect(recompose(position, DEFAULT_CRITERIA, DEFAULT_WEIGHTS)).toBe(evaluate(position))
        for (const thresholds of [{}, { hanging: 2 }, { hangingWall: 3 }]) {
          const all = { ...criteria, ...thresholds }
          expect(recompose(position, all, weights)).toBe(evaluate(position, 3, all, weights))
        }
      })
    })
  })

  it('est atteignable par le niveau, sans profondeur transmise', () => {
    const position = referencePositionAfter(18)
    const decision = chooseMoveForDifficulty(position, 'master')
    expect(decision).not.toBeNull()
    // Position gagnée pour bleu : le niveau doit la voir gagnée.
    expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)
  })
})

/**
 * The sweep: what gets rendered, and why each axis is in it.
 *
 * The question this row answers is narrow — *can S4 auto-preview a base as the
 * user drags a parameter, or does it need a Generate button* — so the sweep is
 * built around the parameters a user actually moves in that panel, not around
 * whatever the geometry can be made to do.
 *
 * Six suites:
 *
 * - **`size`** — `bases-square` 1×1 through 8×8. The plan's ~3 s threshold is
 *   about the large end, so the whole curve is measured rather than two points.
 *   1×1 is included even though the customizer enum starts at 2: `base_square`
 *   branches on `x == 1 || y == 1` for `edge_width`, so the geometry supports it
 *   and `-D` reaches it, and the smallest case is where auto-preview is most
 *   likely to be viable.
 * - **`lock`** — all five `-D LOCK` values, with magnets on and off, at 2×2 and
 *   4×4. Labelled through `locks.ts` so a row cannot be read as the catalogued
 *   filename that means something else (trap 1).
 * - **`shape`** — square against the three curved entry points, diagonal and hex.
 *   The curved files hold 38 of the set's `$fn` call sites against the square
 *   path's 16, so this is where a tessellation cost would show up if there is one.
 * - **`backend`** — Manifold against CGAL on the same models. Included because
 *   the plan calls the flag "mandatory, not optional" and an unquantified
 *   mandate gets dropped; a number is harder to drop.
 * - **`basis`** — the four `SQUARE_BASIS` values. Trap 3: every catalogued base
 *   is `inch`, and two of the four bases are refused outright by the geometry
 *   when combined with `dragonlock` or `infinitylock`. The suite exists to
 *   record the refusals as refusals rather than as fast renders.
 * - **`plan`** — the four shippable rows of
 *   `docs/base-generator-integration.md` §3.5, reproduced as closely as the
 *   parameters allow, so the plan's triangle-count extrapolation can be checked
 *   against the same configurations it named instead of against a sweep of our
 *   own choosing. `bases-wall-primary` is not here: S1 did not vendor it.
 *
 * Everything is `SQUARE_BASIS="inch"` unless the suite is about the basis, and
 * `HEIGHT` is left at its default of 6, because that is what `bases.py` did for
 * every one of the 1,962 catalogued bases.
 */
import { num, str } from './args'
import type { BenchConfig, ScadValue } from './args'

/** `bases.py` held these fixed across the whole generated corpus. */
const CORPUS_DEFAULTS: Readonly<Record<string, ScadValue>> = {
  SQUARE_BASIS: str('inch'),
  PRIORITY: str('lock'),
}

/** Magnets on, as the corpus generated them: `MAGNET_HOLE` 6 with, 0 without. */
const MAGNETS_ON: Readonly<Record<string, ScadValue>> = {
  MAGNETS: str('flex_magnetic'),
  MAGNET_HOLE: num(6),
}
const MAGNETS_OFF: Readonly<Record<string, ScadValue>> = {
  MAGNETS: str('none'),
  MAGNET_HOLE: num(0),
}

export const SUITES = ['size', 'lock', 'shape', 'backend', 'basis', 'plan'] as const
export type Suite = (typeof SUITES)[number]

/** Run by default. `basis` is included: its refusals are a result, not a skip. */
export const DEFAULT_SUITES: readonly Suite[] = ['size', 'lock', 'shape', 'backend', 'basis', 'plan']

/** `bases-square` from 1×1 to 8×8, one lock, magnets on. */
function sizeSuite(): BenchConfig[] {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    id: `size/square-${String(n)}x${String(n)}`,
    suite: 'size',
    entry: 'bases-square.scad',
    backend: 'manifold' as const,
    lockLabel: { label: 'openlock', family: 'square' as const },
    params: { ...CORPUS_DEFAULTS, ...MAGNETS_ON, x: num(n), y: num(n), TOPLESS: str('true') },
  }))
}

/** Every `-D LOCK` value, magnets on and off, at two sizes. */
function lockSuite(): BenchConfig[] {
  const locks = ['openlock', 'triplex', 'infinitylock', 'dragonlock', 'none'] as const
  const configs: BenchConfig[] = []
  for (const n of [2, 4]) {
    for (const lock of locks) {
      for (const [tag, magnets] of [
        ['mag', MAGNETS_ON],
        ['nomag', MAGNETS_OFF],
      ] as const) {
        configs.push({
          id: `lock/${lock}-${String(n)}x${String(n)}-${tag}`,
          suite: 'lock',
          entry: 'bases-square.scad',
          backend: 'manifold',
          params: {
            ...CORPUS_DEFAULTS,
            ...magnets,
            x: num(n),
            y: num(n),
            LOCK: str(lock),
            TOPLESS: str('true'),
            SUPPORTS: str('true'),
          },
        })
      }
    }
  }
  return configs
}

/** Square against curved, diagonal and hex. `bases-diagonal` uses `DIAGONAL_BASIS`. */
function shapeSuite(): BenchConfig[] {
  const common = { ...CORPUS_DEFAULTS, ...MAGNETS_ON, LOCK: str('openlock'), TOPLESS: str('true') }
  return [
    {
      id: 'shape/square-4x4',
      suite: 'shape',
      entry: 'bases-square.scad',
      backend: 'manifold',
      params: { ...common, x: num(4), y: num(4) },
    },
    {
      id: 'shape/curved-4x4',
      suite: 'shape',
      entry: 'bases-curved.scad',
      backend: 'manifold',
      params: { ...common, x: num(4), y: num(4), CURVED_LARGE: str('complete') },
    },
    {
      id: 'shape/curved-inverted-3x2cut',
      suite: 'shape',
      entry: 'bases-curved-inverted.scad',
      backend: 'manifold',
      params: { ...common, x: num(3), cut: num(2), id_radial_connectors: num(3) },
    },
    {
      id: 'shape/curved-radial-4r90',
      suite: 'shape',
      entry: 'bases-curved-radial.scad',
      backend: 'manifold',
      params: {
        ...common,
        x: num(4),
        cut: num(2),
        angle: num(90),
        od_radial_connectors: num(3),
        id_radial_connectors: num(3),
      },
    },
    {
      id: 'shape/diagonal-4x4',
      suite: 'shape',
      entry: 'bases-diagonal.scad',
      backend: 'manifold',
      // Note the parameter name: this entry point calls it DIAGONAL_BASIS.
      params: { ...MAGNETS_ON, PRIORITY: str('lock'), DIAGONAL_BASIS: str('inch'), x: num(4), y: num(4), LOCK: str('openlock'), TOPLESS: str('true') },
    },
    {
      id: 'shape/hex-3',
      suite: 'shape',
      entry: 'bases-hex.scad',
      backend: 'manifold',
      // Hex is sized by `size`, not x/y.
      params: { ...common, size: num(3) },
    },
    {
      id: 'shape/riser-square-4x4-high',
      suite: 'shape',
      entry: 'risers_square.scad',
      backend: 'manifold',
      // No TOPLESS or MAGNETS on this entry point; z=4 is `high` in bases.py.
      params: { SQUARE_BASIS: str('inch'), x: num(4), y: num(4), z: num(4), LOCK: str('dragonlock'), SUPPORTS: str('true') },
    },
  ]
}

/**
 * The same geometry through both kernels.
 *
 * Sizes stop at 4×4 by default, and the CGAL rows are capped at
 * `CGAL_MAX_REPEATS`. Both because of measurement, not caution: on the WASM
 * engine CGAL takes 9 s at 2×2 and 25 s at 4×4 against Manifold's fraction of a
 * second, so 8×8 through CGAL is minutes per render and 21 repeats of it would be
 * the entire run. `HEAVY_BACKEND_SIZES` adds it back for anyone who wants the
 * number; the point is already made at 4×4, which is the size the plan's
 * threshold names.
 */
export const CGAL_MAX_REPEATS = 3
const BACKEND_SIZES = [2, 4] as const
export const HEAVY_BACKEND_SIZES = [2, 4, 8] as const

function backendSuite(sizes: readonly number[] = BACKEND_SIZES): BenchConfig[] {
  const configs: BenchConfig[] = []
  for (const n of sizes) {
    for (const backend of ['manifold', 'cgal'] as const) {
      configs.push({
        id: `backend/${backend}-${String(n)}x${String(n)}`,
        suite: 'backend',
        entry: 'bases-square.scad',
        backend,
        lockLabel: { label: 'openlock', family: 'square' },
        params: { ...CORPUS_DEFAULTS, ...MAGNETS_ON, x: num(n), y: num(n), TOPLESS: str('true') },
        ...(backend === 'cgal' ? { maxRepeats: CGAL_MAX_REPEATS } : {}),
      })
    }
  }
  return configs
}

/** The four bases, each with a lock the basis permits and one it does not. */
function basisSuite(): BenchConfig[] {
  const configs: BenchConfig[] = []
  for (const basis of ['25mm', 'inch', 'wyloch', 'drc']) {
    for (const lock of ['openlock', 'dragonlock'] as const) {
      configs.push({
        id: `basis/${basis}-${lock}-4x4`,
        suite: 'basis',
        entry: 'bases-square.scad',
        backend: 'manifold',
        params: {
          ...MAGNETS_ON,
          PRIORITY: str('lock'),
          SQUARE_BASIS: str(basis),
          x: num(4),
          y: num(4),
          LOCK: str(lock),
          TOPLESS: str('true'),
        },
      })
    }
  }
  return configs
}

/**
 * The plan's own §3.5 rows, so its extrapolation is checked on its own terms.
 *
 * Each row's estimated triangle count and estimated WASM time are carried here
 * as data, and `report.ts` prints them beside the measurement. The estimates came
 * from catalog STL byte sizes, so the comparison is against real generator output
 * of the same configuration — the strongest form the check can take.
 */
export interface PlanRow {
  readonly id: string
  readonly claim: string
  readonly estimatedTriangles: number
  readonly estimatedSeconds: readonly [number, number]
}

export const PLAN_ROWS: readonly PlanRow[] = [
  {
    id: 'plan/square-2x2-openlock-flex',
    claim: '`bases-square` 2×2 openlock + flex magnets',
    estimatedTriangles: 10_807,
    estimatedSeconds: [1, 4],
  },
  {
    id: 'plan/square-4x4-openlock-flex',
    claim: '`bases-square` 4×4 openlock + flex magnets',
    estimatedTriangles: 23_671,
    estimatedSeconds: [3, 8],
  },
  {
    id: 'plan/square-8x8-grid-dragonlock-mag',
    claim: '`bases-square` 8×8 grid + dragonlock + magnets',
    estimatedTriangles: 86_144,
    estimatedSeconds: [12, 40],
  },
  {
    id: 'plan/riser-4x4-high-dragonlock',
    claim: '`risers_square` 4×4 high dragonlock',
    estimatedTriangles: 180_100,
    estimatedSeconds: [25, 60],
  },
] as const

function planSuite(): BenchConfig[] {
  return [
    {
      id: 'plan/square-2x2-openlock-flex',
      suite: 'plan',
      entry: 'bases-square.scad',
      backend: 'manifold',
      // "openlock" in a catalogued filename is -D LOCK="triplex" on the square side.
      lockLabel: { label: 'openlock', family: 'square' },
      params: { ...CORPUS_DEFAULTS, ...MAGNETS_ON, x: num(2), y: num(2), TOPLESS: str('true') },
    },
    {
      id: 'plan/square-4x4-openlock-flex',
      suite: 'plan',
      entry: 'bases-square.scad',
      backend: 'manifold',
      lockLabel: { label: 'openlock', family: 'square' },
      params: { ...CORPUS_DEFAULTS, ...MAGNETS_ON, x: num(4), y: num(4), TOPLESS: str('true') },
    },
    {
      id: 'plan/square-8x8-grid-dragonlock-mag',
      suite: 'plan',
      entry: 'bases-square.scad',
      backend: 'manifold',
      params: {
        ...CORPUS_DEFAULTS,
        ...MAGNETS_ON,
        x: num(8),
        y: num(8),
        LOCK: str('dragonlock'),
        TOPLESS: str('true'),
        CENTER: str('grid'),
      },
    },
    {
      id: 'plan/riser-4x4-high-dragonlock',
      suite: 'plan',
      entry: 'risers_square.scad',
      backend: 'manifold',
      params: { SQUARE_BASIS: str('inch'), x: num(4), y: num(4), z: num(4), LOCK: str('dragonlock'), SUPPORTS: str('true') },
    },
  ]
}

export interface SweepOptions {
  /** Add 8×8 to the backend suite. Minutes per CGAL render; off by default. */
  readonly heavy?: boolean
}

const BUILDERS: Record<Suite, (options: SweepOptions) => BenchConfig[]> = {
  size: () => sizeSuite(),
  lock: () => lockSuite(),
  shape: () => shapeSuite(),
  backend: (options) => backendSuite(options.heavy === true ? HEAVY_BACKEND_SIZES : BACKEND_SIZES),
  basis: () => basisSuite(),
  plan: () => planSuite(),
}

/** Configurations for the named suites, in suite order. */
export function sweep(suites: readonly Suite[] = DEFAULT_SUITES, options: SweepOptions = {}): BenchConfig[] {
  const wanted = SUITES.filter((suite) => suites.includes(suite))
  return wanted.flatMap((suite) => BUILDERS[suite](options))
}

/** Parse a `--suite a,b` value, refusing an unknown name rather than ignoring it. */
export function parseSuites(raw: string): Suite[] {
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  const bad = names.filter((name) => !(SUITES as readonly string[]).includes(name))
  if (bad.length > 0) {
    throw new Error(`unknown suite(s) ${bad.join(', ')} — known: ${SUITES.join(', ')}`)
  }
  return names as Suite[]
}

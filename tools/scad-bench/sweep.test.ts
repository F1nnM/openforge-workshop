/**
 * The sweep definition, checked against what the row was asked to answer.
 *
 * These are coverage assertions rather than behaviour ones, and they exist
 * because a sweep silently losing an axis is invisible: the run still succeeds,
 * the report still prints, and the conclusion is just narrower than it claims.
 */
import { describe, expect, it } from 'vitest'

import { buildArgs, geometryRefusal, lockOf, resolvedParams } from './args'
import { CGAL_MAX_REPEATS, DEFAULT_SUITES, PLAN_ROWS, SUITES, parseSuites, sweep } from './sweep'

const ALL = sweep(SUITES)
const OPTIONS = { scadDir: '/scad', outPath: '/tmp/o.stl' }

describe('the sweep as a whole', () => {
  it('gives every configuration a unique id', () => {
    const ids = ALL.map((config) => config.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('produces a valid command line for every configuration', () => {
    for (const config of ALL) expect(() => buildArgs(config, OPTIONS)).not.toThrow()
  })

  it('names only entry points, never an implementation or lock library', () => {
    for (const config of ALL) {
      expect(config.entry).toMatch(/^(bases|risers)[\w-]*\.scad$/)
      expect(config.entry).not.toMatch(/^(impl_|lock_|connectors)/)
    }
  })

  it('leaves HEIGHT alone, as bases.py did for all 1,962 catalogued bases', () => {
    for (const config of ALL) expect(resolvedParams(config).HEIGHT).toBeUndefined()
  })

  it('runs the default suites unless told otherwise', () => {
    expect(new Set(sweep().map((config) => config.suite))).toEqual(new Set(DEFAULT_SUITES))
  })
})

describe('size scaling', () => {
  const size = sweep(['size'])

  it('covers 1×1 through 4×4, which is what the ~3 s threshold is about', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(size.some((config) => config.id === `size/square-${String(n)}x${String(n)}`)).toBe(true)
    }
  })

  it('goes past 4×4 to 8×8, the largest the geometry offers', () => {
    expect(size.some((config) => config.id === 'size/square-8x8')).toBe(true)
  })

  it('includes 1×1 even though the customizer enum starts at 2', () => {
    const smallest = size.find((config) => config.id === 'size/square-1x1')
    expect(resolvedParams(smallest as (typeof size)[number]).x).toEqual({ kind: 'number', value: 1 })
  })

  it('labels its lock through the table, so the row is not read as -D LOCK=openlock', () => {
    for (const config of size) expect(lockOf(config)).toBe('triplex')
  })
})

describe('lock coverage', () => {
  const locks = sweep(['lock'])

  it('covers all five -D LOCK values', () => {
    const covered = new Set(locks.map((config) => lockOf(config)))
    expect(covered).toEqual(new Set(['openlock', 'triplex', 'infinitylock', 'dragonlock', 'none']))
  })

  it('varies magnets, since magnets are the other connector axis', () => {
    const magnets = new Set(locks.map((config) => String(resolvedParams(config).MAGNETS?.value)))
    expect(magnets).toEqual(new Set(['flex_magnetic', 'none']))
  })

  it('pairs MAGNET_HOLE with MAGNETS the way the corpus did — 6 on, 0 off', () => {
    for (const config of locks) {
      const params = resolvedParams(config)
      const expected = params.MAGNETS?.value === 'none' ? 0 : 6
      expect(params.MAGNET_HOLE?.value).toBe(expected)
    }
  })

  it('measures each lock at two sizes, so a lock cost can be told from a size cost', () => {
    const dragonlock = locks.filter((config) => lockOf(config) === 'dragonlock')
    expect(new Set(dragonlock.map((config) => String(resolvedParams(config).x?.value)))).toEqual(new Set(['2', '4']))
  })
})

describe('shape coverage', () => {
  const shapes = sweep(['shape'])

  it('measures curved against square, which is what the row asked', () => {
    const entries = shapes.map((config) => config.entry)
    expect(entries).toContain('bases-square.scad')
    expect(entries).toContain('bases-curved.scad')
    expect(entries).toContain('bases-curved-inverted.scad')
    expect(entries).toContain('bases-curved-radial.scad')
  })

  it('uses DIAGONAL_BASIS for bases-diagonal, which names its basis differently', () => {
    const diagonal = shapes.find((config) => config.entry === 'bases-diagonal.scad')
    const params = resolvedParams(diagonal as (typeof shapes)[number])
    expect(params.DIAGONAL_BASIS).toBeDefined()
    expect(params.SQUARE_BASIS).toBeUndefined()
  })

  it('sizes hex by `size`, not x/y', () => {
    const hex = shapes.find((config) => config.entry === 'bases-hex.scad')
    const params = resolvedParams(hex as (typeof shapes)[number])
    expect(params.size).toBeDefined()
    expect(params.x).toBeUndefined()
  })

  it('does not touch bases-wall-primary, which S1 deliberately did not vendor', () => {
    for (const config of sweep(SUITES)) expect(config.entry).not.toBe('bases-wall-primary.scad')
  })

  it('does not touch the legacy bases.scad monolith, which cannot compile with connectors.scad', () => {
    for (const config of sweep(SUITES)) expect(config.entry).not.toBe('bases.scad')
  })
})

describe('backend coverage', () => {
  const backends = sweep(['backend'])

  it('runs both kernels, so the mandatory flag has a price attached', () => {
    expect(new Set(backends.map((config) => config.backend))).toEqual(new Set(['manifold', 'cgal']))
  })

  it('pairs them on identical geometry, so the ids differ only by kernel', () => {
    for (const cgal of backends.filter((config) => config.backend === 'cgal')) {
      const twin = backends.find((config) => config.id === cgal.id.replace('cgal', 'manifold'))
      expect(twin).toBeDefined()
      expect(resolvedParams(twin as (typeof backends)[number])).toEqual(resolvedParams(cgal))
    }
  })
})

describe('basis coverage — trap 3', () => {
  const bases = sweep(['basis'])

  it('covers all four SQUARE_BASIS values', () => {
    const covered = new Set(bases.map((config) => String(resolvedParams(config).SQUARE_BASIS?.value)))
    expect(covered).toEqual(new Set(['25mm', 'inch', 'wyloch', 'drc']))
  })

  it('expects exactly three refusals: dragonlock on the three non-inch bases', () => {
    const refused = bases.filter((config) => geometryRefusal(config) !== undefined)
    expect(refused).toHaveLength(3)
    for (const config of refused) expect(String(resolvedParams(config).LOCK?.value)).toBe('dragonlock')
  })

  it('leaves openlock renderable on every basis', () => {
    const openlock = bases.filter((config) => resolvedParams(config).LOCK?.value === 'openlock')
    expect(openlock).toHaveLength(4)
    for (const config of openlock) expect(geometryRefusal(config)).toBeUndefined()
  })
})

describe("the plan's own rows", () => {
  const plan = sweep(['plan'])

  it('has a configuration for every §3.5 row it carries an estimate for', () => {
    for (const row of PLAN_ROWS) expect(plan.some((config) => config.id === row.id)).toBe(true)
  })

  it('reproduces the 4×4 case the ~3 s threshold names specifically', () => {
    const fourByFour = plan.find((config) => config.id === 'plan/square-4x4-openlock-flex')
    const params = resolvedParams(fourByFour as (typeof plan)[number])
    expect(params.x?.value).toBe(4)
    expect(params.y?.value).toBe(4)
    expect(params.MAGNETS?.value).toBe('flex_magnetic')
  })

  it('reads "openlock" in a catalogued filename as -D LOCK="triplex"', () => {
    const fourByFour = plan.find((config) => config.id === 'plan/square-4x4-openlock-flex')
    expect(lockOf(fourByFour as (typeof plan)[number])).toBe('triplex')
  })

  it('renders every plan row rather than refusing any of them', () => {
    for (const config of plan) expect(geometryRefusal(config)).toBeUndefined()
  })

  it('carries the estimates as data, so the report compares rather than asserts', () => {
    expect(PLAN_ROWS.map((row) => row.estimatedTriangles)).toEqual([10_807, 23_671, 86_144, 180_100])
  })
})

describe('parseSuites', () => {
  it('accepts a comma-separated list', () => {
    expect(parseSuites('size,plan')).toEqual(['size', 'plan'])
  })

  it('tolerates whitespace and empties', () => {
    expect(parseSuites(' size , , plan ')).toEqual(['size', 'plan'])
  })

  it('refuses an unknown name rather than silently running less', () => {
    expect(() => parseSuites('size,nope')).toThrow(/unknown suite/)
  })
})

describe('the CGAL repeat cap', () => {
  it('caps CGAL rows, because 25 s per render would be the whole run', () => {
    for (const config of sweep(['backend'])) {
      if (config.backend === 'cgal') expect(config.maxRepeats).toBe(CGAL_MAX_REPEATS)
      else expect(config.maxRepeats).toBeUndefined()
    }
  })

  it('stops the backend ladder at 4×4 by default', () => {
    const sizes = sweep(['backend']).map((config) => String(resolvedParams(config).x?.value))
    expect(new Set(sizes)).toEqual(new Set(['2', '4']))
  })

  it('adds 8×8 only under --heavy', () => {
    const sizes = sweep(['backend'], { heavy: true }).map((config) => String(resolvedParams(config).x?.value))
    expect(new Set(sizes)).toEqual(new Set(['2', '4', '8']))
  })

  it('leaves the manifold size sweep unaffected by --heavy', () => {
    expect(sweep(['size'], { heavy: true })).toEqual(sweep(['size']))
  })
})

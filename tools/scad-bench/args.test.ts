/**
 * Argument construction, which is where a benchmark quietly measures the wrong
 * thing.
 *
 * Each assertion here corresponds to a documented trap: the ASCII-STL alias, the
 * CGAL default, string-typed `"true"`, the un-overridable `$fn`, and the
 * non-inch basis refusal. No engine is needed to check any of them, which is the
 * point — CI has no OpenSCAD.
 */
import { describe, expect, it } from 'vitest'

import { buildArgs, defineArg, geometryRefusal, lockOf, num, resolvedParams, str } from './args'
import type { BenchConfig } from './args'

const OPTIONS = { scadDir: '/repo/src/generator/scad', outPath: '/tmp/out.stl' }

function config(over: Partial<BenchConfig> = {}): BenchConfig {
  return {
    id: 'test/one',
    suite: 'test',
    entry: 'bases-square.scad',
    backend: 'manifold',
    params: { x: num(4), y: num(4), SQUARE_BASIS: str('inch'), LOCK: str('openlock'), TOPLESS: str('true') },
    ...over,
  }
}

describe('defineArg', () => {
  it('quotes strings, because "true" is a string in these files', () => {
    expect(defineArg('TOPLESS', str('true'))).toBe('-D TOPLESS="true"')
  })

  it('leaves numbers bare', () => {
    expect(defineArg('MAGNET_HOLE', num(6))).toBe('-D MAGNET_HOLE=6')
  })

  it('refuses $fn, which a command line cannot override', () => {
    expect(() => defineArg('$fn', num(100))).toThrow(/call-site argument/)
  })

  it('refuses $fa and $fs for the same reason', () => {
    expect(() => defineArg('$fa', num(1))).toThrow(/refused/)
    expect(() => defineArg('$fs', num(1))).toThrow(/refused/)
  })

  it('refuses a value that would break its own quoting', () => {
    expect(() => defineArg('LOCK', str('open"lock'))).toThrow(/must not contain a quote/)
  })

  it('refuses a non-finite number rather than emitting -D x=NaN', () => {
    expect(() => defineArg('x', num(Number.NaN))).toThrow(/non-finite/)
  })
})

describe('buildArgs', () => {
  const argv = buildArgs(config(), OPTIONS)

  it('exports binary STL, never the `stl` suffix that aliases to ASCII', () => {
    expect(argv).toContain('--export-format=binstl')
    expect(argv.join(' ')).not.toMatch(/--export-format=stl\b/)
  })

  it('passes the backend explicitly, because an old build defaults to CGAL', () => {
    expect(argv).toContain('--backend=manifold')
  })

  it('honours a cgal configuration rather than forcing manifold', () => {
    expect(buildArgs(config({ backend: 'cgal' }), OPTIONS)).toContain('--backend=cgal')
  })

  it('resolves the entry point beside its includes, which are flat siblings', () => {
    expect(argv[0]).toBe('/repo/src/generator/scad/bases-square.scad')
  })

  it('sorts -D flags so a configuration has one canonical command line', () => {
    const defines = argv.filter((arg) => arg.startsWith('-D ')).map((arg) => arg.slice(3).split('=')[0])
    expect(defines).toEqual([...defines].sort((a, b) => (a as string).localeCompare(b as string)))
  })

  it('is stable across calls', () => {
    expect(buildArgs(config(), OPTIONS)).toEqual(argv)
  })

  it('refuses an entry point outside the vendored set', () => {
    expect(() => buildArgs(config({ entry: '../evil.scad' }), OPTIONS)).toThrow(/bare .scad filename/)
    expect(() => buildArgs(config({ entry: 'bases-square' }), OPTIONS)).toThrow(/bare .scad filename/)
  })
})

describe('the lock table applied to parameters', () => {
  it('lets the label win over an inline LOCK, since the label is the choice', () => {
    const params = resolvedParams(
      config({ params: { LOCK: str('dragonlock') }, lockLabel: { label: 'openlock', family: 'square' } }),
    )
    expect(params.LOCK).toEqual(str('triplex'))
  })

  it('applies the curved family to the same label differently', () => {
    const params = resolvedParams(config({ lockLabel: { label: 'openlock', family: 'curved' } }))
    expect(params.LOCK).toEqual(str('openlock'))
  })

  it('brings SUPPORTS along with an unsupported label', () => {
    const params = resolvedParams(config({ lockLabel: { label: 'openlock+unsupported', family: 'square' } }))
    expect(params.SUPPORTS).toEqual(str('false'))
  })

  it('reports the -D LOCK value for grouping, not the label', () => {
    expect(lockOf(config({ lockLabel: { label: 'openlock', family: 'square' } }))).toBe('triplex')
  })
})

describe('geometryRefusal — trap 3', () => {
  it('refuses dragonlock on a non-inch basis, as bases-*.scad does', () => {
    const refusal = geometryRefusal(
      config({ params: { SQUARE_BASIS: str('25mm'), LOCK: str('dragonlock') } }),
    )
    expect(refusal).toMatch(/dragonlock is only compatible with the inch basis/)
  })

  it('refuses infinitylock on wyloch and drc too', () => {
    for (const basis of ['wyloch', 'drc']) {
      expect(
        geometryRefusal(config({ params: { SQUARE_BASIS: str(basis), LOCK: str('infinitylock') } })),
      ).toBeDefined()
    }
  })

  it('allows openlock on every basis', () => {
    for (const basis of ['25mm', 'inch', 'wyloch', 'drc']) {
      expect(geometryRefusal(config({ params: { SQUARE_BASIS: str(basis), LOCK: str('openlock') } }))).toBeUndefined()
    }
  })

  it('allows dragonlock on inch, which is what the whole corpus is', () => {
    expect(
      geometryRefusal(config({ params: { SQUARE_BASIS: str('inch'), LOCK: str('dragonlock') } })),
    ).toBeUndefined()
  })

  it('says nothing about an entry point that names its basis differently', () => {
    // bases-diagonal.scad uses DIAGONAL_BASIS; the square rule does not apply.
    expect(
      geometryRefusal(config({ entry: 'bases-diagonal.scad', params: { DIAGONAL_BASIS: str('drc'), LOCK: str('dragonlock') } })),
    ).toBeUndefined()
  })
})

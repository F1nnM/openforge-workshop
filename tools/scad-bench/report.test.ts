/**
 * The recommendation, which is the deliverable.
 *
 * `recommend()` is the function that turns milliseconds into a UX decision, so
 * it is tested against fixture timings at each side of both thresholds — the
 * plan's 3 s refusal line and the live-interaction budget. No engine is
 * involved: the input is a `RunReport`, which is data.
 */
import { describe, expect, it } from 'vitest'

import { AUTO_PREVIEW_BUDGET_MS, LIVE_BUDGET_MS, backendNote, fullReport, header, lockNote, planCheck, recommend, recommendation, reportFromSaved, warningNote } from './report'
import type { Machine } from './report'
import type { BenchResult, RunReport } from './run'
import type { Engine } from './engine'

const WASM: Engine = {
  kind: 'wasm',
  command: '/usr/bin/node',
  prefix: ['/e/openscad.cjs'],
  version: 'OpenSCAD version 2026.01.02.wasm30347',
  source: '.engines/wasm-node/openscad.cjs',
}
const NATIVE: Engine = { ...WASM, kind: 'native', command: '/e/AppRun', prefix: [], version: 'OpenSCAD version 2026.01.02.ai30348' }

const MACHINE: Machine = {
  platform: 'linux',
  release: '7.0.0',
  arch: 'x64',
  cpu: 'AMD Ryzen 5 7640U',
  cores: 12,
  memoryGb: 60,
  node: '22.23.2',
}

/** A measured result at a given warm latency, repeated so warm has a sample. */
function measured(id: string, warmMs: number, over: Partial<BenchResult> = {}): BenchResult {
  return {
    id,
    suite: id.split('/')[0] ?? 'x',
    outcome: 'measured',
    timings: { cold: warmMs * 3, warm: [warmMs, warmMs, warmMs, warmMs] },
    triangles: 6488,
    bytes: 324_484,
    argv: ['bases-square.scad'],
    backend: 'manifold',
    entry: 'bases-square.scad',
    params: {},
    ...over,
  }
}

/**
 * `floorMs` defaults to 0 so a fixture latency is its own geometry cost. The
 * grading split — plan threshold on the total, live budget on total-minus-floor —
 * is exercised explicitly by the `floor` describe block below.
 */
function report(results: readonly BenchResult[], engine: Engine = WASM, floorMs = 0): RunReport {
  return {
    engine,
    results,
    startupFloor: { cold: floorMs * 3, warm: [floorMs, floorMs, floorMs, floorMs] },
    elapsedMs: 1000,
  }
}

describe('recommend', () => {
  it('says auto-preview when everything clears the live budget', () => {
    const decision = recommend(report([measured('plan/square-4x4-openlock-flex', 60), measured('size/square-8x8', 90)]))
    expect(decision.verdict).toBe('auto-preview')
    expect(decision.overLiveBudget).toEqual([])
    expect(decision.overPlanBudget).toEqual([])
  })

  it('says debounced when something clears 3 s but not the live budget', () => {
    const decision = recommend(
      report([measured('plan/square-4x4-openlock-flex', 60), measured('size/square-8x8', LIVE_BUDGET_MS + 50)]),
    )
    expect(decision.verdict).toBe('auto-preview-debounced')
    expect(decision.overLiveBudget).toEqual(['size/square-8x8'])
  })

  it('says Generate button as soon as one shippable row passes 3 s', () => {
    const decision = recommend(
      report([measured('plan/square-4x4-openlock-flex', 60), measured('size/square-8x8', AUTO_PREVIEW_BUDGET_MS + 1)]),
    )
    expect(decision.verdict).toBe('generate-button')
    expect(decision.overPlanBudget).toEqual(['size/square-8x8'])
  })

  it('grades on p95, not the median, so a bimodal configuration cannot hide', () => {
    const spiky = measured('size/square-4x4', 50)
    const decision = recommend(
      report([{ ...spiky, timings: { cold: 900, warm: [50, 50, 50, AUTO_PREVIEW_BUDGET_MS + 500] } }]),
    )
    expect(decision.verdict).toBe('generate-button')
  })

  it('excludes CGAL rows from the verdict, because S4 ships Manifold', () => {
    const decision = recommend(
      report([
        measured('plan/square-4x4-openlock-flex', 60),
        measured('backend/cgal-4x4', 3500, { backend: 'cgal', suite: 'backend' }),
      ]),
    )
    expect(decision.verdict).toBe('auto-preview')
    expect(decision.overPlanBudget).toEqual([])
  })

  it('excludes refused configurations, which are not slow but absent', () => {
    const refused: BenchResult = {
      id: 'basis/drc-dragonlock-4x4',
      suite: 'basis',
      outcome: 'refused',
      reason: 'dragonlock is only compatible with the inch basis',
      argv: [],
      backend: 'manifold',
      entry: 'bases-square.scad',
      params: {},
    }
    const decision = recommend(report([measured('plan/square-4x4-openlock-flex', 60), refused]))
    expect(decision.verdict).toBe('auto-preview')
    expect(decision.worst?.id).toBe('plan/square-4x4-openlock-flex')
  })

  it('names the slowest shippable configuration, so the number has an owner', () => {
    const decision = recommend(report([measured('a/one', 60), measured('b/two', 200), measured('c/three', 90)]))
    expect(decision.worst?.id).toBe('b/two')
    expect(decision.worst?.p95Ms).toBe(200)
  })

  it('surfaces the 4×4 row specifically, since that is the threshold the plan names', () => {
    const decision = recommend(report([measured('plan/square-4x4-openlock-flex', 61), measured('size/square-2x2', 40)]))
    expect(decision.fourByFour?.id).toBe('plan/square-4x4-openlock-flex')
    expect(decision.fourByFour?.medianMs).toBe(61)
  })

  it('records the engine kind, so a native verdict cannot be quoted as the shipped one', () => {
    expect(recommend(report([measured('a/one', 60)], NATIVE)).engineKind).toBe('native')
  })
})

describe('recommendation text', () => {
  it('quotes the number behind the verdict', () => {
    const text = recommendation(report([measured('plan/square-4x4-openlock-flex', 61)]))
    expect(text).toMatch(/AUTO-PREVIEW/)
    expect(text).toMatch(/61 ms/)
    expect(text).toMatch(/3\.00 s threshold/)
  })

  it('shouts about a native measurement', () => {
    const text = recommendation(report([measured('a/one', 60)], NATIVE))
    expect(text).toMatch(/MEASURED ON A NATIVE BUILD/)
    expect(text).toMatch(/upper bound/)
  })

  it('says nothing of the sort for a WASM measurement', () => {
    expect(recommendation(report([measured('a/one', 60)]))).not.toMatch(/NATIVE BUILD/)
  })
})

describe('the header', () => {
  it('carries the engine version, without which there is no measurement', () => {
    expect(header(WASM, MACHINE, 7)).toContain('OpenSCAD version 2026.01.02.wasm30347')
  })

  it('carries the machine', () => {
    const text = header(WASM, MACHINE, 7)
    expect(text).toContain('AMD Ryzen 5 7640U')
    expect(text).toContain('12 threads')
    expect(text).toContain('node 22.23.2')
  })

  it('warns in the header itself when the engine is native', () => {
    expect(header(NATIVE, MACHINE, 7)).toMatch(/NOT what S4 ships/)
  })

  it('says the WASM build is the shipped one', () => {
    expect(header(WASM, MACHINE, 7)).toMatch(/the build S4 ships/)
  })
})

describe('the trap-1 note', () => {
  it('states both mappings, so no row can be mis-attributed', () => {
    const note = lockNote()
    expect(note).toContain('square: -D LOCK="triplex"')
    expect(note).toContain('curved: -D LOCK="openlock"')
    expect(note).toContain('PROVENANCE.md')
  })
})

describe('the plan check', () => {
  it('prints the estimate beside the measurement', () => {
    const text = planCheck(report([measured('plan/square-4x4-openlock-flex', 61)]))
    expect(text).toContain('23671')
    expect(text).toContain('6488')
  })

  it('marks an estimate that was orders out', () => {
    expect(planCheck(report([measured('plan/square-4x4-openlock-flex', 61)]))).toMatch(/× fast/)
  })

  it('says nothing about a row that was not run', () => {
    expect(planCheck(report([]))).not.toContain('23671')
  })
})

describe('the backend note', () => {
  it('quantifies what dropping --backend=manifold costs', () => {
    const text = backendNote(
      report([
        measured('backend/manifold-4x4', 70, { suite: 'backend' }),
        measured('backend/cgal-4x4', 3220, { suite: 'backend', backend: 'cgal' }),
      ]),
    )
    expect(text).toMatch(/46\.0× slower/)
  })

  it('is empty when the suite did not run', () => {
    expect(backendNote(report([measured('size/square-4x4', 60)]))).toBe('')
  })
})

describe('the upstream-warning note', () => {
  it('reports an ignored variable, since an ignored variable is a branch not taken', () => {
    const text = warningNote(
      report([measured('size/square-4x4', 60, { unknownVariables: [{ name: 'DUAL', occurrences: 12 }] })]),
    )
    expect(text).toContain('"DUAL"')
    expect(text).toMatch(/branch not taken/)
  })

  it('is empty when the engine warned about nothing', () => {
    expect(warningNote(report([measured('size/square-4x4', 60)]))).toBe('')
  })
})

describe('fullReport', () => {
  it('ends with the recommendation, which is what the row was for', () => {
    const text = fullReport(report([measured('plan/square-4x4-openlock-flex', 61)]), MACHINE, 7, ['plan'])
    expect(text.trimEnd().split('RECOMMENDATION')).toHaveLength(2)
    expect(text.indexOf('RECOMMENDATION')).toBeGreaterThan(text.indexOf('engine '))
  })

  it('footnotes the degenerate p95 rather than leaving it to be assumed', () => {
    const text = fullReport(report([measured('plan/square-4x4-openlock-flex', 61)]), MACHINE, 7, ['plan'])
    expect(text).toMatch(/p95 over fewer than 20 samples is the maximum/)
  })

  it('reports the startup floor, so a figure can be read as fixed cost plus geometry', () => {
    const text = fullReport(report([measured('plan/square-4x4-openlock-flex', 361)], WASM, 300), MACHINE, 7, ['plan'])
    expect(text).toMatch(/startup floor/)
    expect(text).toMatch(/cube\(0\.01\)/)
  })
})

describe('the two thresholds are graded on different quantities', () => {
  /**
   * The defect this block exists to prevent. The WASM engine pays ~280 ms to
   * compile its module in every fresh process. Graded on the total, every
   * configuration in the sweep exceeds a 250 ms live budget before any geometry
   * runs, and the over-budget list names all 46 rows — true, and useless. The
   * live budget is therefore graded on total minus the measured floor.
   */
  it('does not flag a row whose cost is entirely the startup floor', () => {
    const decision = recommend(report([measured('size/square-1x1', 320)], WASM, 300))
    expect(decision.overLiveBudget).toEqual([])
    expect(decision.verdict).toBe('auto-preview')
  })

  it('flags a row whose geometry alone exceeds the live budget', () => {
    const decision = recommend(report([measured('shape/riser-4x4', 600)], WASM, 300))
    expect(decision.overLiveBudget).toEqual(['shape/riser-4x4'])
    expect(decision.verdict).toBe('auto-preview-debounced')
  })

  it('still grades the 3 s threshold on the total, which a first render really pays', () => {
    const decision = recommend(report([measured('a/one', AUTO_PREVIEW_BUDGET_MS + 100)], WASM, 300))
    expect(decision.overPlanBudget).toEqual(['a/one'])
    expect(decision.verdict).toBe('generate-button')
  })

  it('records the floor it graded against, so the split is auditable', () => {
    expect(recommend(report([measured('a/one', 400)], WASM, 300)).floorMs).toBe(300)
  })

  it('orders the live-budget list worst geometry first', () => {
    const decision = recommend(
      report([measured('a/small', 400), measured('b/large', 900), measured('c/mid', 650)], WASM, 300),
    )
    expect(decision.overLiveBudget).toEqual(['b/large', 'c/mid'])
  })

  it('summarises a long list instead of printing every id', () => {
    const many = Array.from({ length: 20 }, (_, index) => measured(`x/row-${String(index)}`, 900 + index))
    const text = recommendation(report(many, WASM, 300))
    expect(text).toMatch(/… and 14 more/)
  })

  it('explains in the text which quantity each threshold used', () => {
    const text = recommendation(report([measured('a/one', 400)], WASM, 300))
    expect(text).toMatch(/geometry-only p95/)
    expect(text).toMatch(/on total p95/)
  })
})

describe('reportFromSaved', () => {
  it('re-derives a report from a saved run, so a PR body quotes the artefact', () => {
    const text = reportFromSaved({
      engine: WASM,
      machine: MACHINE,
      repeats: 21,
      suites: ['plan'],
      startupFloor: { cold: 273, warm: [279, 279, 279, 279] },
      results: [measured('plan/square-4x4-openlock-flex', 437)],
      elapsedMs: 900_000,
    })
    expect(text).toContain('OpenSCAD version 2026.01.02.wasm30347')
    expect(text).toContain('437 ms')
    expect(text).toMatch(/RECOMMENDATION/)
  })
})

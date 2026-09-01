/**
 * The readout, and the recommendation.
 *
 * The deliverable of row S2 is not a table, it is an answer: *can S4
 * auto-preview, or does it need a Generate button?* So the report ends with the
 * recommendation, computed from the measurement rather than written by hand, and
 * `recommend()` is the function a reader should check if they distrust the prose.
 *
 * Three things are printed that a shorter report would omit and shouldn't:
 *
 * - **The engine, verbatim, at the top.** A latency figure without its engine
 *   version is not a measurement.
 * - **Whether p95 is degenerate.** With fewer than 20 samples nearest-rank p95 is
 *   the maximum. Saying so is the difference between a statistic and a decoration.
 * - **Both lock names.** `openlock` as a catalogued filename label is
 *   `-D LOCK="triplex"` on the square side, so a row labelled only one way is
 *   ambiguous between two different meshes (`PROVENANCE.md` trap 1).
 */
import type { Engine } from './engine'
import type { BenchResult, RunReport } from './run'
import { decompose, distribution, ms, ratio, split } from './stats'
import type { Distribution } from './stats'
import { swappedLabels } from './locks'
import { PLAN_ROWS } from './sweep'
import { trianglesFromBytes } from './stl'

/** The plan's threshold: "if a 4×4 base exceeds ~3 s, S4 needs a Generate button". */
export const AUTO_PREVIEW_BUDGET_MS = 3000

/**
 * The interaction budget auto-preview actually needs, which is not the same thing.
 *
 * 3 s is the plan's *refusal* threshold — past it, auto-preview is off the table.
 * But a preview that re-renders on every parameter change is a live control, and a
 * live control that takes a second still feels broken even though it clears 3 s.
 * So the recommendation is graded against both, and the gap between them is where
 * "auto-preview, debounced" lives.
 *
 * **The two thresholds are graded on different quantities, and that is the point.**
 *
 * - The 3 s threshold is graded on the **total** wall clock, because a user's
 *   first render really does pay engine start-up.
 * - The live budget is graded on the **geometry-only** figure — total minus the
 *   measured startup floor — because the thing being judged is the *incremental*
 *   cost of moving a parameter, and the shipped worker holds a compiled
 *   `WebAssembly.Module` across renders rather than recompiling 10.5 MB each time.
 *
 * Grading the live budget on the total instead is not conservative, it is wrong:
 * the WASM floor alone is ~280 ms, so every configuration in the sweep exceeds
 * 250 ms before any geometry happens, and the resulting list flags all 46 rows and
 * tells the reader nothing about which parameter costs what.
 */
export const LIVE_BUDGET_MS = 250

/** How many ids to name in the over-budget lines before summarising the rest. */
const LIST_LIMIT = 6

export interface Machine {
  readonly platform: string
  readonly release: string
  readonly arch: string
  readonly cpu: string
  readonly cores: number
  readonly memoryGb: number
  readonly node: string
}

export function header(engine: Engine, machine: Machine, repeats: number): string {
  const lines = [
    'engine        ' + engine.version,
    `  build       ${engine.kind}${engine.kind === 'native' ? ' — NOT what S4 ships; see the note below' : ' — the build S4 ships'}`,
    `  found via   ${engine.source}`,
    `  command     ${engine.command} ${engine.prefix.join(' ')}`.trimEnd(),
    `machine       ${machine.cpu} · ${String(machine.cores)} threads · ${String(machine.memoryGb)} GB · ` +
      `${machine.platform} ${machine.release} ${machine.arch} · node ${machine.node}`,
    `method        ${String(repeats)} renders per configuration, one process each (§2: a fresh instance per job),`,
    '              sequentially; first render reported as cold, the rest as warm',
  ]
  if (engine.kind === 'native') {
    lines.push(
      '',
      'WARNING       This is a NATIVE build. S4 ships the WASM build, which is slower.',
      '              Do not quote these figures as browser latency. Run again with the',
      '              WASM engine (see `npm run scad-bench -- --help`) for the shipped number.',
    )
  }
  return `${lines.join('\n')}\n`
}

/** The trap-1 table, printed so a reader cannot mis-attribute a row. */
export function lockNote(): string {
  const rows = swappedLabels().map(
    (row) => `  "${row.label}" → square: -D LOCK="${row.square}" · curved: -D LOCK="${row.curved}"`,
  )
  return [
    'lock naming   The catalogued filename label is NOT the -D LOCK value, and the two',
    '              swapped entries are mirrored between the square and curved generators',
    '              (src/generator/PROVENANCE.md, trap 1):',
    ...rows,
    '              Rows below are labelled by their -D LOCK value. Where a configuration',
    '              reproduces a catalogued filename, the label is shown beside it.',
  ].join('\n')
}

function warm(result: BenchResult): Distribution | undefined {
  return result.timings === undefined ? undefined : split(result.timings).warm
}

function row(result: BenchResult, floor: number): string {
  const id = result.id.padEnd(36)
  if (result.outcome === 'refused') return `  ${id} refused  — ${result.reason ?? ''}`
  if (result.outcome === 'failed') return `  ${id} FAILED   — ${result.reason ?? ''}`
  const timings = result.timings
  const distributionWarm = warm(result)
  if (timings === undefined || distributionWarm === undefined) {
    return `  ${id} measured — one sample only, no warm distribution`
  }
  const geometry = decompose(distributionWarm.median, floor).geometry
  const label = result.lockLabel === undefined ? '' : `  [${result.lockLabel}]`
  return (
    `  ${id} cold ${ms(timings.cold).padStart(8)} · warm median ${ms(distributionWarm.median).padStart(8)}` +
    ` · p95 ${ms(distributionWarm.p95).padStart(8)}${distributionWarm.p95IsMax ? '*' : ' '}` +
    ` · geom ${ms(geometry).padStart(8)} · ${String(result.triangles ?? 0).padStart(7)} tris${label}`
  )
}

export function suiteSection(report: RunReport, suite: string): string {
  const results = report.results.filter((result) => result.suite === suite)
  if (results.length === 0) return ''
  const floor = split(report.startupFloor).warm?.median ?? 0
  return [`\n${suite}`, ...results.map((result) => row(result, floor))].join('\n')
}

/**
 * The plan's §3.5 estimates against the measurement.
 *
 * Both the triangle count and the time are compared, because they are two
 * separate claims and they can fail independently: the plan derived triangles
 * from catalog STL bytes and then mapped triangles to seconds. Getting the first
 * wrong and the second wrong are different mistakes with different lessons.
 */
export function planCheck(report: RunReport): string {
  const lines = [
    '',
    'plan §3.5 check   docs/base-generator-integration.md derived these from catalog STL',
    '                  bytes via triangles = (bytes − 84) / 50, then estimated WASM seconds.',
    '',
    '  configuration                        est tris   real tris  ratio      est WASM   measured   verdict',
  ]
  for (const claim of PLAN_ROWS) {
    const result = report.results.find((candidate) => candidate.id === claim.id)
    if (result === undefined) continue
    const distributionWarm = warm(result)
    if (result.outcome !== 'measured' || distributionWarm === undefined) {
      lines.push(`  ${claim.id.padEnd(36)} ${String(claim.estimatedTriangles).padStart(9)}   ${result.outcome}`)
      continue
    }
    const real = result.triangles ?? 0
    const triangleRatio = real > 0 ? claim.estimatedTriangles / real : 0
    // Against the whole wall clock, not the geometry-only decomposition: the
    // plan estimated total render time, so that is the like-for-like comparison.
    const measured = distributionWarm.median
    const lowSeconds = claim.estimatedSeconds[0] * 1000
    const factor = measured > 0 ? lowSeconds / measured : 0
    lines.push(
      `  ${claim.id.padEnd(36)} ${String(claim.estimatedTriangles).padStart(9)}   ${String(real).padStart(9)}` +
        `  ${triangleRatio.toFixed(2)}×   ` +
        `${`${String(claim.estimatedSeconds[0])}–${String(claim.estimatedSeconds[1])} s`.padStart(9)}  ` +
        `${ms(distributionWarm.median).padStart(9)}  ${factor >= 2 ? `${factor.toFixed(0)}× fast` : 'in range'}`,
    )
  }
  lines.push(
    '',
    '  `real tris` is read from the rendered STL header (bytes 80–83) with the same',
    '  formula, so the two columns are the same quantity measured two ways.',
  )
  return lines.join('\n')
}

export interface Recommendation {
  /** The decision. */
  readonly verdict: 'auto-preview' | 'auto-preview-debounced' | 'generate-button'
  /** The configuration the decision rests on, and its number. */
  readonly worst: { id: string; medianMs: number; p95Ms: number; triangles: number } | undefined
  /** The 4×4 case the plan's threshold names specifically. */
  readonly fourByFour: { id: string; medianMs: number; p95Ms: number } | undefined
  /** Over the live budget on the **geometry-only** p95, worst first. */
  readonly overLiveBudget: readonly string[]
  /** Over the plan's 3 s threshold on the **total** p95, worst first. */
  readonly overPlanBudget: readonly string[]
  /** The startup floor the geometry-only figures were computed against. */
  readonly floorMs: number
  readonly engineKind: Engine['kind']
}

/**
 * The recommendation, computed.
 *
 * Deliberately pessimistic in two ways: it grades on p95 rather than the median,
 * and it grades on the *whole* measured wall clock rather than the geometry-only
 * decomposition, because a user waiting for a preview waits for the whole thing.
 *
 * Configurations the geometry refuses are excluded — they are not slow, they do
 * not exist. Rows using the CGAL backend are excluded from the *verdict* too,
 * because S4 ships Manifold; CGAL's cost is reported separately as the price of
 * dropping the flag.
 */
export function recommend(report: RunReport): Recommendation {
  const floor = split(report.startupFloor).warm?.median ?? split(report.startupFloor).cold
  const shippable = report.results.filter(
    (result) => result.outcome === 'measured' && result.backend === 'manifold' && result.timings !== undefined,
  )
  const scored = shippable
    .map((result) => {
      const distributionWarm = warm(result)
      return distributionWarm === undefined
        ? undefined
        : {
            id: result.id,
            medianMs: distributionWarm.median,
            p95Ms: distributionWarm.p95,
            geometryP95Ms: decompose(distributionWarm.p95, floor).geometry,
            triangles: result.triangles ?? 0,
          }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((a, b) => b.p95Ms - a.p95Ms)

  const worst = scored[0]
  const fourByFour =
    scored.find((entry) => entry.id === 'plan/square-4x4-openlock-flex') ??
    scored.find((entry) => entry.id.includes('4x4'))
  const overLiveBudget = [...scored]
    .sort((a, b) => b.geometryP95Ms - a.geometryP95Ms)
    .filter((entry) => entry.geometryP95Ms > LIVE_BUDGET_MS)
    .map((entry) => entry.id)
  const overPlanBudget = scored.filter((entry) => entry.p95Ms > AUTO_PREVIEW_BUDGET_MS).map((entry) => entry.id)

  const verdict: Recommendation['verdict'] =
    overPlanBudget.length > 0
      ? 'generate-button'
      : overLiveBudget.length > 0
        ? 'auto-preview-debounced'
        : 'auto-preview'

  return {
    verdict,
    ...(worst === undefined
      ? { worst: undefined }
      : { worst: { id: worst.id, medianMs: worst.medianMs, p95Ms: worst.p95Ms, triangles: worst.triangles } }),
    ...(fourByFour === undefined
      ? { fourByFour: undefined }
      : { fourByFour: { id: fourByFour.id, medianMs: fourByFour.medianMs, p95Ms: fourByFour.p95Ms } }),
    overLiveBudget,
    overPlanBudget,
    floorMs: floor,
    engineKind: report.engine.kind,
  }
}

/** Name the worst few and count the rest, rather than dumping 46 ids. */
function listed(ids: readonly string[]): string {
  if (ids.length === 0) return 'none'
  if (ids.length <= LIST_LIMIT) return ids.join(', ')
  return `${ids.slice(0, LIST_LIMIT).join(', ')} … and ${String(ids.length - LIST_LIMIT)} more`
}

const VERDICT_TEXT: Record<Recommendation['verdict'], string> = {
  'auto-preview':
    'AUTO-PREVIEW. Every shippable configuration clears the live-interaction budget, ' +
    'so the panel can re-render on parameter change with no Generate button.',
  'auto-preview-debounced':
    'AUTO-PREVIEW, DEBOUNCED. Everything clears the plan’s 3 s refusal threshold, ' +
    'but some configurations exceed the live-interaction budget, so coalesce changes ' +
    'behind a short debounce rather than rendering per keystroke.',
  'generate-button':
    'GENERATE BUTTON. At least one shippable configuration exceeds the plan’s ' +
    '3 s threshold, which is the condition the plan named for requiring one.',
}

export function recommendation(report: RunReport): string {
  const decision = recommend(report)
  const lines = ['', 'RECOMMENDATION', '', `  ${VERDICT_TEXT[decision.verdict]}`, '']
  if (decision.fourByFour !== undefined) {
    lines.push(
      `  The number behind it: ${decision.fourByFour.id} at ` +
        `${ms(decision.fourByFour.medianMs)} median, ${ms(decision.fourByFour.p95Ms)} p95, ` +
        `against the plan’s ${ms(AUTO_PREVIEW_BUDGET_MS)} threshold.`,
    )
  }
  if (decision.worst !== undefined) {
    lines.push(
      `  Slowest shippable configuration measured: ${decision.worst.id} at ` +
        `${ms(decision.worst.medianMs)} median / ${ms(decision.worst.p95Ms)} p95, ` +
        `${String(decision.worst.triangles)} triangles.`,
    )
  }
  lines.push(
    '',
    `  Over the ${ms(LIVE_BUDGET_MS)} live-interaction budget, on geometry-only p95 ` +
      `(total minus the ${ms(decision.floorMs)} startup floor — what a worker holding a`,
    `  compiled module pays per parameter change): ${listed(decision.overLiveBudget)}`,
    `  Over the ${ms(AUTO_PREVIEW_BUDGET_MS)} plan threshold, on total p95: ${listed(decision.overPlanBudget)}`,
  )
  if (decision.engineKind === 'native') {
    lines.push(
      '',
      '  MEASURED ON A NATIVE BUILD. S4 ships WASM. This verdict is an upper bound on',
      '  performance, not a prediction of it; re-run with --engine pointing at the WASM',
      '  glue before treating it as the shipped answer.',
    )
  }
  return lines.join('\n')
}

/** Startup floor and what it implies for a worker that keeps a compiled module. */
export function floorNote(report: RunReport): string {
  const floor = split(report.startupFloor)
  const median = floor.warm?.median ?? floor.cold
  return [
    '',
    'startup floor  `cube(0.01);` through the same engine and flags — process start, WASM',
    `               module compilation, and the parse of the include chain: cold ${ms(floor.cold)}, ` +
      `warm median ${ms(median)}.`,
    '               Every figure above includes it, because the shipped design spawns a fresh',
    '               instance per job (§2). `geom` subtracts it: that is what a worker holding a',
    '               compiled WebAssembly.Module would pay per parameter change.',
  ].join('\n')
}

/** What the `--backend` flag is worth, in this run's own numbers. */
export function backendNote(report: RunReport): string {
  const pairs: string[] = []
  for (const result of report.results.filter((candidate) => candidate.suite === 'backend')) {
    if (result.backend !== 'cgal' || result.outcome !== 'measured') continue
    const manifoldId = result.id.replace('cgal', 'manifold')
    const manifold = report.results.find((candidate) => candidate.id === manifoldId)
    const cgalWarm = warm(result)
    const manifoldWarm = manifold === undefined ? undefined : warm(manifold)
    if (cgalWarm === undefined || manifoldWarm === undefined) continue
    const factor = ratio(cgalWarm.median, manifoldWarm.median)
    pairs.push(
      `               ${result.id.replace('backend/cgal-', '')}: manifold ${ms(manifoldWarm.median)} · ` +
        `cgal ${ms(cgalWarm.median)}${factor === undefined ? '' : ` · ${factor.toFixed(1)}× slower`}`,
    )
  }
  if (pairs.length === 0) return ''
  return [
    '',
    'backend        --backend=manifold is not optional. Dropping it on a build that still',
    '               defaults to CGAL costs:',
    ...pairs,
  ].join('\n')
}

/** Upstream warnings worth a line, since they change the default geometry. */
export function warningNote(report: RunReport): string {
  const counts = new Map<string, number>()
  for (const result of report.results) {
    for (const unknown of result.unknownVariables ?? []) {
      counts.set(unknown.name, (counts.get(unknown.name) ?? 0) + 1)
    }
  }
  if (counts.size === 0) return ''
  const listed = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, configs]) => `"${name}" (in ${String(configs)} configurations)`)
  return [
    '',
    'upstream       The vendored set at the pinned commit references variables no entry point',
    `               declares, and OpenSCAD ignores them silently apart from a warning: ${listed.join(', ')}.`,
    '               Not ours to fix — but an ignored variable is a branch not taken, so this is',
    '               part of what the measured default geometry is.',
  ].join('\n')
}

/** Triangle throughput, to show what the cost actually scales with. */
export function scalingNote(report: RunReport): string {
  const floor = split(report.startupFloor).warm?.median ?? 0
  const rows = report.results
    .filter((result) => result.suite === 'size' && result.outcome === 'measured')
    .map((result) => {
      const distributionWarm = warm(result)
      if (distributionWarm === undefined) return undefined
      const geometry = decompose(distributionWarm.median, floor).geometry
      const triangles = result.triangles ?? 0
      return { id: result.id, geometry, triangles, perThousand: triangles > 0 ? (1000 * geometry) / triangles : 0 }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
  if (rows.length === 0) return ''
  const perThousand = distribution(rows.map((entry) => entry.perThousand))
  return [
    '',
    'scaling        geometry-only cost per 1,000 output triangles across the size sweep:',
    `               median ${perThousand === undefined ? 'n/a' : ms(perThousand.median)} ` +
      `· min ${perThousand === undefined ? 'n/a' : ms(perThousand.min)} ` +
      `· max ${perThousand === undefined ? 'n/a' : ms(perThousand.max)}`,
    `               ${String(rows[0]?.triangles ?? 0)} → ${String(rows[rows.length - 1]?.triangles ?? 0)} triangles ` +
      `over ${String(rows.length)} sizes.`,
  ].join('\n')
}

/** Whether the plan's byte-derived triangle formula reproduces on real output. */
export function formulaCheck(report: RunReport): string {
  const mismatches = report.results.filter(
    (result) =>
      result.outcome === 'measured' &&
      result.bytes !== undefined &&
      result.triangles !== undefined &&
      trianglesFromBytes(result.bytes) !== result.triangles,
  )
  const measured = report.results.filter((result) => result.outcome === 'measured').length
  return [
    '',
    `formula        triangles = (bytes − 84) / 50 reproduced the STL header count on ` +
      `${String(measured - mismatches.length)}/${String(measured)} rendered meshes.`,
  ].join('\n')
}

/**
 * Re-read a saved run so a report is derived from the artefact, not scrollback.
 *
 * The same discipline `tools/measure/summary.ts` applies: every figure quoted in a
 * PR body should be computed from the committed result set, so that a change to
 * how a figure is derived re-derives it rather than leaving a stale transcription
 * behind. It also means a fix to `recommend()` can be applied to a run that took
 * fifteen minutes without spending fifteen minutes again.
 */
export interface SavedRun {
  readonly engine: Engine
  readonly machine: Machine
  readonly repeats: number
  readonly suites: readonly string[]
  readonly startupFloor: RunReport['startupFloor']
  readonly results: readonly BenchResult[]
  readonly elapsedMs: number
}

export function reportFromSaved(saved: SavedRun): string {
  const report: RunReport = {
    engine: saved.engine,
    results: saved.results,
    startupFloor: saved.startupFloor,
    elapsedMs: saved.elapsedMs,
  }
  return fullReport(report, saved.machine, saved.repeats, saved.suites)
}

export function fullReport(report: RunReport, machine: Machine, repeats: number, suites: readonly string[]): string {
  const parts = [header(report.engine, machine, repeats), lockNote()]
  for (const suite of suites) parts.push(suiteSection(report, suite))
  parts.push(
    floorNote(report),
    scalingNote(report),
    backendNote(report),
    warningNote(report),
    formulaCheck(report),
    planCheck(report),
    '',
    '  * p95 over fewer than 20 samples is the maximum by nearest rank, not an estimate of a tail.',
    recommendation(report),
    '',
  )
  return parts.filter((part) => part !== '').join('\n')
}

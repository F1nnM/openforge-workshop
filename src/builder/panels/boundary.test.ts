/// <reference types="node" />
/**
 * The eager surface of the builder's panels and the store, asserted by reading
 * the source.
 *
 * This row wired three heavy things into eagerly-reachable modules and the whole
 * cost of getting it wrong is invisible: the app works, and every visitor to
 * every page downloads a generator they never opened. That has now happened
 * three times in this epic — S4's barrel took the entry chunk to 664,608 B, S5's
 * `recipeId` import took it to 665,083 B and emptied S4's lazy chunk, and a
 * `?raw` licence import put 11 KB of Apache-2.0 in the entry bundle — and each
 * time an A/B build found it rather than a test.
 *
 * `src/generator/panel/boundary.test.ts` and
 * `src/generator/placement/boundary.test.ts` hold the two lines inside those
 * directories. What neither can see is the *importers*: the bill panel, the
 * download hook and the store are on the other side, they are all eager, and
 * they are this row's files. So this is the third line.
 *
 * ## The three claims
 *
 *   1. **The download hook reaches `pack.ts` dynamically and only dynamically.**
 *      That module carries the md5 implementation and the STL parser and, one
 *      `import()` further on, 11 KB of Apache-2.0 licence text. Row S5's own
 *      table projected +5,260 B raw / +2,101 B gzipped for importing it
 *      statically from here; the measured chunks are `pack` 4,384 B, `md5`
 *      1,313 B and `notice` 15,963 B, all outside the entry bundle.
 *   2. **Nothing eager reaches the pinned parameter schemas.** 25 KB of JSON
 *      behind `panel/schemas.ts`, which `panel/recipe.ts` and therefore
 *      `placement/placement.ts` value-import. The bill panel needs a recipe
 *      *handle* and a footprint, and both are available without them.
 *   3. **Nothing eager reaches the engine seam.** `engine/index.ts`'s dynamic
 *      imports are what emit the 298 kB worker chunk and the 10.5 MB WASM, and
 *      `usePreview.ts` value-imports it — which is precisely why `triangleCount`
 *      had to move to `panel/mesh.ts` for `src/store/meshes.ts` to use it.
 *
 * ## Why these guards can fail
 *
 * Each one names an import **specifier**, resolved to a file, and walks the
 * static graph transitively. A substring match over file text is the third
 * vacuous guard this series found — S5's report has the details — so nothing
 * here matches text. Concretely: adding `import { buildGeneratedPack } from
 * '@/generator/placement/pack'` to `useArchiveDownload.ts` fails claim 1;
 * importing `GENERATED_ROTATION_STEP_DEG` from `placement/placement` into
 * `canvas/scene.ts` fails claim 2; importing `triangleCount` from
 * `./usePreview` instead of `./mesh` into `store/meshes.ts` fails claim 3. All
 * three are one plausible line of convenience away.
 *
 * ## What it cannot prove
 *
 * The **bundle**. Only a build can, and a dynamic `import()` is invisible to this
 * walk by design — that is the mechanism rather than a hole. The measurements are
 * in this row's report and in `routeTree.tsx`'s `assembliesRoute` docblock.
 *
 * The closure walker below **was** the fourth copy of the same twenty lines in
 * this repository, after `src/three/`, `src/generator/panel/` and
 * `src/generator/placement/`. This note argued the four copies were cheaper, and
 * that moving the walker to `tools/` "would make a test utility a shipped
 * module". Row X10 extracted it to `tools/boundary/closure.ts` anyway, and both
 * halves of that argument are worth correcting: nothing under `src/` imports it
 * outside a test, so it is in no bundle and was never going to be shipped; and
 * the four copies were not cheaper, because they had already diverged into four
 * different answers — one `EISDIR` bug, one walker that could not resolve an
 * `index.tsx`, and three that could not see a bare `import './x'` at all. The
 * fifth copy this note said would justify the extraction was not needed; the
 * divergence between the first four was. `closure.ts` carries the three
 * placements that were tried and the two that are closed.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { staticClosure as walk, staticImports } from '../../../tools/boundary/closure'

const SRC = resolve(process.cwd(), 'src')

/**
 * The walk, from `tools/boundary/closure.ts` — one copy for the four boundary tests.
 *
 * Row X10 collapsed the four near-identical walkers, one of which was this
 * file's; that module carries the `EISDIR` fix, the bare-side-effect import the
 * three copies outside `src/three` could not see, and why an asset specifier is
 * neither followed nor reported. The adapter below is the shape this file's
 * assertions already read: the entry dropped, and package names without their
 * importers.
 */
function closureOf(entry: string): { files: string[]; packages: string[] } {
  const closure = walk(entry)
  return {
    files: closure.files.filter((file) => file !== entry).map((file) => file.slice(SRC.length + 1)),
    packages: [...closure.packages.keys()],
  }
}

/** Modules no eagerly-reachable file may reach, and what each one costs. */
const FORBIDDEN = [
  // 10.5 MB of WASM, 99 KB of glue and the 298 kB worker chunk.
  'generator/engine/index.ts',
  // React plus the engine seam, which is what made `triangleCount` move.
  'generator/panel/usePreview.ts',
  // 25 KB of pinned parameter JSON.
  'generator/panel/schemas.ts',
  'generator/panel/recipe.ts',
  'generator/panel/resolve.ts',
  'generator/panel/sweep.ts',
  'generator/panel/controls.tsx',
  'generator/panel/GeneratorDrawer.tsx',
  // Reaches the two above, and `pack.ts` reaches md5, the STL parser and the
  // Apache-2.0 licence.
  'generator/placement/placement.ts',
  'generator/placement/pack.ts',
  'generator/placement/notice.ts',
  // Test-only, and it reaches `placement.ts` on purpose.
  'store/fixture.ts',
]

const EAGER_ENTRIES = [
  'builder/panels/index.ts',
  'builder/panels/BillPanel.tsx',
  'builder/panels/GeneratedBillSection.tsx',
  'builder/panels/useArchiveDownload.ts',
  'builder/panels/DownloadAction.tsx',
  'builder/canvas/index.ts',
  'builder/canvas/scene.ts',
  'builder/canvas/vacancy.ts',
  'store/index.ts',
  'store/meshes.ts',
  'store/schema.ts',
  'store/migrations.ts',
  'store/workshopStore.ts',
]

describe('the builder panels’ and the store’s eager surface', () => {
  it.each(EAGER_ENTRIES)('%s reaches nothing heavy', (entry) => {
    const reached = closureOf(join(SRC, entry)).files
    expect(reached.filter((file) => FORBIDDEN.includes(file))).toEqual([])
  })

  it('never reaches the engine seam from the store, which is why triangleCount moved', () => {
    // Named separately from the table above because it is the one this row
    // created the risk for: `meshes.ts` has to turn held bytes into a triangle
    // count in the builder's eager chunk, and the obvious import was the hook.
    const reached = closureOf(join(SRC, 'store/meshes.ts')).files
    expect(reached).toContain('generator/panel/mesh.ts')
    expect(reached).not.toContain('generator/panel/usePreview.ts')
  })

  it('gives generator/panel/mesh.ts an empty closure, which is what makes it free', () => {
    const closure = closureOf(join(SRC, 'generator/panel/mesh.ts'))
    expect(closure.files).toEqual([])
    expect(closure.packages).toEqual([])
  })
})

describe('the download hook reaches row S5’s pack dynamically', () => {
  const source = readFileSync(join(SRC, 'builder/panels/useArchiveDownload.ts'), 'utf8')

  it('has no static import of it, in any form', () => {
    expect(staticImports(source).filter((specifier) => specifier.includes('placement/pack'))).toEqual([])
    expect(closureOf(join(SRC, 'builder/panels/useArchiveDownload.ts')).files).not.toContain(
      'generator/placement/pack.ts',
    )
  })

  it('does import it, dynamically — so this is a boundary and not an omission', () => {
    // Without this the test above would also pass on a hook that had lost the
    // feature entirely, which is the failure mode a negative-only guard has.
    expect(source).toContain("import('@/generator/placement/pack')")
  })

  it('renders row S5’s URL-list shortfall without importing the function that composes it', () => {
    // `urlListShortfall` lives in `pack.ts`. The hook evaluates it while the
    // module is already loaded and puts the sentence on the failure object, so
    // `DownloadAction` renders a string and reaches none of `pack.ts` — which the
    // FORBIDDEN table above already asserts for that file. What is added here is
    // that the sentence is *actually produced*, because a component that rendered
    // an always-undefined field would pass every negative guard in this file.
    expect(source).toContain('pack.urlListShortfall(plan)')
    expect(readFileSync(join(SRC, 'builder/panels/DownloadAction.tsx'), 'utf8')).toContain(
      'state.failure.urlListShortfall',
    )
  })
})

describe('the bill panel’s generated section', () => {
  it('takes only the light half of row S5 — the bill and the scene, not the schemas', () => {
    const reached = closureOf(join(SRC, 'builder/panels/GeneratedBillSection.tsx')).files
    expect(reached).toContain('generator/placement/scene.ts')
    expect(reached).toContain('generator/placement/geometry.ts')
    expect(reached).not.toContain('generator/panel/schemas.ts')
    expect(reached).not.toContain('generator/panel/recipe.ts')

    // **`bill.ts` is deliberately *not* asserted here any more, and why it used
    // to appear is worth recording.** This component imports `GeneratedBill` and
    // `GeneratedBillLine` `type`-only, so it has no value edge to `bill.ts` at
    // all — the walker was reaching it the long way round, through
    // `@/routes` → `routeTree.tsx` → a static import of `BuilderScreen`, which
    // is the one module that calls `buildGeneratedBill`. Row X10 made the five
    // remaining routes lazy and that edge went with them, so the assertion
    // failed for a reason that was an improvement. The truthful statement is the
    // one left standing: the section reaches the light half by path and reaches
    // neither of the two heavy modules. Row S5's own `index.ts` note carries the
    // measurement for why the barrel is not used here.
    expect(reached).not.toContain('generator/placement/bill.ts')
  })

  /*
   * **A third `it` stood here and row R4 removed it, because its subject was
   * deleted and it would otherwise have been the next vacuous guard in this
   * series.**
   *
   * It was called "does not reach the plan canvas component, only its geometry
   * helpers", and its whole argument was that `@/builder/canvas`'s barrel
   * re-exported `PlanCanvas` — a React component with an SVG renderer behind it —
   * so a bill section importing `describeCell` from the barrel had to be checked
   * against the *resolved* graph rather than the specifier. R4 deleted
   * `PlanCanvas.tsx` and every other component in that directory; the barrel now
   * re-exports pure functions only, so there is no component for the assertion to
   * be about. Its one surviving line, `expect(reached).toContain(
   * 'builder/canvas/geometry.ts')`, asserted a positive that the block above
   * already covers by path — it would have gone on passing for ever while its
   * name claimed a negative it no longer tested.
   *
   * What would make it real again is a component reappearing under
   * `builder/canvas/`. Nothing is stopping that, and the honest guard for it is
   * the one this file already uses for everything else: add the module to
   * `FORBIDDEN` on the day there is one.
   */
})

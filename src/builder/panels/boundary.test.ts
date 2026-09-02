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
 * The closure walker below is the **fourth** copy of the same twenty lines in
 * this repository, after `src/three/`, `src/generator/panel/` and
 * `src/generator/placement/`. A test file cannot import another test file's
 * helper without becoming part of that suite, and moving it to `tools/` would
 * make a test utility a shipped module; four copies of a pure function that four
 * suites assert against is the cheaper of the two. Worth a shared
 * `tools/boundary/` module if a fifth is ever needed.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = resolve(process.cwd(), 'src')

/** Static `import`/`export … from` specifiers, excluding type-only ones. */
function staticImports(source: string): string[] {
  const found: string[] = []
  const pattern = /^\s*(?:import|export)\s+(?!type\s)([^;]*?)\s*from\s*'([^']+)'/gm

  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? ''
    const values = clause
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '' && !part.startsWith('type '))
    if (clause.startsWith('{') && values.length === 0) continue
    found.push(specifier)
  }
  return found
}

/**
 * A specifier to a file, or `null` for a package.
 *
 * **`isFile()`, not `existsSync()`, and that is a fix rather than a preference.**
 * The three existing copies of this walker test `existsSync(candidate) &&
 * !candidate.endsWith('/')`, which accepts a **directory**: `@/materials`
 * resolves to `src/materials`, which exists and does not end in a slash, so the
 * walker returns the directory and the next `readFileSync` throws `EISDIR`. It is
 * latent in the other three only because none of their closures happens to
 * contain a bare-directory import; every closure here does. Reported, so the
 * other three can be fixed in whichever row next owns them — an `EISDIR` from a
 * boundary test reads as a broken test rather than as a boundary breach, which
 * is the worse of the two failures.
 */
function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (base === null) return null

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not there. Try the next shape.
    }
  }
  return null
}

/** Walk the static graph from one entry, following in-repo modules only. */
function closureOf(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || files.has(file)) continue
    files.add(file)
    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      if (specifier.endsWith('.css') || specifier.endsWith('.json')) continue
      const resolved = resolveModule(file, specifier)
      if (resolved === null) packages.add(specifier)
      else queue.push(resolved)
    }
  }

  files.delete(entry)
  return { files: [...files].map((file) => file.slice(SRC.length + 1)), packages: [...packages] }
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
    expect(reached).toContain('generator/placement/bill.ts')
    expect(reached).toContain('generator/placement/scene.ts')
    expect(reached).toContain('generator/placement/geometry.ts')
    expect(reached).not.toContain('generator/panel/schemas.ts')
    expect(reached).not.toContain('generator/panel/recipe.ts')
  })

  it('does not reach the plan canvas component, only its geometry helpers', () => {
    // `describeCell` and `formatUnits` come from `@/builder/canvas`, whose barrel
    // does re-export `PlanCanvas` — so this asserts the *resolved* graph rather
    // than the specifier, and it is the assertion that would catch the barrel
    // growing a component the bill does not need.
    const reached = closureOf(join(SRC, 'builder/panels/GeneratedBillSection.tsx')).files
    expect(reached).toContain('builder/canvas/geometry.ts')
  })
})

/// <reference types="node" />
/**
 * The graph, asserted by reading the source.
 *
 * S4's `panel/boundary.test.ts` wrote this walker and its argument transfers
 * exactly: what is being protected is invisible when it breaks. Behind this row
 * sit 25 KB of pinned parameter schemas (`panel/schemas.ts`), 11 KB of Apache-2.0
 * licence text (`pack.ts`), and — two boundaries further on — a 10.5 MB
 * WebAssembly engine and the 298 kB worker chunk that `engine/index.ts`'s
 * dynamic imports emit. A convenience import on the wrong side of a line moves
 * some of that into a chunk that did not need it, and nothing fails.
 *
 * **It has already happened once in this series.** S4's barrel re-exported the
 * resolver and `usePreview` for *this row's* benefit; because `BuilderScreen`
 * imports the panel from that barrel, the re-export pulled `engine/index.ts` into
 * the entry chunk and took it from 642,640 B to 664,608 B. The A/B build found
 * it. So the modules here are split by weight and the split is asserted:
 *
 *   - the **canvas** path (`scene.ts`, `provenance.ts`, `geometry.ts`) reaches no
 *     parameter schema, no engine and no React;
 *   - the **bill** path adds nothing — it takes not one specifier from `panel/`,
 *     because the one it wanted (`recipeId`, for an 8-character caption) sits
 *     beside `canonicalise` in a module carrying 25 KB of pinned parameter JSON.
 *     Importing it and building the wiring cost the entry chunk 20,168 B and
 *     emptied S4's lazy chunk of the schemas, so `scene.ts` restates the ten
 *     lines of FNV and `placement.test.ts` asserts the two agree;
 *   - the **download** path (`pack.ts`) reaches `engine/md5` and nothing else in
 *     `engine/`, because everything else there leads to the worker — and it
 *     reaches `notice.ts`, with its 11 KB of Apache-2.0 licence, only through a
 *     dynamic `import()`.
 *
 * ## What this proves, and what it cannot
 *
 * It proves the **static** graph. A dynamic `import()` is invisible to it by
 * design — that is the mechanism, not a hole. It cannot prove the bundle; only a
 * build can, and nothing outside this directory imports it yet, so today the
 * whole tree is emitted only when something reaches it. The measured A/B is in
 * the row's report.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { staticClosure as walk, staticImports } from '../../../tools/boundary/closure'

const HERE = resolve(process.cwd(), 'src', 'generator', 'placement')
const SRC_DIR = resolve(process.cwd(), 'src')

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
    files: closure.files.filter((file) => file !== entry),
    packages: [...closure.packages.keys()],
  }
}

const relativeToSrc = (file: string) => file.slice(SRC_DIR.length + 1)

function reachedBy(module: string): string[] {
  return closureOf(join(HERE, module)).files.map(relativeToSrc)
}

/** Modules whose weight is the reason for the split. */
const ENGINE = 'generator/engine/'
const SCHEMAS = 'generator/panel/schemas'
const PREVIEW = 'generator/panel/usePreview'
const RESOLVER = 'generator/panel/resolve'
const SWEEP = 'generator/panel/sweep'
const CANVAS_BARREL = 'builder/canvas/index.ts'
const DOWNLOAD_BARREL = 'download/index.ts'

describe('the canvas path', () => {
  it('reaches nothing but zod', () => {
    const scene = closureOf(join(HERE, 'scene.ts'))
    expect(scene.files).toEqual([])
    expect(scene.packages).toEqual(['zod'])
    // `provenance.ts` is the strings every describing site needs, and it has no
    // imports at all — which is why a bill row, a canvas label and a ZIP notice
    // can all reach the same wording for free.
    const provenance = closureOf(join(HERE, 'provenance.ts'))
    expect(provenance.files).toEqual([])
    expect(provenance.packages).toEqual([])
  })

  it('draws and collides without a parameter schema, an engine or React', () => {
    const reached = reachedBy('geometry.ts')
    for (const forbidden of [ENGINE, SCHEMAS, PREVIEW, RESOLVER, SWEEP]) {
      expect(reached.filter((file) => file.startsWith(forbidden)), forbidden).toEqual([])
    }
    // No React and no renderer. `zustand` is in the closure and is not this
    // row's: W6's `geometry.ts` value-imports `normalizeRotation` from `@/store`,
    // and the store is in the entry chunk on every page already.
    const packages = closureOf(join(HERE, 'geometry.ts')).packages
    expect(packages.filter((name) => name === 'react' || name.startsWith('three'))).toEqual([])
    expect(packages.sort()).toEqual(['zod', 'zustand', 'zustand/middleware'])
    // It does reach W6's geometry, which is the point — one collision algorithm,
    // not two.
    expect(reached).toContain('builder/canvas/geometry.ts')
    expect(reached).toContain('builder/canvas/overlap.ts')
  })

  it('reaches W6 and the download path by module, never through a barrel', () => {
    /*
     * **The cost of the canvas barrel was re-measured in row R4, and a third
     * assertion here was deleted because that row made it vacuous.**
     *
     * It read `expect(reached).not.toContain('builder/canvas/PlanCanvas.tsx')`,
     * and the comment justified it as *"`@/builder/canvas` pulls
     * `PlanCanvas.tsx`, 46 KB of component, into whatever imports it"*. R4
     * deleted that file. An assertion that a closure does not contain a path
     * that cannot exist can never fail, whatever anybody imports — it is the
     * fourth vacuous guard this series has found and the first one a *deletion*
     * created rather than a shortcut.
     *
     * The guard it stood beside is not vacuous and the barrel is not cheap.
     * Walked on R4's tree, `builder/canvas/index.ts` reaches **37 in-repo
     * modules and four packages** — the whole assembly index (`assembly/**`),
     * the material registry (`materials/**`), eight store modules, and
     * **`react`**, through `usePlanTools.ts`. That last one is the live version
     * of the old argument: this directory is asserted a few lines above to reach
     * no React at all, and one convenience import of the barrel would break that
     * without breaking anything else. `@/download` pulls the save picker, the
     * stream and the vendored ZIP writer. Both are reached by path instead, the
     * way `src/builder/three` reaches `@/three/gate`.
     */
    for (const module of ['scene.ts', 'provenance.ts', 'geometry.ts', 'bill.ts', 'pack.ts', 'placement.ts']) {
      const reached = reachedBy(module)
      expect(reached, `${module} → canvas barrel`).not.toContain(CANVAS_BARREL)
      expect(reached, `${module} → download barrel`).not.toContain(DOWNLOAD_BARREL)
    }
  })
})

describe('the bill path', () => {
  const reached = reachedBy('bill.ts')

  it('reaches no engine, schema, resolver, sweep or preview hook', () => {
    for (const forbidden of [ENGINE, SCHEMAS, PREVIEW, RESOLVER, SWEEP]) {
      expect(reached.filter((file) => file.startsWith(forbidden)), forbidden).toEqual([])
    }
    expect(closureOf(join(HERE, 'bill.ts')).packages.filter((name) => name === 'react')).toEqual([])
  })

  it('takes nothing at all from `panel/`, which is the measured reason', () => {
    // The first draft imported `recipeId` from `panel/recipe.ts` for the bill's
    // 8-character handle. Building it wired up took the entry chunk from
    // 644,915 B to 665,083 B and dropped `GeneratorDrawer`'s lazy chunk from
    // 45.68 kB to 29.07 kB, because `recipeId` sits beside `canonicalise` in a
    // module that value-imports 25 KB of pinned parameter JSON. So the handle is
    // `scene.ts`'s `recipeHandle`, and `placement.test.ts` asserts it equals
    // S4's byte for byte instead.
    const source = readFileSync(join(HERE, 'bill.ts'), 'utf8')
    expect(staticImports(source).filter((specifier) => specifier.startsWith('../panel'))).toEqual([])
    expect(reached).not.toContain('generator/panel/recipe.ts')
  })

  it('carries no licence text, because a bill row is not a distribution', () => {
    expect(staticImports(readFileSync(join(HERE, 'bill.ts'), 'utf8')).some((s) => s.includes('?raw'))).toBe(false)
    expect(reached).not.toContain('generator/placement/pack.ts')
  })
})

describe('the download path', () => {
  it('takes md5 from the engine directory and nothing else', () => {
    // `engine/md5.ts` has no imports at all. Any other value import from
    // `engine/` reaches `engine/index.ts`, whose dynamic imports are what emit
    // the 298 kB worker chunk.
    const source = readFileSync(join(HERE, 'pack.ts'), 'utf8')
    const fromEngine = staticImports(source).filter((specifier) => specifier.includes('engine'))
    expect(fromEngine).toEqual(['../engine/md5'])
    expect(closureOf(resolve(SRC_DIR, 'generator', 'engine', 'md5.ts')).files).toEqual([])
    expect(reachedBy('pack.ts').filter((file) => file.startsWith(ENGINE))).toEqual(['generator/engine/md5.ts'])
  })

  it('puts the Apache licence behind a dynamic import, and nothing static', () => {
    // The measured reason is in `notice.ts`: static, the same wiring cost the
    // entry chunk 15,574 B raw and 5,244 B gzipped, because `@/download` is
    // eagerly reachable and there is no boundary between it and the entry bundle
    // to hide behind. `engine/index.ts` makes the same trade for the GPL-2 text.
    const source = readFileSync(join(HERE, 'pack.ts'), 'utf8')
    expect(source).toContain("await import('./notice')")
    expect(staticImports(source)).not.toContain('./notice')
    for (const module of ['scene.ts', 'provenance.ts', 'geometry.ts', 'bill.ts', 'pack.ts', 'placement.ts', 'index.ts']) {
      expect(reachedBy(module), `${module} → notice`).not.toContain('generator/placement/notice.ts')
    }
    // And the licence really is in there, imported the way S3 imports its own.
    const notice = readFileSync(join(HERE, 'notice.ts'), 'utf8')
    expect(notice).toContain("from '../scad/LICENSE?raw'")
    expect(notice).toContain("from '../scad/NOTICE?raw'")
  })

  it('reaches the truncation check rather than reimplementing it', () => {
    // `detectStlFormat` returns `'binary'` only when the facet count predicts
    // the file length exactly, which is the check, and it is W1's.
    const source = readFileSync(join(HERE, 'pack.ts'), 'utf8')
    expect(staticImports(source)).toContain('@/three/stl/parse')
    expect(reachedBy('pack.ts')).not.toContain('three/index.ts')
  })
})

describe('the drawer path', () => {
  it('takes the resolver as types only, so no module in this row reaches it', () => {
    // `placement.ts` needs `ArchiveBase` and `Resolution` to describe what the
    // drawer hands it, and a type import is erased — so the sweep tables and the
    // resolver stay entirely on S4's side of the line even here, which is one
    // better than this row set out to achieve.
    const source = readFileSync(join(HERE, 'placement.ts'), 'utf8')
    expect(source).toContain("import type { ArchiveBase, Resolution } from '../panel/resolve'")
    for (const module of ['scene.ts', 'provenance.ts', 'geometry.ts', 'bill.ts', 'pack.ts', 'placement.ts']) {
      expect(reachedBy(module), module).not.toContain('generator/panel/resolve.ts')
      expect(reachedBy(module), module).not.toContain('generator/panel/sweep.ts')
    }
    // What it does reach for a value is `canonicalise`, `recipeKey` and
    // `isPanelEntry` — and through them the pinned schemas.
    expect(reachedBy('placement.ts')).toContain('generator/panel/schemas.ts')
  })

  it('finds a real graph, so a broken walker cannot pass vacuously', () => {
    // If `resolveModule` or `staticImports` were broken these closures would be
    // empty and every assertion above would pass.
    expect(reachedBy('pack.ts').length).toBeGreaterThan(5)
    expect(reachedBy('geometry.ts')).toContain('catalog/schema.ts')
    expect(closureOf(join(HERE, 'index.ts')).files.map(relativeToSrc)).toContain('generator/placement/pack.ts')
  })
})

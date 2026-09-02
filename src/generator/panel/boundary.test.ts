/// <reference types="node" />
/**
 * The lazy boundary, asserted by reading the source.
 *
 * `src/builder/three/boundary.test.ts` wrote this test for the 3D room and the
 * argument transfers exactly: the thing being protected is invisible when it
 * breaks. Behind `GeneratorDrawer` sit 25 KB of pinned parameter schemas, the
 * sweep tables, the resolver and — one boundary further on — a 10.5 MB
 * WebAssembly engine, 99 KB of Emscripten glue, 197 KB of `.scad` sources and an
 * 18 KB licence. A single convenience import on the wrong side of the line moves
 * some or all of that into the entry chunk, and nothing fails: the app works and
 * every visitor to `/builder` pays for a generator they did not open.
 *
 * **It has already happened once in this row.** `index.ts` re-exported the
 * resolver and `usePreview` for row S5's benefit; because `BuilderScreen`
 * imports the panel from `index.ts`, that pulled `engine/index.ts` into the
 * entry chunk and took it from 642,640 B to 664,608 B. The A/B build found it.
 * This test is what makes the next one fail in CI instead.
 *
 * ## What this proves, and what it cannot
 *
 * It proves the **static** graph from `index.ts`. A dynamic `import()` is
 * invisible to it by design — that is the mechanism, not a hole. It cannot prove
 * the bundle; only a build can, and that measurement is in
 * `GeneratorPanel.tsx`'s docblock as an A/B with both sides emitting a single
 * eager chunk.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { staticClosure as walk, staticImports } from '../../../tools/boundary/closure'

const HERE = resolve(process.cwd(), 'src', 'generator', 'panel')
const SRC_DIR = resolve(process.cwd(), 'src')

/**
 * Modules the eager surface must not reach, and why each one costs.
 *
 * `generator/engine/` is the 10.5 MB engine and its 298 kB worker chunk;
 * reaching `engine/index.ts` is enough, because its dynamic imports are what
 * emit them. The four panel modules are the drawer's own weight — the schemas
 * alone are 25 KB of JSON — and they are also what row S5 imports **by path**
 * rather than through this barrel.
 */
const FORBIDDEN_FILES = [
  'generator/engine/',
  'generator/panel/schemas',
  'generator/panel/resolve',
  'generator/panel/sweep',
  'generator/panel/recipe',
  'generator/panel/usePreview',
  'generator/panel/controls',
  'generator/panel/GeneratorDrawer',
  // Row X9. `placement/placement.ts` reaches `panel/recipe.ts` for `recipeKey`
  // and therefore the 25 KB of pinned schemas, and `placement/pack.ts` reaches
  // the md5 implementation and the STL parser. Both are named in this file's
  // `onPlace` seam and both are imported `type`-only there, which `staticImports`
  // is written to ignore — so this entry is what makes the day someone needs one
  // of them as a *value* fail here instead of in a bundle nobody measured.
  'generator/placement/placement',
  'generator/placement/pack',
]

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

describe('the eager surface of @/generator/panel', () => {
  const closure = closureOf(join(HERE, 'index.ts'))

  it('reaches nothing heavy', () => {
    const offenders = closure.files
      .map(relativeToSrc)
      .filter((file) => FORBIDDEN_FILES.some((prefix) => file.startsWith(prefix)))
    expect(offenders).toEqual([])
  })

  it('reaches no package but react', () => {
    // The panel's eager surface is React and a stylesheet. Anything else here
    // would be a dependency the entry chunk pays for on every page.
    expect(closure.packages.filter((specifier) => specifier !== 'react')).toEqual([])
  })

  it('imports the drawer only lazily', () => {
    const panel = readFileSync(join(HERE, 'GeneratorPanel.tsx'), 'utf8')
    expect(panel).toContain("lazy(() => import('./GeneratorDrawer'))")
    expect(staticImports(panel)).not.toContain('./GeneratorDrawer')
    expect(closure.files.map(relativeToSrc)).not.toContain('generator/panel/GeneratorDrawer.tsx')
  })

  it('finds a real graph, so a broken walker cannot pass vacuously', () => {
    // `index.ts` reaches exactly one module: the panel. If the walker were
    // broken this would be empty and every assertion above would pass.
    expect(closure.files.map(relativeToSrc)).toEqual(['generator/panel/GeneratorPanel.tsx'])
    expect(closure.packages).toContain('react')
  })

  it('puts every engine import behind a dynamic one, on the drawer’s side too', () => {
    // The second boundary. `usePreview` imports S3's seam, and that seam is
    // itself nothing but types and `import()` — which is what makes the engine
    // a third chunk rather than part of the drawer's.
    const seam = readFileSync(resolve(SRC_DIR, 'generator', 'engine', 'index.ts'), 'utf8')
    expect(staticImports(seam)).toEqual([])
    const hook = readFileSync(join(HERE, 'usePreview.ts'), 'utf8')
    expect(staticImports(hook)).toContain('../engine')
  })

  it('takes S3’s schema validator and nothing else from the engine directory', () => {
    // The drawer's side may reach `engine/schema.ts`, which has no imports at
    // all, so the pinned schemas are validated by one implementation rather than
    // two. Any other value import from `engine/` would drag the worker in.
    const schemas = readFileSync(join(HERE, 'schemas.ts'), 'utf8')
    const fromEngine = staticImports(schemas).filter((specifier) => specifier.includes('engine'))
    expect(fromEngine).toEqual(['../engine/schema'])
    const validator = readFileSync(resolve(SRC_DIR, 'generator', 'engine', 'schema.ts'), 'utf8')
    expect(staticImports(validator)).toEqual([])
  })
})

/// <reference types="node" />
/**
 * The two boundaries this directory sits on, asserted by walking the source.
 *
 * ## Why `@/mesh` must stay light
 *
 * The conversion is triggered from `src/App.tsx`, which is mounted for **every**
 * screen including the landing one. If `@/mesh` reached three.js, every visitor
 * to `/catalog` would download the 411 kB renderer chunk to look at thumbnails.
 * If it reached `meshoptimizer`, they would download 55 kB of wasm-bearing
 * simplifier to open a page with no 3D on it. The lazy boundary is what makes
 * that survivable, and it is the second block below that proves the boundary is
 * really there — but the barrel is imported eagerly by the 3D chunk and by
 * `builder/three/loadLod.ts`, so its own weight still matters.
 *
 * Neither is caught by the type checker and neither would break anything. Rows
 * S4, S5 and X9 each measured one innocent import doing real damage — X9 at
 * **+20,168 B raw**, and S5 watched one empty S4's lazy chunk entirely, 665,083
 * B — so the static graph is walked here and checked.
 *
 * The walker is `tools/boundary/closure.ts`, row X10's, **not a sixth copy of
 * it**. It is the one that can see a bare side-effect import and cannot resolve
 * a specifier to a directory, both of which were real gaps in the copies that
 * preceded it.
 *
 * ## What it proves, and what it cannot
 *
 * It proves the **static** graph. A dynamic `import()` is invisible to it by
 * design — that is the mechanism a lazy boundary *is* — and `new Worker(new
 * URL('./worker.ts', import.meta.url))` is invisible for the same reason: Vite
 * rewrites it into a chunk reference, which is exactly why `spawn.ts` is one
 * line and holds nothing else.
 *
 * It cannot prove the **bundle**. Only a build can, and this row's is reported
 * in the PR: the entry chunk was measured with and without the one `@/mesh`
 * import, back to back on one tree.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SRC_DIR, staticClosure, staticImports } from '../../tools/boundary/closure'

const HERE = join(SRC_DIR, 'mesh')

/** Packages that pull a renderer, a shader compiler or a mesh codec. */
const FORBIDDEN_PACKAGES = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'postprocessing',
  'n8ao',
  'meshoptimizer',
]

/**
 * In-repo modules the barrel must not reach.
 *
 * `download/index.ts` is the barrel that re-exports the vendored zip writer;
 * `queue.ts` imports `download/source.ts` by deep path precisely so the zip
 * writer stays out. `builder/three/` is the 3D stack, and the dependency runs
 * the other way — `loadLod.ts` imports `@/mesh`, never this.
 */
const FORBIDDEN_FILES = ['download/index', 'builder/three/', 'three/Stage', 'three/Viewer']

function relative(file: string): string {
  return file.slice(SRC_DIR.length + 1)
}

describe('the eager surface of @/mesh', () => {
  const closure = staticClosure(join(HERE, 'index.ts'))
  const files = closure.files.map(relative)
  const packages = [...closure.packages.keys()]

  it('reaches no renderer or codec package', () => {
    const offenders = packages.filter((specifier) =>
      FORBIDDEN_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`)),
    )
    expect(offenders).toEqual([])
  })

  it('reaches no module that owns one', () => {
    expect(files.filter((file) => FORBIDDEN_FILES.some((prefix) => file.startsWith(prefix)))).toEqual([])
  })

  it('does not reach convert.ts, which is where the simplifier lives', () => {
    // The barrel exports `ConvertedMesh` as a **type** and nothing else from
    // that module. This assertion failed on the first draft of `index.ts`,
    // which exported `convertStl` — which is what makes it a guard rather than
    // a decoration.
    expect(files).not.toContain('mesh/convert.ts')
    expect(files).not.toContain('mesh/worker.ts')
  })

  it('reaches src/three not at all, and reuses its parser behind the worker', () => {
    // `@/three/stl/parse` is the one module from the detail viewer's directory
    // this row reuses — reusing it is why there is still only one STL parser in
    // the tree — and it is reached from `convert.ts`, which is worker-side. So
    // the barrel reaches nothing under `src/three/` at all: `protocol.ts` takes
    // `StlFormat` as a type, which is erased.
    expect(files.filter((file) => file.startsWith('three/'))).toEqual([])
    expect(staticClosure(join(HERE, 'convert.ts')).files.map(relative)).toContain('three/stl/parse.ts')
  })

  it('finds a real graph, so a broken walker cannot pass vacuously', () => {
    expect(files).toContain('mesh/index.ts')
    expect(files).toContain('mesh/queue.ts')
    expect(files).toContain('mesh/tiers.ts')
    expect(files).toContain('mesh/weld.ts')
    expect(files).toContain('download/source.ts')
    expect(files.length).toBeGreaterThan(8)
    expect(packages).toContain('react')
    expect(packages).toContain('zod')
  })

  it('can see the simplifier when it is really there', () => {
    // The other side of the guard above: walk `convert.ts` itself and the
    // walker does report `meshoptimizer/simplifier`. So "the barrel reaches no
    // codec" is a fact about the barrel, not about the walker's blind spot.
    const convert = staticClosure(join(HERE, 'convert.ts'))
    expect([...convert.packages.keys()]).toContain('meshoptimizer/simplifier')
    expect(staticClosure(join(HERE, 'worker.ts')).files.map(relative)).toContain('mesh/convert.ts')
  })

  it('keeps the worker reachable only through the one-line spawn', () => {
    // `new Worker(new URL('./worker.ts', import.meta.url))` is a build
    // instruction, not an import, so the walker cannot see it — which is the
    // mechanism. What can be checked is that the file which holds it holds
    // nothing else.
    const spawn = staticClosure(join(HERE, 'spawn.ts'))
    expect(spawn.files.map(relative)).toEqual(['mesh/spawn.ts'])
    expect([...spawn.packages.keys()]).toEqual([])
  })
})

describe('the eager surface of @/builder/three, after this row', () => {
  const closure = staticClosure(join(SRC_DIR, 'builder', 'three', 'index.ts'))
  const files = closure.files.map(relative)

  it('still does not reach the loader, the store or the room', () => {
    // `loadLod.ts` and `useLodStore.ts` both import `@/mesh` now. They are
    // behind the lazy boundary, so that is free — and this is where "free"
    // stops being an assumption.
    expect(files).not.toContain('builder/three/loadLod.ts')
    expect(files).not.toContain('builder/three/useLodStore.ts')
    expect(files).not.toContain('builder/three/BuilderRoom.tsx')
    expect(files).not.toContain('mesh/index.ts')
  })

  it('still reaches no renderer package', () => {
    const offenders = [...closure.packages.keys()].filter((specifier) =>
      FORBIDDEN_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`)),
    )
    expect(offenders).toEqual([])
  })
})

/**
 * The wiring is the one thing that could have moved this whole directory into
 * the entry chunk.
 *
 * It lives in `src/App.tsx`, which is mounted for every screen including the
 * landing one, so a **static** import there would put `@/mesh`, `@/assembly` and
 * the aggregate builder in front of the first paint of a screen where the room
 * is empty and there is nothing to warm.
 *
 * The mechanism is a dynamic `import()`, which the walker cannot see — that is
 * what a lazy boundary *is*, the same reason `Builder3DPanel`'s `lazy` call is
 * asserted by reading the source next door. So both halves are checked: the
 * source really does defer it, and `App.tsx`'s static graph really does not
 * reach this directory.
 */
describe('the warming call site', () => {
  const app = join(SRC_DIR, 'App.tsx')
  const source = readFileSync(app, 'utf8')

  it('is a dynamic import, not a static one', () => {
    expect(source).toContain("import('./mesh/warm')")
    expect(staticImports(source)).not.toContain('./mesh/warm')
  })

  it('leaves @/mesh out of the app’s own static graph', () => {
    const files = staticClosure(app, SRC_DIR).files.map(relative)
    expect(files.filter((file) => file.startsWith('mesh/'))).toEqual([])
  })

  it('finds a real graph, so the assertion above is not vacuous', () => {
    // `App.tsx` does reach the router, so the walk happened.
    const files = staticClosure(app, SRC_DIR).files.map(relative)
    expect(files).toContain('routes/index.ts')
  })

  it('keeps the warmer and its context off the barrel, so nothing pulls them by accident', () => {
    // They are reached by deep path only — `App.tsx` for the subscription and
    // `BuilderRoom.tsx` for the catalog derivations — because the barrel is
    // imported by the lazy 3D chunk and a re-export here would be an easy
    // accident. `warm.ts` reaches `@/store`, which the barrel must not.
    const barrel = staticClosure(join(HERE, 'index.ts')).files.map(relative)
    expect(barrel).not.toContain('mesh/warm.ts')
    expect(barrel).not.toContain('mesh/context.ts')
  })
})

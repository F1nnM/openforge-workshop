/// <reference types="node" />
/**
 * The lazy boundary, asserted by reading the source.
 *
 * `src/three/boundary.test.ts` wrote this test for the detail viewer and the
 * argument is the same one here, one directory over: three.js, r3f, drei,
 * `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder are the project's
 * largest dependency by an order of magnitude, and §8's promise is that a
 * visitor who does not ask for a 3D view downloads none of it. That promise is
 * held up by exactly one thing — nothing reachable from `@/builder/three` by a
 * **static** import may touch a renderer — and nothing about it is enforced by
 * the type system.
 *
 * The failure mode is silent. The app keeps working; the entry chunk grows by
 * ~400 kB gzipped and every visitor to **every** screen pays for it, the catalog
 * included. So the static import graph is walked here from `index.ts` and
 * checked, and a convenience import added to the panel's side of the line fails
 * this test, which is the only place it would be noticed.
 *
 * ## Row R2 changed what the boundary is for, and it did not stop mattering
 *
 * The 3D surface is now open on arrival — the owner asked for the 3D view to
 * *be* the builder — so every `/builder` visitor does download the 3D chunk.
 * That does not make the line pointless, and `Builder3DPanel.tsx` sets out why:
 * a static import would put the same bytes in the **entry** chunk, which blocks
 * first paint on every screen, where behind `lazy` they are a parallel request
 * that resolves while the 5.6 MB catalog index this screen already waits on is
 * in flight. Same bytes, off the critical path — and off the catalog's path
 * entirely.
 *
 * ## The walker is `tools/boundary/closure.ts`, and this was the fifth copy
 *
 * Row X10 collapsed four near-identical static-import walkers into one module
 * and recorded what the four had each got differently — an `EISDIR` on a
 * directory shadowing a module, a bare `import './x'` that three of them could
 * not see at all, and a walker regex-scanning an Apache licence for imports.
 * **It missed this file**, which carried its own private copy, and row R1 left
 * that copy alone deliberately *"so R2's rebase of that directory stays clean"*
 * while calling it *"the copy that will diverge next"*. This row is that rebase,
 * so the copy is gone: `closure.ts` is imported, and its 13 tests cover the
 * walker itself.
 *
 * The two behavioural differences the shared walker brings here are both
 * improvements, and both are latent rather than active today: this directory has
 * no bare side-effect import other than a stylesheet, and no specifier that
 * resolves to a directory shadowing a module. Neither was true by design.
 *
 * ## What this proves, and what it cannot
 *
 * It proves the **static** graph. A dynamic `import()` is invisible to it by
 * design — that is the mechanism, not a hole — and so is a heavy transitive
 * import that arrives through a module the walker cannot follow. The walker
 * therefore follows relative and `@/`-aliased in-repo imports as far as it can
 * and reports package specifiers it cannot follow, so a heavy package pulled in
 * two files deep is still caught.
 *
 * It cannot prove the *bundle*. Only a build can, and that measurement is in
 * `index.ts`'s docblock as an A/B: build with this directory present, build with
 * it moved aside, compare the entry chunk.
 */
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SRC_DIR, staticClosure, staticImports } from '../../../tools/boundary/closure'

const HERE = resolve(process.cwd(), 'src', 'builder', 'three')

/** Packages that pull a renderer, a shader compiler or a mesh decoder. */
const FORBIDDEN_PACKAGES = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'postprocessing',
  'n8ao',
  'meshoptimizer',
]

/**
 * In-repo modules the entry surface must not reach.
 *
 * `download/` vendors the zip writer and has no business in the chunk every
 * visitor downloads.
 */
const FORBIDDEN_FILES = ['download/']

/** `src/three` modules the entry surface may reach. Only the one. */
const ALLOWED_THREE_MODULES = ['three/gate']

/**
 * This row's own modules that carry a renderer, by name.
 *
 * The package assertion above would catch any of them leaking, but it would say
 * `three ← builder/three/index.ts` and leave the reader to find which import did
 * it. Naming them makes the failure say so directly, and it is also the list a
 * future row adds to rather than discovering by accident.
 */
const RENDERER_MODULES = [
  'builder/three/BuilderRoom.tsx',
  'builder/three/InstancedTiles.tsx',
  'builder/three/RoomSurface.tsx',
  'builder/three/instances.ts',
  'builder/three/loadLod.ts',
  'builder/three/markers.ts',
  'builder/three/place.ts',
  'builder/three/surface.ts',
  'builder/three/useLodStore.ts',
]

/**
 * The walk, from `tools/boundary/closure.ts` — one copy for the boundary tests.
 *
 * The local adapter reports paths relative to `src` and drops the entry, which
 * is this test's own framing: it asks "what else does `index.ts` reach", not
 * "what is in this chunk". `closure.ts`'s docblock records that two of the four
 * original copies made that choice differently, which is why it leaves it to the
 * caller.
 */
function closureOf(entry: string): { files: string[]; packages: string[] } {
  const closure = staticClosure(entry, SRC_DIR)
  return {
    files: closure.files.filter((file) => file !== entry).map((file) => relative(SRC_DIR, file)),
    packages: [...closure.packages.keys()],
  }
}

describe('the eager surface of @/builder/three', () => {
  const closure = closureOf(join(HERE, 'index.ts'))

  it('reaches no renderer package', () => {
    const offenders = closure.packages.filter((specifier) =>
      FORBIDDEN_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`)),
    )
    expect(offenders).toEqual([])
  })

  it('reaches no module that owns one', () => {
    const offenders = closure.files.filter((file) => FORBIDDEN_FILES.some((prefix) => file.startsWith(prefix)))
    expect(offenders).toEqual([])
  })

  it('reaches none of this row’s own renderer modules', () => {
    // Named, so a leak says which import caused it. Every one of these
    // value-imports three, r3f or the glTF loader.
    expect(closure.files.filter((file) => RENDERER_MODULES.includes(file))).toEqual([])
  })

  it('reaches src/three only through gate.ts', () => {
    const reached = closure.files
      .filter((file) => file.startsWith('three/'))
      .map((file) => file.replace(/\.tsx?$/, ''))
    // `gate.ts` imports a type and nothing else, and this row derives its memory
    // budget from the number it owns rather than copying it — which is the seam
    // `tools/lod/catalog.ts` had to duplicate because a composite project would
    // not let it import this file.
    expect(reached).toEqual(ALLOWED_THREE_MODULES)
  })

  it('does not itself import the room, only lazily', () => {
    const panel = readFileSync(join(HERE, 'Builder3DPanel.tsx'), 'utf8')
    // The mechanism, in one assertion: a `lazy(() => import(...))` and no static
    // import of the same module.
    expect(panel).toContain("lazy(() => import('./BuilderRoom'))")
    expect(staticImports(panel)).not.toContain('./BuilderRoom')
    expect(closure.files).not.toContain('builder/three/BuilderRoom.tsx')
  })

  it('finds a real graph, so a broken walker cannot pass vacuously', () => {
    // The walker must actually have reached something: `lod.ts`, which reaches
    // `@/catalog` and `@/three/gate`.
    expect(closure.files).toContain('builder/three/lod.ts')
    expect(closure.files).toContain('three/gate.ts')
    expect(closure.files.length).toBeGreaterThan(2)
    expect(closure.packages).toContain('react')
  })

  it('puts every heavy import behind the room, where a build can see it', () => {
    // The other side of the line, checked so that "the panel is light" cannot be
    // true because the feature is empty: the room really does import three, r3f,
    // the glTF loader and the decoder, and the surface really does import three.
    const room = readFileSync(join(HERE, 'BuilderRoom.tsx'), 'utf8')
    const loader = readFileSync(join(HERE, 'loadLod.ts'), 'utf8')
    const surface = readFileSync(join(HERE, 'RoomSurface.tsx'), 'utf8')
    expect(room).toContain("from '@/three/Stage'")
    expect(loader).toContain("from 'three/examples/jsm/loaders/GLTFLoader.js'")
    expect(loader).toContain("from 'three/examples/jsm/libs/meshopt_decoder.module.js'")
    expect(surface).toContain("from '@react-three/fiber'")
    // And the interaction layer is reachable from the room, not from the panel —
    // which is what makes row R2's whole addition land behind the same line.
    expect(staticImports(room)).toContain('./RoomSurface')
  })
})

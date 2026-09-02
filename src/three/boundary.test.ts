/// <reference types="node" />
/**
 * The lazy boundary, asserted by reading the source.
 *
 * This is the largest dependency addition in the project — three.js, r3f, drei,
 * `postprocessing` and n8ao — and §8's promise is that a visitor who browses the
 * catalog and never opens a 3D view downloads none of it. That promise is held up
 * by exactly one thing: nothing reachable from `@/three` by a **static** import
 * may touch the renderer, so the whole stack sits behind
 * `lazy(() => import('./Viewer'))` and lands in its own chunk.
 *
 * Nothing about that is enforced by the type system, and the failure mode is
 * silent — the app keeps working, the entry chunk just grows by about a megabyte
 * and every catalog visitor pays for it. So the static import graph is walked
 * here from `index.ts` and checked. A convenience import added to the panel's
 * side of the line fails this test, which is the only place it would be noticed.
 */
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { staticClosure as walk, staticImports } from '../../tools/boundary/closure'

const THREE_DIR = resolve(process.cwd(), 'src', 'three')
const SRC_DIR = resolve(process.cwd(), 'src')

/** Packages that pull a renderer or a shader compiler. */
const FORBIDDEN_PACKAGES = [
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  'postprocessing',
  'n8ao',
]

/**
 * In-repo modules the entry surface must not reach.
 *
 * `@/download` resolves to a file rather than a package, so it is checked
 * against the file closure: it vendors the zip writer and has no business in the
 * chunk a catalog visitor downloads.
 */
const FORBIDDEN_FILES = ['download/', 'materials/']

/**
 * The walk, from `tools/boundary/closure.ts` — one copy for the four boundary tests.
 *
 * Row X10 collapsed the four near-identical walkers this file used to hold its
 * own version of; that module carries what they had each got differently. The
 * local adapter is here rather than there because this test is the one that
 * asks "what is in this chunk" and so keeps the entry in `files`, and reports
 * paths relative to `src`.
 */
function staticClosure(entry: string): { files: string[]; packages: ReadonlyMap<string, readonly string[]> } {
  const closure = walk(entry)
  return {
    files: closure.files.map((file) => relative(SRC_DIR, file)),
    packages: new Map([...closure.packages].map(([name, importers]) => [name, importers.map((f) => relative(SRC_DIR, f))])),
  }
}

describe('the entry surface', () => {
  const closure = staticClosure(join(THREE_DIR, 'index.ts'))

  it('reaches no renderer package by a static import', () => {
    const offenders = FORBIDDEN_PACKAGES.flatMap((name) =>
      (closure.packages.get(name) ?? []).map((file) => `${name} ← ${file}`),
    )
    expect(offenders).toEqual([])
  })

  it('reaches no heavy in-repo module either', () => {
    const offenders = closure.files.filter((file) =>
      FORBIDDEN_FILES.some((prefix) => file.startsWith(prefix)),
    )
    expect(offenders).toEqual([])
  })

  it('reaches only the panel, the gate and the schema’s types', () => {
    // A short, explicit list: if this grows, the entry chunk grew with it.
    expect(closure.files.sort()).toEqual(['three/Tile3DPanel.tsx', 'three/gate.ts', 'three/index.ts'])
  })

  it('imports nothing at runtime from @/catalog either', () => {
    // `CatalogRecord` is a Zod schema *and* a type; a value import would drag
    // Zod and the whole contract module into the panel's chunk.
    expect(closure.packages.has('@/catalog')).toBe(false)
  })
})

describe('Tile3DPanel', () => {
  const source = readFileSync(join(THREE_DIR, 'Tile3DPanel.tsx'), 'utf8')

  it('reaches the viewer through a dynamic import and nothing else', () => {
    expect(source).toMatch(/lazy\(\(\) => import\('\.\/Viewer'\)\)/)
    expect(staticImports(source)).not.toContain('./Viewer')
  })

  it('does not import the Stage, the loader or the material registry', () => {
    for (const specifier of ['./Stage', './useStlModel', './geometry', './material', '@/materials']) {
      expect(staticImports(source)).not.toContain(specifier)
    }
  })
})

describe('the viewer chunk', () => {
  it('is where the renderer actually lives, so the boundary is worth something', () => {
    // The mirror image of the assertions above: if `Viewer.tsx` stopped importing
    // the renderer, the boundary would be trivially satisfied and meaningless.
    const closure = staticClosure(join(THREE_DIR, 'Viewer.tsx'))
    const packages = [...closure.packages.keys()]

    expect(packages).toContain('three')
    expect(packages).toContain('@react-three/fiber')
    expect(packages).toContain('postprocessing')
    // `@/download` resolves to a file, so it shows up in the file closure — and
    // it is there because the viewer fetches through PR 11's `BlobSource`
    // rather than building a second URL.
    expect(closure.files).toContain('download/index.ts')
  })
})

/**
 * Row **G3**'s own boundary, which runs the opposite way to the viewer's.
 *
 * The shared canvas is two halves. The **host** (`SharedStage.tsx`) is a
 * renderer and belongs behind a `lazy` import like `Viewer.tsx`. The **slot**
 * (`SharedPreview.tsx`) is a 2D canvas and a registration, and it is meant to be
 * mountable from a catalog card — which is in the entry chunk. So the assertion
 * is not "the barrel does not reach it" but "the slot does not reach a
 * renderer": one convenience import of `Stage.tsx` from that file would put
 * three, r3f, drei, `postprocessing` and n8ao in the bundle every visitor
 * downloads, with the app working perfectly throughout.
 */
describe('the shared canvas', () => {
  const slot = staticClosure(join(THREE_DIR, 'SharedPreview.tsx'))

  it('has a slot side that reaches no renderer package', () => {
    const offenders = FORBIDDEN_PACKAGES.flatMap((name) =>
      (slot.packages.get(name) ?? []).map((file) => `${name} ← ${file}`),
    )
    expect(offenders).toEqual([])
  })

  it('has a slot side that reaches only the pool, the frame and React', () => {
    // Short and explicit, like the entry surface's list above: if this grows,
    // something crossed the line.
    expect(slot.files.sort()).toEqual([
      'three/SharedPreview.tsx',
      'three/frame.ts',
      'three/subjects.ts',
    ])
    expect([...slot.packages.keys()].sort()).toEqual(['react'])
  })

  it('has a frame module every side can read without a renderer', () => {
    // `frame.ts` exists precisely so the numbers `Stage.tsx` was tuned with are
    // reachable from the eager side. If it ever imports three, both halves of
    // that arrangement collapse.
    const frame = staticClosure(join(THREE_DIR, 'frame.ts'))
    expect(frame.files).toEqual(['three/frame.ts'])
    expect([...frame.packages.keys()]).toEqual([])
  })

  it('keeps the renderer on the host’s side of the line', () => {
    // The mirror image: if `SharedStage.tsx` stopped importing the renderer, the
    // boundary above would be trivially satisfied and meaningless.
    const host = staticClosure(join(THREE_DIR, 'SharedStage.tsx'))
    const packages = [...host.packages.keys()]

    expect(packages).toContain('three')
    expect(packages).toContain('@react-three/fiber')
    expect(packages).toContain('postprocessing')
    expect(packages).toContain('n8ao')
    expect(host.files).toContain('three/Stage.tsx')
  })

  it('is reached by deep import, never through the barrel', () => {
    // The barrel closure above is pinned to three files, so this is a statement
    // about intent as much as a check: a consumer mounts the host through
    // `lazy(() => import('@/three/SharedStage'))`, exactly as the drawer reaches
    // `Viewer`.
    const barrel = readFileSync(join(THREE_DIR, 'index.ts'), 'utf8')
    for (const specifier of ['./SharedStage', './SharedPreview', './subjects']) {
      expect(staticImports(barrel)).not.toContain(specifier)
    }
  })
})

describe('the parse worker', () => {
  it('imports nothing but the parser and the protocol', () => {
    const closure = staticClosure(join(THREE_DIR, 'stl', 'worker.ts'))

    expect([...closure.packages.keys()]).toEqual([])
    expect(closure.files.sort()).toEqual([
      'three/stl/parse.ts',
      'three/stl/protocol.ts',
      'three/stl/worker.ts',
    ])
  })
})

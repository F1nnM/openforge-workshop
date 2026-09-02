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
 * ~480 kB gzipped and every visitor to `/builder` pays for it whether or not
 * they press the button. So the static import graph is walked here from
 * `index.ts` and checked, and a convenience import added to the panel's side of
 * the line fails this test, which is the only place it would be noticed.
 *
 * ## What this proves, and what it cannot
 *
 * It proves the **static** graph. A dynamic `import()` is invisible to it by
 * design — that is the mechanism, not a hole — and so is a heavy transitive
 * import that arrives through a module this walker considers light. The walker
 * therefore follows relative and `@/`-aliased in-repo imports as far as it can
 * and reports package specifiers it cannot follow, so a heavy package pulled in
 * two files deep is still caught.
 *
 * It cannot prove the *bundle*. Only a build can, and that measurement is in
 * `index.ts`'s docblock as an A/B: build with this directory present, build with
 * it moved aside, compare the entry chunk.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HERE = resolve(process.cwd(), 'src', 'builder', 'three')
const SRC_DIR = resolve(process.cwd(), 'src')

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
 * `three/` is `src/three/**` — every module in it except `gate.ts` imports the
 * renderer, and `gate.ts` is the one this row does import, deliberately and by
 * deep path, because the memory budget is derived from it. `download/` vendors
 * the zip writer and has no business in the chunk a builder visitor downloads.
 */
const FORBIDDEN_FILES = ['download/']

/** `src/three` modules the entry surface may reach. Only the one. */
const ALLOWED_THREE_MODULES = ['three/gate']

/** Static `import`/`export … from` specifiers, excluding type-only ones. */
function staticImports(source: string): string[] {
  const found: string[] = []
  const pattern = /^\s*(?:import|export)\s+(?!type\s)([^;]*?)\s*from\s*'([^']+)'/gm

  for (const match of source.matchAll(pattern)) {
    const clause = match[1] ?? ''
    const specifier = match[2] ?? ''
    // `import { type A, type B }` is erased too; only a value import counts.
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

function resolveModule(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC_DIR, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (base === null) return null

  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) {
      try {
        if (readFileSync(candidate, 'utf8').length >= 0) return candidate
      } catch {
        continue
      }
    }
  }
  return null
}

interface Closure {
  /** Every in-repo file reachable by static import from the entry. */
  files: string[]
  /** Every package specifier reached, deduped. */
  packages: string[]
}

/** Walk the static graph from one entry, following in-repo modules only. */
function closureOf(entry: string): Closure {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || files.has(file)) continue
    files.add(file)

    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      // A stylesheet import has no graph of its own.
      if (specifier.endsWith('.css')) continue
      const resolved = resolveModule(file, specifier)
      if (resolved === null) packages.add(specifier)
      else queue.push(resolved)
    }
  }

  files.delete(entry)
  return { files: [...files], packages: [...packages] }
}

function relativeToSrc(file: string): string {
  return file.slice(SRC_DIR.length + 1)
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
    const offenders = closure.files
      .map(relativeToSrc)
      .filter((file) => FORBIDDEN_FILES.some((prefix) => file.startsWith(prefix)))
    expect(offenders).toEqual([])
  })

  it('reaches src/three only through gate.ts', () => {
    const reached = closure.files
      .map(relativeToSrc)
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
    expect(closure.files.map(relativeToSrc)).not.toContain('builder/three/BuilderRoom.tsx')
  })

  it('finds a real graph, so a broken walker cannot pass vacuously', () => {
    // The walker must actually have reached something: `lod.ts`, which reaches
    // `@/catalog` and `@/three/gate`.
    expect(closure.files.map(relativeToSrc)).toContain('builder/three/lod.ts')
    expect(closure.files.length).toBeGreaterThan(2)
    expect(closure.packages).toContain('react')
  })

  it('puts every heavy import behind the room, where a build can see it', () => {
    // The other side of the line, checked so that "the panel is light" cannot be
    // true because the feature is empty: the room really does import three, r3f,
    // the glTF loader and the decoder.
    const room = readFileSync(join(HERE, 'BuilderRoom.tsx'), 'utf8')
    const loader = readFileSync(join(HERE, 'loadLod.ts'), 'utf8')
    expect(room).toContain("from '@/three/Stage'")
    expect(loader).toContain("from 'three/examples/jsm/loaders/GLTFLoader.js'")
    expect(loader).toContain("from 'three/examples/jsm/libs/meshopt_decoder.module.js'")
  })
})

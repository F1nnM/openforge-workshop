/// <reference types="node" />
/**
 * The guard on the guard.
 *
 * Four boundary tests in this tree rest on one walker, and a walker that
 * silently under-reports turns every one of them into a test that cannot fail.
 * Three of the four copies row X10 collapsed had exactly that shape of defect,
 * so each is exercised here against a fixture on disk rather than against the
 * repo — a repo-shaped assertion would go quiet the day the tree stops happening
 * to contain the case.
 *
 * The fixture is written to the OS temp directory, not into the project: it must
 * be outside every closure a real boundary test walks, so that a stray `import`
 * in a fixture cannot perturb a real measurement, and it must not be inside
 * `node_modules` either — that is a symlink shared between this series' git
 * worktrees, so two rows running their suites at once would fight over the path.
 * The pid keeps it unique even within one machine.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { resolveModule, staticClosure, staticImports } from './closure'

const ROOT = join(tmpdir(), `openforge-boundary-fixture-${String(process.pid)}`)

/** `srcDir` for the fixture, so `@/…` resolves inside it. */
const SRC = join(ROOT, 'src')

function write(relativePath: string, source: string): string {
  const path = join(SRC, relativePath)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
  return path
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true })

  // The `EISDIR` case, exactly as it stands in the real tree: a directory and a
  // module of the same name, side by side, reached by one extensionless
  // specifier.
  write('schemas/pinned.ts', 'export const pinned = 1\n')
  write('schemas.ts', "export const schemas = 'the module, not the directory'\n")

  // A directory whose entry point is `index.tsx`, which one copy could not
  // resolve at all.
  write('widget/index.tsx', 'export const widget = 1\n')

  // A non-module beside a module, reachable only if the bare path is a
  // candidate. `LICENSE?raw` is the real instance.
  write('LICENSE', 'Apache License 2.0\nimport { smuggled } from "./schemas"\n')

  write('sideEffect.ts', 'export const registered = true\n')

  write(
    'entry.ts',
    [
      "import { schemas } from './schemas'",
      "import { widget } from './widget'",
      "import type { Erased } from './erased'",
      "import { type AlsoErased } from './alsoErased'",
      "import notice from './LICENSE?raw'",
      "import './entry.css'",
      "import './sideEffect'",
      "import { useState } from 'react'",
      'export const all = [schemas, widget, notice, useState]',
      'export type { Erased, AlsoErased }',
      '',
    ].join('\n'),
  )
  write('erased.ts', 'export type Erased = 1\n')
  write('alsoErased.ts', 'export type AlsoErased = 1\n')
})

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

describe('resolveModule', () => {
  it('takes the module beside a directory of the same name, not the directory', () => {
    // The `EISDIR` bug, in one assertion. A resolver that offered the bare path
    // as a candidate returned the directory here, and the walker's next
    // `readFileSync` threw — which reads as a broken test rather than as a
    // boundary breach.
    const resolved = resolveModule(join(SRC, 'entry.ts'), './schemas', SRC)
    expect(resolved).toBe(join(SRC, 'schemas.ts'))
  })

  it('resolves a directory through an index.tsx as well as an index.ts', () => {
    expect(resolveModule(join(SRC, 'entry.ts'), './widget', SRC)).toBe(join(SRC, 'widget', 'index.tsx'))
  })

  it('refuses a file that is not a module, however reachable it is', () => {
    // `../scad/LICENSE?raw` resolved to the licence text in one copy, and the
    // walker then scanned 11 KB of Apache-2.0 for import statements.
    expect(resolveModule(join(SRC, 'entry.ts'), './LICENSE?raw', SRC)).toBeNull()
    expect(resolveModule(join(SRC, 'entry.ts'), './entry.css', SRC)).toBeNull()
  })

  it('refuses a bare package name and a path that resolves to nothing', () => {
    expect(resolveModule(join(SRC, 'entry.ts'), 'react', SRC)).toBeNull()
    expect(resolveModule(join(SRC, 'entry.ts'), './absent', SRC)).toBeNull()
  })

  it('resolves an `@/` specifier against the src directory it is given', () => {
    expect(resolveModule(join(SRC, 'deep', 'nested.ts'), '@/schemas', SRC)).toBe(join(SRC, 'schemas.ts'))
  })
})

describe('staticImports', () => {
  it('collects a bare side-effect import, which three of the four copies could not see', () => {
    // `import './sideEffect'` is a value edge with no clause and no `from`. A
    // walker blind to it reports the module neither as reached nor as a package:
    // it is simply outside the closure the boundary test asserts.
    expect(staticImports("import './sideEffect'\n")).toEqual(['./sideEffect'])
  })

  it('erases a type-only import, in both spellings', () => {
    expect(staticImports("import type { A } from './a'\n")).toEqual([])
    expect(staticImports("import { type A, type B } from './a'\n")).toEqual([])
    // Mixed is a value import, because the value half is emitted.
    expect(staticImports("import { type A, b } from './a'\n")).toEqual(['./a'])
  })

  it('collects a re-export, which is an edge like any other', () => {
    expect(staticImports("export { a } from './a'\n")).toEqual(['./a'])
    expect(staticImports("export type { A } from './a'\n")).toEqual([])
  })
})

describe('staticClosure', () => {
  it('walks the fixture: every value edge followed, every erased one absent', () => {
    const closure = staticClosure(join(SRC, 'entry.ts'), SRC)
    const files = closure.files.map((file) => file.slice(SRC.length + 1)).sort()

    expect(files).toEqual(['entry.ts', 'schemas.ts', 'sideEffect.ts', 'widget/index.tsx'])
    // The two erased modules exist on disk and are named in the entry. Following
    // one would be reporting a dependency the compiler deletes.
    expect(files).not.toContain('erased.ts')
    expect(files).not.toContain('alsoErased.ts')
    // The directory next to `schemas.ts` is not walked, and neither is the
    // licence — whose own line would have smuggled `schemas` in a second time.
    expect(files).not.toContain('schemas/pinned.ts')
    expect(files).not.toContain('LICENSE')
  })

  it('reports an unresolved specifier with the file that imports it', () => {
    const closure = staticClosure(join(SRC, 'entry.ts'), SRC)
    expect([...closure.packages.keys()]).toEqual(['react'])
    expect(closure.packages.get('react')).toEqual([join(SRC, 'entry.ts')])
  })

  it('reports no asset as a package, in either the suffix or the query form', () => {
    const closure = staticClosure(join(SRC, 'entry.ts'), SRC)
    // `./entry.css` and `./LICENSE?raw` are both named by the entry and neither
    // is a dependency in the sense this walk measures. One copy listed the
    // stylesheet among the npm packages.
    expect([...closure.packages.keys()]).not.toContain('./entry.css')
    expect([...closure.packages.keys()]).not.toContain('./LICENSE?raw')
  })

  it('keeps the entry in `files`, because two of the four callers need it there', () => {
    const closure = staticClosure(join(SRC, 'schemas.ts'), SRC)
    expect(closure.files).toEqual([join(SRC, 'schemas.ts')])
  })

  it('terminates on a cycle', () => {
    // Not hypothetical: a barrel that re-exports a module which imports the
    // barrel is a shape this codebase has, and a walker without the `seen` set
    // would spin rather than fail.
    write('cycleA.ts', "import { b } from './cycleB'\nexport const a = b\n")
    write('cycleB.ts', "import { a } from './cycleA'\nexport const b = a\n")
    const closure = staticClosure(join(SRC, 'cycleA.ts'), SRC)
    expect(closure.files.map((file) => file.slice(SRC.length + 1)).sort()).toEqual(['cycleA.ts', 'cycleB.ts'])
  })
})

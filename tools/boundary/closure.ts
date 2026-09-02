/// <reference types="node" />
/**
 * One static-import graph walker, for the boundary tests that were four copies
 * of it.
 *
 * Four modules in this tree guard their own dependency closure —
 * `src/three/boundary.test.ts`, `src/generator/panel/boundary.test.ts`,
 * `src/generator/placement/boundary.test.ts` and
 * `src/builder/panels/boundary.test.ts` — because a lazy boundary is invisible
 * to the type checker and a `boundary.test.ts` is what makes a stray value
 * import fail a run instead of quietly adding 20 KB to the chunk every visitor
 * downloads. Each row that needed one wrote its own walker. Row X10 collapsed
 * them, and the reason is that **the four copies had already diverged into four
 * different answers to the same question**:
 *
 *   - **The `EISDIR` bug.** `src/generator/panel/boundary.test.ts` resolved a
 *     specifier with `existsSync(candidate) && !candidate.endsWith('/')`, taking
 *     the bare path as its first candidate — so `./schemas`, which names both a
 *     directory of pinned parameter exports and `schemas.ts` beside it, resolved
 *     to the **directory**, and the next `readFileSync` threw `EISDIR`. Row X9
 *     reported this against three files. Checked one by one, it was true of
 *     **one**: `src/generator/placement/boundary.test.ts` had already been fixed
 *     in row S5's own PR (#82, `statSync(…)?.isFile()`, with the reason in a
 *     comment), and `src/three/boundary.test.ts` was never exposed at all — it
 *     is the one copy that never offered the bare path as a candidate, so it
 *     cannot resolve to a directory. Its actual gap was different and quieter:
 *     it could not resolve a directory whose entry point is `index.tsx`.
 *   - **The bare side-effect import.** Only `src/three/boundary.test.ts`
 *     collected `import './x'` — the form with no clause and no `from`. The
 *     other three saw nothing, so a value dependency introduced as
 *     `import './register'` was invisible to the guard: not reported as a
 *     package, not followed, silently outside the closure the test asserts. No
 *     module in the tree does that today (checked: every bare import in `src/`
 *     is a `.css` one), which is precisely why it would have gone unnoticed.
 *     {@link staticImports} takes the superset, and `closure.test.ts` exercises
 *     the case against a fixture rather than leaving it to be true by luck.
 *   - **Reading a non-module as text.** With the bare path as a candidate, an
 *     asset import resolves to the asset: `../scad/LICENSE?raw` reached
 *     `src/generator/scad/LICENSE` and the walker regex-scanned the Apache
 *     licence looking for imports. Harmless, and only by accident.
 *
 * An `EISDIR` out of a boundary test is the worse of the two failures it can
 * have: it reads as a broken test rather than as a boundary breach, so the
 * likely response is to skip it.
 *
 * ## Why it lives here, which took three attempts
 *
 * Row X9 weighed this extraction and declined it, on the grounds that "a test
 * file cannot import another test file's helper without becoming part of that
 * suite, and moving it to `tools/` would make a test utility a shipped module".
 * The first half is right and is why this is not a `*.test.ts`: importing one
 * test file's exports registers its `describe`s in the importing suite. **The
 * second half is wrong** — nothing under `src/` imports this outside a test, so
 * it is in no bundle; `tools/` is not shipped. What X9 did not name is the
 * obstacle that actually bites, and all three were tested rather than argued:
 *
 *   - **Under `src/` it is forbidden.** `src/screens/assemblies/corpus.test.ts`
 *     asserts that `fixtures.ts` is the *only* non-test file under `src/`
 *     importing a `node:` module. Putting the walker there failed that test,
 *     which is the rule working.
 *   - **In a `*.test.ts` it is unusable**, per X9.
 *   - **In `tools/`, unlisted, it fails the typecheck.** All four importing
 *     tests raised TS6307 — a composite project rejects an import of a file
 *     outside its own file list — the same wall rows C1, W7 and X4 each hit from
 *     the other direction. `tsconfig.app.json` now lists `tools/boundary`, and
 *     that entry carries this reasoning too.
 */
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** `src`, resolved the way all four call sites resolved it. */
export const SRC_DIR = resolve(process.cwd(), 'src')

/**
 * Specifier suffixes that are **not** a module edge in either direction.
 *
 * Vite turns each of these into a URL, a string or a binary rather than into a
 * graph edge, so following one would mean scanning a stylesheet or a 10 MB
 * `.wasm` for import statements, and reporting one as a *package* would put
 * `./panel.css` in a list of npm dependencies. Both were happening, in different
 * copies. So they are dropped: not followed, not reported.
 *
 * A specifier carrying a `?` transform (`./openscad.wasm?url`,
 * `../scad/LICENSE?raw`) is dropped for the same reason and by the same rule,
 * which is why the query is tested before it is stripped.
 */
const ASSET_SUFFIXES = ['.css', '.json', '.wasm', '.scad', '.svg', '.png', '.webp', '.glb', '.md', '.txt']

function isAsset(specifier: string): boolean {
  if (specifier.includes('?')) return true
  return ASSET_SUFFIXES.some((suffix) => specifier.endsWith(suffix))
}

/**
 * Static `import`/`export … from` specifiers that survive type erasure.
 *
 * A **value** import only: `import type X from` and `import { type A, type B }`
 * are erased by the compiler and cost nothing at runtime, so a boundary test
 * that counted them would refuse a type that is free. A mixed clause
 * (`import { type A, b }`) does count, because `b` is emitted.
 *
 * Line-anchored, which is the deliberate limit and worth stating: an import
 * written inside a docblock at column zero would be collected, and a dynamic
 * `import()` is invisible by design — that is the thing a lazy boundary *is*,
 * and `src/builder/panels/boundary.test.ts` says so where it matters.
 */
export function staticImports(source: string): string[] {
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

  // Bare side-effect imports: `import './three.css'`, and also `import './x'`,
  // which is a real value edge three of the four copies could not see.
  for (const match of source.matchAll(/^\s*import\s+'([^']+)'/gm)) {
    found.push(match[1] ?? '')
  }

  return found
}

/**
 * The in-repo file a specifier names, or `null` for anything else.
 *
 * `null` covers three different things on purpose — a bare package name, an
 * asset, and a relative path that resolves to nothing — because the walker's
 * only question is "is there another file to read". {@link staticClosure}
 * separates the package case from the asset case, which is where the difference
 * matters.
 *
 * **Every candidate carries a `.ts` or `.tsx` extension**, and that is the whole
 * of the `EISDIR` fix. The bare path is not a candidate, so a directory can only
 * ever be reached through its `index`, and a `LICENSE` or a `.wasm` beside a
 * module cannot be mistaken for one. `isFile()` rather than `existsSync` on top
 * of that, so a directory literally named `foo.ts` could not slip through
 * either.
 */
export function resolveModule(from: string, specifier: string, srcDir: string = SRC_DIR): string | null {
  if (isAsset(specifier)) return null

  const base = specifier.startsWith('@/')
    ? join(srcDir, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null
  if (base === null) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile() === true) return candidate
  }
  return null
}

/** What a walk found. */
export interface StaticClosure {
  /**
   * Every in-repo file statically reachable from the entry, **including the
   * entry itself**, absolute.
   *
   * The entry is kept because dropping it is a caller's choice and two of the
   * four made it differently: three of the tests ask "what else does this
   * reach", one asks "what is in this chunk". A walker that decided for them
   * would make one of the two a subtraction at every call site.
   */
  readonly files: readonly string[]
  /**
   * Unresolved specifiers, each mapped to the absolute files that import it.
   *
   * A `Map` rather than a set of names because `src/three/boundary.test.ts`
   * reports the *importer* — `three ← three/Viewer.tsx` — and a name-only
   * result made that impossible to reconstruct. Callers wanting the names alone
   * take `[...packages.keys()]`.
   */
  readonly packages: ReadonlyMap<string, readonly string[]>
}

/**
 * Walk the static graph from one entry, following in-repo modules only.
 *
 * Depth-first over a stack, and the order is not part of the contract: every
 * caller sorts or compares as a set. Linear in the closure, and each file is
 * read once.
 */
export function staticClosure(entry: string, srcDir: string = SRC_DIR): StaticClosure {
  const files = new Set<string>()
  const packages = new Map<string, string[]>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()
    if (file === undefined || files.has(file)) continue
    files.add(file)

    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      if (isAsset(specifier)) continue
      const resolved = resolveModule(file, specifier, srcDir)
      if (resolved === null) {
        packages.set(specifier, [...(packages.get(specifier) ?? []), file])
        continue
      }
      queue.push(resolved)
    }
  }

  return { files: [...files], packages }
}

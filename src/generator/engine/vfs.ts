/**
 * The virtual filesystem: 35 strings, flat, in one map.
 *
 * S1 measured the three properties that let this be a map rather than a
 * resolver, and each one is asserted in `engine.test.ts` rather than trusted:
 *
 * - **All 39 `include` statements are bare filenames.** No `/`, no `..`, 19
 *   distinct targets, zero dangling. So `include <impl_square.scad>` resolves
 *   against a flat 35-entry map with no directory concept at all.
 * - **There is no `use <>` anywhere.** Upstream is `include`-only, which means
 *   **scope is shared**: every included file's variables and modules land in the
 *   includer's scope. That is the mechanism by which an entry point sets
 *   `SQUARE_BASIS` and `connectors.scad`, four hops down, sees it. Materialising
 *   the files as siblings in one directory preserves it; anything that isolated
 *   them — a per-file module, a namespace, a subdirectory — would break the
 *   geometry silently, because the variable would simply read `undef`.
 * - **There is not one `import()` in the set.** The single upstream occurrence
 *   was in `bases-wall-primary.scad`, which S1 deliberately did not vendor
 *   because nine of its ten textures need 82.9 MiB of blank STLs. So the VFS is
 *   35 strings and **no meshes to side-load**.
 *
 * ## CRLF is normalised here, and that is a measured decision
 *
 * Twelve of the 35 files are CRLF upstream. `scad/.gitattributes` pins `*
 * -text` so nothing rewrites them on checkout, and S1's PROVENANCE says
 * explicitly: *"A consumer that wants uniform text must normalise **after**
 * reading, never in the file."* This is that consumer, and it does.
 *
 * The reason is not tidiness. **OpenSCAD's own customizer extractor mis-reads
 * CRLF sources**, measured on this engine release against the two CRLF entry
 * points:
 *
 * | | `--export-format=param`, verbatim | normalised |
 * | --- | --- | --- |
 * | `risers_square.scad` | **4** parameters, 3 captions carrying a trailing `\r`, **0 enums** | **6** parameters, 0 stray `\r`, **6 enums** |
 * | `risers_curved.scad` | 6 parameters, **0 enums** | 6 parameters, **6 enums** |
 * | `bases-square.scad` (LF) | 15 parameters, 12 enums | identical |
 *
 * Verbatim, `risers_square.scad` loses eleven of its fifteen declarations and
 * every dropdown, and the captions it does report are attached to the wrong
 * variables. That is not a cosmetic defect: it is the parameter UI, wrong, with
 * no error anywhere.
 *
 * And the normalisation is provably free on the geometry. Rendering
 * `risers_square.scad`, `risers_curved.scad` and `bases-square.scad` from both a
 * verbatim and a normalised VFS produced **byte-identical STLs** — 469,984,
 * 242,784 and 157,084 bytes respectively, `Buffer.compare` zero in all three.
 * OpenSCAD's grammar accepts both line endings; only its comment-annotation
 * scanner does not.
 *
 * The files on disk are untouched, so `scad.test.ts`'s hashes and its
 * "12 files should be CRLF" assertion both still hold. The transformation lives
 * exactly one layer above them.
 */

/**
 * Every vendored source, keyed by the path Vite's glob produced.
 *
 * `eager: true` puts the 197 KB of text into whichever chunk imports this
 * module — which is the worker chunk, never the entry. Lazily globbing 35 files
 * would mean 35 dynamic imports to await before the first render, for no
 * benefit: nothing renders without all of them, because the include graph is
 * connected.
 */
const GLOBBED: Record<string, string> = import.meta.glob('../scad/*.scad', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** How many `.scad` files S1 vendored. A drift here is a refresh nobody noticed. */
export const VENDORED_SOURCE_COUNT = 35

/**
 * The archival monolith. In the VFS because nothing includes it and it therefore
 * costs nothing to carry, but **not** an entry point.
 *
 * S1: *"it is not a sixteenth peer entry point. Exposing it alongside
 * `bases-square.scad` would offer two generators for the same tile with
 * different parameter names and different output."* It predates the
 * `bases-*`/`impl_*` split, uses lowercase parameter names, and carries its own
 * copies of `connector_positive` and friends — so it cannot even be compiled
 * together with `connectors.scad`. It survives only because it is the sole
 * source for `alcove`, `curvedsquare` and the `external_*` edge extensions.
 */
export const ARCHIVAL_ENTRY = 'bases.scad'

/**
 * `filename -> source`, line endings normalised, nothing else changed.
 *
 * A `Map` rather than a record so `size` is the file count and a lookup of a
 * name that is not there is `undefined` rather than a prototype property.
 */
export const SCAD_SOURCES: ReadonlyMap<string, string> = buildSources()

/**
 * The entry points, derived from the include graph rather than listed.
 *
 * A file nothing includes is an entry point. Hard-coding the 15 names would go
 * stale the first time upstream adds a shape, and it would go stale *silently* —
 * the new file would ship in the VFS, resolve every include, and simply never
 * appear in the picker. `ARCHIVAL_ENTRY` is the one exclusion, and it is
 * excluded by name because no property of the graph distinguishes it.
 */
export const ENTRY_POINTS: readonly string[] = deriveEntryPoints()

/** One `include`/`use` statement, as found. */
export interface IncludeStatement {
  /** The file the statement appears in. */
  readonly source: string
  /** `include` or `use`. S1 verified upstream has no `use`; this reports it anyway. */
  readonly keyword: 'include' | 'use'
  /** The text between the angle brackets, verbatim. */
  readonly target: string
}

/**
 * Every `include`/`use` in the set, in file then line order.
 *
 * The regex is anchored at line start with only whitespace allowed before the
 * keyword, which is what keeps `impl_diagonal.scad`'s commented-out
 * `// include <connectors.scad>` out of the count — S1 found that one and the
 * total is 39 rather than 40 because of it.
 */
export function includeStatements(): readonly IncludeStatement[] {
  const found: IncludeStatement[] = []
  for (const [source, text] of [...SCAD_SOURCES].sort(([a], [b]) => a.localeCompare(b))) {
    for (const match of text.matchAll(/^[ \t]*(include|use)[ \t]*<([^>]*)>/gm)) {
      found.push({ source, keyword: match[1] as 'include' | 'use', target: match[2] ?? '' })
    }
  }
  return found
}

export interface IncludeResolution {
  readonly statements: readonly IncludeStatement[]
  /** Distinct targets, sorted. S1 counted 19. */
  readonly targets: readonly string[]
  /** Statements whose target is not in the VFS. Must be empty. */
  readonly dangling: readonly IncludeStatement[]
  /** Statements whose target is not a bare filename. Must be empty. */
  readonly nonFlat: readonly IncludeStatement[]
}

/** Resolve every statement against the flat map, and report what did not. */
export function resolveIncludes(): IncludeResolution {
  const statements = includeStatements()
  return {
    statements,
    targets: [...new Set(statements.map((statement) => statement.target))].sort((a, b) => a.localeCompare(b)),
    dangling: statements.filter((statement) => !SCAD_SOURCES.has(statement.target)),
    nonFlat: statements.filter((statement) => !isBareFilename(statement.target)),
  }
}

/** No separator, no traversal, and not empty. */
export function isBareFilename(target: string): boolean {
  return target !== '' && !target.includes('/') && !target.includes('\\') && !target.split('/').includes('..')
}

function buildSources(): ReadonlyMap<string, string> {
  const sources = new Map<string, string>()
  for (const [path, text] of Object.entries(GLOBBED)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    // CRLF only. A lone CR is left alone: no file in the set has one, and
    // rewriting it would be a transformation this module cannot justify from a
    // measurement.
    sources.set(name, text.replaceAll('\r\n', '\n'))
  }
  return sources
}

function deriveEntryPoints(): readonly string[] {
  const included = new Set(includedTargets())
  return [...SCAD_SOURCES.keys()]
    .filter((name) => name !== ARCHIVAL_ENTRY && !included.has(name))
    .sort((a, b) => a.localeCompare(b))
}

/** Split out of `deriveEntryPoints` so it can run before `ENTRY_POINTS` exists. */
function includedTargets(): string[] {
  const targets: string[] = []
  for (const text of SCAD_SOURCES.values()) {
    for (const match of text.matchAll(/^[ \t]*(?:include|use)[ \t]*<([^>]*)>/gm)) targets.push(match[1] ?? '')
  }
  return targets
}

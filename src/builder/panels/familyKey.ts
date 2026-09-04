/**
 * The family a tile belongs to, derived from the tile's own tags and **without
 * the template table**.
 *
 * Row **C1**. `families.ts` is the palette's 91 rows and it value-imports
 * `screens/assemblies/templates.ts`; this module is the one question the *catalog
 * drawer* asks — *"which family admits this tile, and at what size"* — answered
 * from B4's key rule rather than by looking the answer up.
 *
 * ## Why a construction and not a lookup, measured
 *
 * The drawer's *"Use in builder"* has to know the family before the press, or it
 * cannot say what it will arm and cannot refuse an insert. Importing
 * `families.ts` for it gives the **catalog** chunk an edge to the generated
 * template module, which the **builder** and **assemblies** chunks already have
 * — and three lazy chunks sharing one module is what makes the bundler hoist it
 * into the entry chunk. Measured with an A/B build:
 *
 * | | entry chunk | gzip | assemblies chunk |
 * | --- | ---: | ---: | ---: |
 * | before this row | 506.22 kB | 164.57 kB | 48.46 kB |
 * | drawer importing `families.ts` | **584.10 kB** | **170.52 kB** | 11.24 kB |
 * | drawer importing this module | 506.00 kB | 164.61 kB | 86.41 kB |
 *
 * **+5.95 kB gzip on every visit to every page**, including the landing page, to
 * put a table on the critical path that only three surfaces read. This
 * repository has been bitten by exactly that three times — `panels/boundary.test`
 * lists them — and each time an A/B build found it rather than a test. So the
 * derivation is a string construction over the axes, and this module's whole
 * import list is `@/store` for one brand, which is eager anyway.
 *
 * ## What keeps the construction honest
 *
 * A second derivation of an id the generator owns is a second source of truth,
 * and the only acceptable answer to that is a test that compares them. Over the
 * emitted index and the generated module, `palette.corpus.test.ts` measures:
 *
 *   - **0 mismatches in 50 ids and 0 in 50 names** — {@link familySlug} and
 *     {@link familyName} reproduce `pipeline/families.ts` exactly on every
 *     `(role, form, build)` family. (The 51st is `shape-base`, which no such key
 *     names and which {@link armForTags} answers by tag.)
 *   - **3,728 of 3,822 designs resolve, and every constructed id names a family
 *     this build ships** — which is B4's generation rule seen from the other
 *     end: a family exists for every key the corpus carries, so a *constructed*
 *     key cannot miss unless the generator stops doing that.
 *   - **The 94 that do not resolve are all `role|insert`**, so the drawer's
 *     refusal names a cause rather than guessing one.
 *
 * If B4's slug rule ever changes, those tests fail rather than the drawer arming
 * a family that does not exist.
 *
 * ## What it does not know, on purpose
 *
 * **The size *domain*.** A family's positions are in `GENERATED_FAMILY_SIZES`,
 * which is in the table this module refuses to import, so {@link armForTags}
 * hands over the tile's own `size|width` / `size|depth` tags and the **palette**
 * resolves them to a position with `families.ts#positionOf` — the most specific
 * position whose tags the arm carries. Measured, that lands 3,206 of the 3,728
 * (86.0%) on a real position and the other 522 on `any size`, which are the same
 * two figures the table-based derivation gives. So nothing is lost by deferring
 * it, and the reader is the side that has the domain.
 */
import { TemplateId } from '@/store'

/**
 * Display names for the three axes — B1's eight roles, its seven forms, and the
 * five build systems.
 *
 * **A copy of `pipeline/families.ts#LABELS`, and the duplication is deliberate.**
 * That module is outside `src/`'s composite project, the names it produces are
 * baked into the generated `name` of all 51 families, and a casing rule would
 * have to know that `s2w` is `S2W`, that `s-system` keeps its hyphen and that
 * `wall on tile` keeps its lower-case `on` — three exceptions over five values.
 * `palette.corpus.test.ts` compares the names this table produces to the names
 * the generator emitted, on all 50 keyed families, so the copy cannot drift
 * silently.
 */
export const AXIS_LABEL: Readonly<Record<string, string>> = {
  /* The eight roles. `insert` keeps a label although no family is generated for
     it, so a future generator that stops skipping it does not throw. */
  wall: 'Wall',
  floor: 'Floor',
  riser: 'Riser',
  column: 'Column',
  stair: 'Stair',
  roof: 'Roof',
  decor: 'Decor',
  insert: 'Insert',
  /* The seven forms. */
  straight: 'Straight',
  curve: 'Curve',
  corner: 'Corner',
  diagonal: 'Diagonal',
  hex: 'Hex',
  internal_corner: 'Internal Corner',
  octagon: 'Octagon',
  /* The five build systems. */
  's-system': 'S-System',
  s2w: 'S2W',
  'separate wall': 'Separate Wall',
  'thick wall': 'Thick Wall',
  'wall on tile': 'Wall on Tile',
}

/** A label for an axis value, falling back to the value itself. */
export function axisLabel(value: string): string {
  return AXIS_LABEL[value] ?? value
}

/**
 * The build facet's value for a family whose key carries no build system.
 *
 * A real position and not an absence: 17 of the 51 keys are build-absent, and
 * their slot **denies all five** `build|` tags by name rather than ignoring them
 * (`pipeline/families.ts#BUILD_TAGS`), so *"no build system"* admits a
 * different, disjoint set of records from any of the five — not a superset.
 */
export const NO_BUILD = 'none'

/** The tag every base carries, and the key of the one family with no role. */
export const BASE_TAG = 'shape|base'

/** The id of the family {@link BASE_TAG} names. */
export const BASE_FAMILY = 'shape-base'

/** `role|wall` → `wall`. `undefined` when no tag carries the root. */
export function axisOf(tags: readonly string[], root: string): string | undefined {
  const found = tags.find((tag) => tag.startsWith(`${root}|`))
  return found?.slice(root.length + 1)
}

/**
 * The id `pipeline/families.ts` gives a `(role, form, build)` family.
 *
 * `wall|internal_corner|s2w` → `wall-internal-corner-s2w`;
 * `floor|straight|-` → `floor-straight`. Every non-alphanumeric run becomes one
 * hyphen, which is what makes `separate wall` and `internal_corner` land on the
 * same spelling from two different separators — and what `TemplateId`'s own
 * pattern then accepts.
 */
export function familySlug(role: string, form: string, build?: string): string {
  return [role, form, ...(build === undefined ? [] : [build])]
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** The name the generator gives that family — `"Wall: Corner (S2W)"`. */
export function familyName(role: string, form: string, build?: string): string {
  const head = `${axisLabel(role)}: ${axisLabel(form)}`
  return build === undefined ? head : `${head} (${axisLabel(build)})`
}

/** The tile's own grid size, as the tags a size position is made of. */
export function sizeTagsOf(tags: readonly string[]): readonly string[] {
  return tags.filter((tag) => tag.startsWith('size|width|') || tag.startsWith('size|depth|'))
}

/** What {@link armForTags} produces: the same shape as `@/store`'s `PendingArm`. */
export interface FamilyArm {
  readonly template: TemplateId
  /**
   * The tile's own size tags — **not** a position of the family's control.
   *
   * The domain is in the table this module does not import, so the reader picks
   * the most specific position these tags satisfy (`families.ts#positionOf`).
   * That is a narrowing and never an invention: a position the arm does not
   * satisfy cannot be chosen, and `any size` is what is left when none is.
   */
  readonly size: readonly string[]
}

/**
 * The family that admits this tile, and the size to aim at.
 *
 * `shape|base` is asked **first**, because a base carries the role of the piece
 * it sits under — 1,117 of them are `role|wall` — so asking the role first would
 * file every base under a wall or floor family whose slot denies `shape|base`'s
 * records outright, and arm a family that cannot admit the tile on screen.
 *
 * `undefined` for the two cases {@link ArmRefusal} names.
 */
export function armForTags(tags: readonly string[]): FamilyArm | undefined {
  const size = sizeTagsOf(tags)
  if (tags.includes(BASE_TAG)) return { template: TemplateId.parse(BASE_FAMILY), size }
  const role = axisOf(tags, 'role')
  const form = axisOf(tags, 'form')
  if (role === undefined || form === undefined || role === 'insert') return undefined
  return { template: TemplateId.parse(familySlug(role, form, axisOf(tags, 'build'))), size }
}

/** The family's display name, for a caller that is about to arm it. */
export function armNameForTags(tags: readonly string[]): string | undefined {
  if (tags.includes(BASE_TAG)) return 'Base (Bare)'
  const role = axisOf(tags, 'role')
  const form = axisOf(tags, 'form')
  if (role === undefined || form === undefined || role === 'insert') return undefined
  return familyName(role, form, axisOf(tags, 'build'))
}

/**
 * Why {@link armForTags} answered `undefined`, so a caller can say which.
 *
 * Two causes that must not be reported as one another:
 *
 *   - **`insert`** — the tile is `role|insert`, one of 94 designs no family names
 *     *on purpose*. `pipeline/families.ts#SKIPPED_ROLES` skips the role because
 *     **262 of its 285 records are already reachable as a fill for a host tile's
 *     own accessory slot**, so the honest answer is *where the tile goes
 *     instead*.
 *   - **`unclassified`** — the tile carries no `role|` or no `form|` tag at all,
 *     so no key can be built for it. **Unreachable over the emitted index**: all
 *     8,702 records carry exactly one of each, which is why the families
 *     partition the corpus. It is reachable after an import that fails to
 *     classify a record, and it must not be reported as an insert — that tile
 *     has somewhere to go and this one does not.
 *
 * `undefined` when there is nothing to refuse.
 */
export type ArmRefusal = 'insert' | 'unclassified'

/** @see ArmRefusal */
export function armRefusalFor(tags: readonly string[]): ArmRefusal | undefined {
  if (armForTags(tags) !== undefined) return undefined
  return axisOf(tags, 'role') === 'insert' ? 'insert' : 'unclassified'
}

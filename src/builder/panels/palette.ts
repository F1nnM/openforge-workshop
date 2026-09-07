/**
 * What the palette shows, decided without a DOM.
 *
 * **A row is a template family, not an item and no longer a file** — row C1,
 * finishing §2.5's *"templates are the only placement unit"* on the one surface
 * that still listed the archive. `families.ts` holds the 87 rows and the axes;
 * this module is the three questions a panel asks of them — *which rows does
 * this query leave*, *which group does each one go in*, and *how many archive
 * tiles would fill it* — plus the session's RECENT ring.
 *
 * ## It was a search over 3,822 items and row C1 left a list of 87
 *
 * The history is worth keeping because two of the three functions that used to
 * be here died of a *measurement* rather than of a redesign:
 *
 *   - **`paletteRows`** ordered the **library** so placeable items came first.
 *     Row A0 deleted the library.
 *   - **`starterSet`** put six floors and walls of one texture into it. Also A0.
 *     Under the templates plan a starter set of six *tiles* is the wrong unit
 *     anyway; a starter set, if it comes back, is a starter *room*.
 *   - **`searchRows`** capped the archive search at 40 rows and is deleted with
 *     the archive list itself. Row A0 left that list as the only thing the panel
 *     could show; row A8 then had to make it arm **nothing**, because the
 *     surface places a `TemplateId` and the list held `DesignId`s — two id
 *     spaces `store/schema.ts` measures as *not* lexically disjoint, so passing
 *     one for the other compiles and reports every placement
 *     `unknown-template`. What replaces it is not a narrower archive search. It
 *     is a different list.
 *
 * **The archive search does not survive here, and that is a decision with a
 * reason rather than a casualty.** A palette row has to be a thing the surface
 * can place; after row A1 that is a family, and a 272px column holding two lists
 * in two different currencies — one that arms and one that cannot — is exactly
 * the state row A8 had to write a disclaimer for. The archive is not lost from
 * the app: `/catalog` is the surface built for it, with the facets, the
 * virtualised grid and the drawer, and the drawer's *"Use in builder"* is the
 * bridge back — which after this row hands over a family and a size instead of a
 * design that nothing could arm (`familyKey.ts#armForTags`, `store/selection.ts`).
 * The **search field** survives, repointed at the 87 rows it now lists, so
 * `/builder?q=corner` still narrows the palette and the URL is still linkable.
 *
 * ## No thumbnails, and that is the one thing that gets worse
 *
 * The deleted rows carried a 52x40 sprite thumbnail, and rows V3 and V5 spent
 * two revisions getting the *right* picture into it — the item's `preview`, a
 * sprite-carrying topper wherever one exists, because for the 931 items that
 * carry both an `integral` and a `topper` the palette and the catalog card had
 * been showing two different meshes of one tile.
 *
 * **A family has no picture, and inventing one would put that defect back.** The
 * top-ranked candidate is not the tile the fill solver will choose (row C2 picks
 * per slot, and the room's texture and the lock preference both move the answer
 * — the three locks disagree for 37.1% of items), so a representative thumbnail
 * would show a tile the placement does not contain. What a row carries instead
 * is the family's name and {@link candidateCount}: a number the resolver itself
 * produced. Recognition rests on 87 *names*, which is the claim §3.1 actually
 * makes; the pictures live one level down, in C3's slot editor, where a choice of
 * file is what is being made.
 *
 * ## The texture choice belongs here, and this row deliberately ships none
 *
 * §1.6's *"filterable by design"* means **texture family**, and the measurement
 * is that it is what makes a candidate grid tractable: **37 `texture|` roots, 36
 * reachable, 16 tint families**, with dungeon_stone alone holding 1,566 items and
 * the top five roots **75.6%** of all records. C3's slot editor owns it as a
 * filter over one slot's candidates. The question this row was asked is whether
 * the *palette* wants one too, and the answer is that a **room-wide** texture
 * choice belongs here rather than in the editor — but not as a facet on this
 * list:
 *
 *   - **Not a facet.** A texture is not an axis of a family: 87 rows over 36
 *     reachable roots is **3,276** rows, which is the recall cost §3.1 inverted
 *     back on itself. Every family admits tiles of many textures, so a texture
 *     chip would narrow *what a row's number counts*, not which rows exist.
 *   - **A room-wide preference, not a per-slot one.** §1.5's default-fill rule
 *     prefers *"(a) the room's design family"* first, so the fill solver already
 *     wants this value once per room; setting it per slot in C3's editor means
 *     setting it five times on one corner instance and then again on the next.
 *     The palette is where a placement is armed, so it is where the room's
 *     preference is legible.
 *   - **And it cannot ship in this row, because nothing would read it.** The
 *     only consumer is C2's fill solver, and `three/edits.ts` still places with
 *     `fills: {}` (contract C-g). A control that changed no fill and no count
 *     would be exactly what row A8 had to put a disclaimer under, so this row
 *     argues for it and does not build it. The same seam holds the size
 *     position: see the note on it in `PalettePanel.tsx`.
 *
 * ## RECENT mitigates the recognition cost; it does not fix it
 *
 * The UX research was explicit about that and this module is where the honesty
 * has to live, because the ring is the cheapest thing here to overclaim. 87 rows
 * in nine groups is still recall for anyone who does not already know the axis
 * names, and a ring of the last {@link MAX_RECENT} families the user armed helps
 * exactly the case where they are placing the same three families repeatedly —
 * which is most of building a room, and none of finding a family the first time.
 *
 * It is a **strip of chips and not a tenth group of rows**, because all 87 rows
 * are always listed and a group would put a second row on screen for the same
 * family — two rows reading as pressed, and two live copies of the size control
 * that lives inside the armed row. {@link MAX_RECENT} carries that argument.
 *
 * It is **session state, deliberately**: a module-level ring, not
 * `WorkshopState`. `store/schema.ts` is explicit that anything added to that
 * object is persisted and needs a migration rung, and `usePlanTools.ts` already
 * argued that an armed tool must not come back from last week's session. A
 * *recent* list is weaker still — it is a fact about the last ten minutes — so a
 * reload starts it empty and nothing has to be migrated, exported or shared.
 */
import type { AggregateIndex, CatalogFile } from '@/catalog'
import type { CompositionIndex } from '@/composition'
import { resolveSlotTags } from '@/composition'
import { compositionIndexFor } from '@/screens/detail/slots'

import type { GroupKey, TemplateFamily } from './families'
import { GROUP_LABEL, GROUP_ORDER, NO_BUILD, familyById } from './families'

/* ------------------------------------------------------------------ grouping */

/** One heading and its rows. Empty groups are not emitted. */
export interface PaletteGroup {
  readonly key: GroupKey | 'recent'
  /** The heading — `'Wall'`, `'S2W: Wall on Tile'`, `'Recent'`. */
  readonly label: string
  readonly rows: readonly TemplateFamily[]
}

/**
 * The rows, grouped and in `families.ts#GROUP_ORDER`.
 *
 * A group with no surviving row is dropped rather than rendered empty: the
 * facets can narrow to one form, and eight headings over one row would bury it.
 */
export function groupFamilies(families: readonly TemplateFamily[]): readonly PaletteGroup[] {
  const groups: PaletteGroup[] = []
  for (const key of GROUP_ORDER) {
    const rows = families.filter((family) => family.group === key)
    if (rows.length === 0) continue
    groups.push({ key, label: GROUP_LABEL[key], rows })
  }
  return groups
}

/* -------------------------------------------------------------------- search */

/**
 * The query, as the tokens a row has to hold **all** of.
 *
 * Lower-cased and split on anything that is not a letter or a digit, so
 * `separate wall`, `wall-on-tile` and `Wall: Corner` all tokenise the same way.
 * Conjunctive rather than disjunctive, because the interesting queries are two
 * words of one family's name — `corner s2w` — and an `OR` over those returns
 * every corner *and* every S2W.
 *
 * **Not the facet engine.** `@/search` ranks 3,822 items by text score over an
 * interned vocabulary; this is a substring test over 87 short strings, and
 * borrowing the engine would mean indexing a second corpus that is not in the
 * catalog. What the two do share is the field the user types into, and `/builder`
 * still validates and carries `q` for it.
 */
export function queryTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
}

/**
 * The haystack a query is matched against: the full name and the three axes.
 *
 * The **full** name and not `shortName`, so `wall corner` still finds a row
 * whose heading is carrying the word `Wall` for it. The axis values are in there
 * too, in the corpus's own spelling, so `s2w` matches `build|s2w` even where the
 * name says `(S2W)`, and `internal corner` matches `form|internal_corner`.
 */
function haystack(family: TemplateFamily): string {
  return [family.name, family.role, family.form, family.build]
    .filter((part) => part !== undefined)
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ')
}

/** Every token present, as a substring. */
export function matchesQuery(family: TemplateFamily, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true
  const text = haystack(family)
  return tokens.every((token) => text.includes(token))
}

/** The two facet axes, as §3.1 names them: *"form and build as facets"*. */
export interface PaletteFacets {
  /** One of B1's seven forms, or `undefined` for all of them. */
  readonly form: string | undefined
  /** One of the five build systems, `families.ts#NO_BUILD`, or `undefined`. */
  readonly build: string | undefined
}

/** No facet chosen. */
export const ALL_FACETS: PaletteFacets = { form: undefined, build: undefined }

/**
 * The rows a query and a pair of facets leave, in `TEMPLATE_FAMILIES` order.
 *
 * The facets are **single-select per axis** rather than multi-select, and the
 * reason is the row count: 87 rows over 7 forms and 6 build values means the
 * average chip narrows to 13, so a second chip on the same axis is almost always
 * a way to build an empty intersection by accident. Re-pressing the chosen chip
 * clears it, which is what `aria-pressed` promises and what the palette's rows
 * have always done.
 *
 * A recipe carries no `role|` or `form|` tag at all — its tags are the fixtures'
 * `object|`, `build|`, `shape|` and `component|` roots — so a **form** chip hides
 * all 40, and the `s2w` **build** chip keeps them, because all 40 carry
 * `build|s2w`.
 */
export function filterFamilies(
  families: readonly TemplateFamily[],
  query: string,
  facets: PaletteFacets = ALL_FACETS,
): readonly TemplateFamily[] {
  const tokens = queryTokens(query)
  return families.filter((family) => {
    if (facets.form !== undefined && family.form !== facets.form) return false
    if (facets.build !== undefined && (family.build ?? NO_BUILD) !== facets.build) return false
    return matchesQuery(family, tokens)
  })
}

/**
 * The facet values that are actually reachable, so no chip is a dead end.
 *
 * Computed against the *other* axis and the query, not against the whole set: a
 * chip that would leave zero rows is not offered at all, which is the difference
 * between a facet and a filter with a trap in it. The chosen value is always
 * included, or pressing it a second time to clear it would be impossible.
 */
export function reachableFacets(
  families: readonly TemplateFamily[],
  query: string,
  facets: PaletteFacets,
): { readonly forms: readonly string[]; readonly builds: readonly string[] } {
  const forms = new Set<string>()
  for (const family of filterFamilies(families, query, { form: undefined, build: facets.build })) {
    if (family.form !== undefined) forms.add(family.form)
  }
  if (facets.form !== undefined) forms.add(facets.form)

  const builds = new Set<string>()
  for (const family of filterFamilies(families, query, { form: facets.form, build: undefined })) {
    builds.add(family.build ?? NO_BUILD)
  }
  if (facets.build !== undefined) builds.add(facets.build)

  return { forms: order([...forms], FORM_ORDER), builds: order([...builds], BUILD_ORDER) }
}

/**
 * B1's own order for the two axes, so the chips do not read as a scatter.
 *
 * The reachable values come out of a scan over the rows, which puts them in
 * whatever order the 19 wall families happen to introduce them. A user reads a
 * facet row as a list, and the list that means something is the axis's — forms
 * from the commonest shape outward, builds as `pipeline/families.ts#LABELS`
 * spells them, with *no system* last because it is the absence of the other
 * five rather than a sixth one.
 */
const FORM_ORDER: readonly string[] = [
  'straight',
  'curve',
  'corner',
  'internal_corner',
  'diagonal',
  'hex',
  'octagon',
]

const BUILD_ORDER: readonly string[] = [
  's-system',
  's2w',
  'separate wall',
  'thick wall',
  'wall on tile',
  NO_BUILD,
]

/** Sorted by `canonical`, with anything unlisted kept at the end in scan order. */
function order(values: readonly string[], canonical: readonly string[]): readonly string[] {
  const rank = (value: string): number => {
    const at = canonical.indexOf(value)
    return at === -1 ? canonical.length : at
  }
  return [...values].sort((a, b) => rank(a) - rank(b))
}

/* -------------------------------------------------------------------- counts */

/**
 * How many archive tiles a family's slot admits at a size position.
 *
 * **The resolver's own answer, not a second one.** `resolveSlotTags` is what
 * `assembly.ts` and C3's picker call, and the size position's tags go in as
 * `parentTags` exactly the way a placed instance's do — so the number on the row
 * is the number the fill solver will choose from and cannot drift from it. B4's
 * emitter proved the refs mean what the key means (0 over-admissions and 0
 * under-admissions over all 47 families at all 257 sized positions); this is
 * that same resolution, live, against whatever index the app loaded.
 *
 * **Items, not files** — `SlotCandidates.items` — because the noun on screen is
 * *tiles* and the whole app counts a tile as a design (`screens/catalog`'s field
 * says *"N tiles match"* over items, and two counts over one archive disagreeing
 * about the noun would read as two different archives).
 *
 * `undefined` for the 40 recipes rather than 0: a recipe has 2 to 5 slots, so one
 * number cannot answer *"how many tiles fill this"*, and the row shows its part
 * count instead. Measured over the emitted index, **all 47 families and all 304
 * positions admit at least one tile** — the 0 case is only reachable on a partial
 * catalog build, and such a row is still armed rather than refused, because §3.2
 * places a template whose slot has no candidate and reports the slot as *needs a
 * choice*.
 */
export function candidateCount(
  composition: CompositionIndex,
  family: TemplateFamily,
  size: readonly string[] = [],
): number | undefined {
  if (family.kind === 'recipe') return undefined
  const part = family.template.parts[0]
  if (part === undefined) return undefined
  const parentTags = size.length === 0 ? family.template.tags : [...family.template.tags, ...size]
  return composition.candidatesFor(resolveSlotTags(part.tags, parentTags, [])).items.length
}

/** What {@link createCounter} returns: a count for a row, memoised. */
export type CandidateCounter = (family: TemplateFamily, size?: readonly string[]) => number | undefined

/**
 * A counter memoised per index, for the panel's render.
 *
 * 87 rows measure 7 ms over the real corpus and every keystroke re-renders the
 * list, so the panel must not re-resolve on each one. The inverted index behind
 * it is `compositionIndexFor`'s, which is the **same instance** `BuilderScreen`
 * built for the bill and C3's slot editor built for its candidate grids — 10.7 ms
 * and 409,432 bytes, paid once per catalog file, not once per mount.
 */
export function createCounter(file: CatalogFile, aggregates: AggregateIndex): CandidateCounter {
  const composition = compositionIndexFor(file, aggregates)
  const cache = new Map<string, number | undefined>()
  return (family, size = []) => {
    // A space appears in no `size|` tag and in no template id, so joining on one
    // is unambiguous — no delimiter hazard and nothing to escape.
    const key = [family.id, ...size].join(' ')
    if (cache.has(key)) return cache.get(key)
    const count = candidateCount(composition, family, size)
    cache.set(key, count)
    return count
  }
}

/* -------------------------------------------------------------------- recent */

/**
 * How many arms the RECENT strip holds.
 *
 * Six. It is a strip of chips above the list rather than a tenth group of rows,
 * and that shape is a consequence rather than a style choice: **a group would
 * duplicate rows.** All 87 rows are always listed, so a RECENT *group* puts a
 * second row on screen for the same family — two rows reading as pressed, and,
 * because the size control lives inside the armed row, two live copies of one
 * control. A chip is visibly a shortcut to a row rather than a second row, and
 * it is honest about what RECENT is: the research measured it as a *mitigation*
 * of the recognition cost, not a fix for it.
 */
export const MAX_RECENT = 6

/**
 * The ring holds **arms, not families** — a family *and* the size it was armed
 * at.
 *
 * Because that is what re-placing something is: a user who has just put down
 * four 2x2 floors wants the fifth at 2x2, and a chip that armed the family at
 * `any size` would silently drop the only part of the choice they made twice.
 * It is also exactly `PendingArm`'s shape, which is what the drawer's handoff
 * carries, so one press of "Use in builder" and one press of a palette row leave
 * the same kind of trace.
 *
 * Module-level session state — see the module note on why not the store.
 */
export interface RecentArm {
  readonly template: string
  readonly size: readonly string[]
}

let recent: readonly RecentArm[] = []

/** The identity two arms are the same under: the family and the position. */
const armKey = (arm: RecentArm): string => [arm.template, ...arm.size].join(' ')

/** The most recently armed arms, newest first, dropping any this build lost. */
export function recentArms(): readonly { readonly family: TemplateFamily; readonly size: readonly string[] }[] {
  const rows: { family: TemplateFamily; size: readonly string[] }[] = []
  for (const arm of recent) {
    const family = familyById(arm.template)
    if (family !== undefined) rows.push({ family, size: arm.size })
  }
  return rows
}

/**
 * Note that a family was armed at a size.
 *
 * Moves an already-present arm to the front rather than duplicating it, so the
 * ring is a set with an order and arming the same thing twice does not spend two
 * of the six slots on it. Two sizes of one family are two arms, which is the
 * point of holding the size at all.
 */
export function rememberArm(arm: RecentArm): void {
  const key = armKey(arm)
  recent = [arm, ...recent.filter((held) => armKey(held) !== key)].slice(0, MAX_RECENT)
}

/** Empty the ring. For a test, and for a caller that wants the pristine state. */
export function forgetRecentFamilies(): void {
  recent = []
}

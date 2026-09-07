/**
 * What the palette shows, decided without a DOM.
 *
 * **A row is a template family, not an item and no longer a file** — row C1,
 * finishing §2.5's *"templates are the only placement unit"* on the one surface
 * that still listed the archive. `families.ts` holds the 91 rows and the axes;
 * this module is the four questions a panel asks of them — *which rows does this
 * query leave*, *in what order*, *which section and group does each one go in*,
 * and *how many archive tiles would fill it* — plus the session's RECENT ring.
 *
 * ## Row D2: the list says which of two kinds a row is, before anything else
 *
 * C1 listed all 91 as one list because all 91 place through one function. The
 * project owner placed a corner from it, got one slot, and reported the template
 * system broken — the 5-slot assembly they had asked for was 23 rows below the
 * 1-slot family they found, under a heading naming a build system. So:
 * {@link paletteSections} splits the list in two with the assemblies first,
 * {@link rankFamilies} orders each section against the query, and every row
 * carries `TemplateFamily.slots`. Those three docblocks carry the measurements.
 *
 * ## It was a search over 3,822 items and row C1 left a list of 91
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
 * The **search field** survives, repointed at the 91 rows it now lists, so
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
 * produced. Recognition rests on 91 *names*, which is the claim §3.1 actually
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
 *   - **Not a facet.** A texture is not an axis of a family: 91 rows over 36
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
 * has to live, because the ring is the cheapest thing here to overclaim. 91 rows
 * over two sections and eight groups is still recall for anyone who does not
 * already know the axis names, and a ring of the last {@link MAX_RECENT} families the user armed helps
 * exactly the case where they are placing the same three families repeatedly —
 * which is most of building a room, and none of finding a family the first time.
 *
 * It is a **strip of chips and not a third section of rows**, because all 91 rows
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

/** One role heading and its rows, inside the single-tile section. */
export interface PaletteGroup {
  readonly key: GroupKey
  /** The heading — `'Wall'`, `'Floor'`, `'Base'`. */
  readonly label: string
  readonly rows: readonly TemplateFamily[]
}

/**
 * The single-tile rows, grouped and in `families.ts#GROUP_ORDER`.
 *
 * A group with no surviving row is dropped rather than rendered empty: the
 * facets can narrow to one form, and eight headings over one row would bury it.
 * Input order is preserved inside each group, which is what carries
 * {@link rankFamilies}' ordering through to the screen.
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

/* ------------------------------------------------------------------ sections */

/** The two kinds of row, as the two things the palette lists. */
export type SectionKey = 'assemblies' | 'tiles'

/**
 * The words the two kinds go by **on screen**.
 *
 * The types call them `recipe` and `family` (`families.ts#FamilyKind`, and
 * `screens/assemblies` upstream of it); a user has never seen either word, and
 * what a palette using neither costs is the owner's report. *Assembly* is a
 * placement that brings several tiles; *single tile* is a placement that brings
 * one. Both are placed by the same `placeTemplate`, which is exactly why the
 * distinction has to be spelled out rather than left to be inferred.
 */
export const SECTION_LABEL: Readonly<Record<SectionKey, string>> = {
  assemblies: 'Assemblies',
  tiles: 'Single tiles',
}

/** One section: a heading, everything under it, and its sub-groups if it has any. */
export interface PaletteSection {
  readonly key: SectionKey
  readonly label: string
  /** Every row in the section, in display order — and the heading's count. */
  readonly rows: readonly TemplateFamily[]
  /** The role groups of the single-tile section; **empty** for the assemblies. */
  readonly groups: readonly PaletteGroup[]
}

/**
 * The palette's whole list for one query and one pair of facets: **assemblies
 * first, in their own section, then the single tiles**.
 *
 * ## Why the kind is the first distinction and not the ninth group
 *
 * C1's list was 91 rows in nine groups ordered by corpus records, so the 40
 * assemblies were the ninth group — rows 52 to 91 — under a heading reading
 * `S2W: Wall on Tile`. The project owner placed a `Corner (Wall on Tile)`, found
 * a one-slot row and concluded the template system did not do what they had asked
 * for; `families.ts` quotes them. The assembly they wanted ships, 23 rows below
 * the family they found, and **sixteen** one-slot rows whose names also contain
 * *corner* sat between the two.
 *
 * None of that is a template defect, and ranking inside one flat list does not
 * fix it either: the two kinds behave differently once placed — one brings five
 * slots you fill individually, the other brings one — so a list that never says
 * which kind a row is has omitted the fact the user is choosing on. A section is
 * that fact, said once per section instead of 91 times.
 *
 * ## What the section order is, and what it is not
 *
 * A **fixed order the owner chose**, not a relevance judgement: assemblies always
 * render above single tiles. That is safe here in a way it would not be in a
 * truncated result list, because **both sections always render in full** in one
 * scroll container — a better-matching single tile is a screen further down, never
 * dropped. Inside a section {@link rankFamilies} orders the rows, and that is the
 * only part of this that judges the query.
 *
 * **The 51 one-slot rows are not second-class, and being second is not a
 * demotion.** B4 measured them reaching 8,417 records (96.7%) and 3,822 designs
 * (100%) against the 40 assemblies' 3,079 (35.4%), and every curve, riser, stair
 * and roof in the archive is reachable *only* through one of them — there is no
 * assembly for any of those roles. The owner rejected hiding them behind a toggle
 * for that reason, and it is why the second section keeps its own count, its own
 * role groups and its own facets rather than becoming a footnote.
 *
 * An empty section is dropped rather than rendered as a heading over nothing —
 * the rule {@link groupFamilies} applies one level down.
 */
export function paletteSections(
  families: readonly TemplateFamily[],
  query: string,
  facets: PaletteFacets = ALL_FACETS,
): readonly PaletteSection[] {
  const rows = rankFamilies(filterFamilies(families, query, facets), query)
  const sections: PaletteSection[] = []
  const assemblies = rows.filter((family) => family.kind === 'recipe')
  if (assemblies.length > 0) {
    sections.push({ key: 'assemblies', label: SECTION_LABEL.assemblies, rows: assemblies, groups: [] })
  }
  const tiles = rows.filter((family) => family.kind === 'family')
  if (tiles.length > 0) {
    sections.push({
      key: 'tiles',
      label: SECTION_LABEL.tiles,
      rows: tiles,
      groups: groupFamilies(tiles),
    })
  }
  return sections
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
 * interned vocabulary; this is a substring test over 91 short strings, and
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

/* ------------------------------------------------------------------- ranking */

/**
 * What a token is worth, by *where* it landed. Higher is a better answer.
 *
 * The row's own label — `families.ts#TemplateFamily.shortName`, the text a user
 * actually reads — is worth more than the parts of {@link haystack} they cannot
 * see, and a word is worth more than the middle of one. Four tiers, because
 * `matchesQuery` has already thrown out everything that matches nowhere:
 *
 *   - **`LABEL_HEAD`** — the label *starts* with the token. `corner` on
 *     `Corner (Any, Single Piece)`.
 *   - **`LABEL_WORD`** — a later word of the label starts with it. `corner` on
 *     `Internal Corner (Modular)`.
 *   - **`LABEL_MID`** — inside a word of the label rather than at its start;
 *     `all` inside `Straight (Separate Wall)` is the shape of it.
 *   - **`AXIS_ONLY`** — not in the label at all, only in the stripped prefix, the
 *     role the group heading carries, or an axis value in the corpus's spelling.
 *     `s2w` on an assembly, whose `build|s2w` is a tag and not a word of its name.
 */
const LABEL_HEAD = 4
const LABEL_WORD = 3
const LABEL_MID = 2
const AXIS_ONLY = 1

/** True when nothing alphanumeric precedes `at` — the start of a word. */
function isWordStart(text: string, at: number): boolean {
  return at === 0 || !/[a-z0-9]/.test(text.charAt(at - 1))
}

function tokenScore(family: TemplateFamily, token: string): number {
  const label = family.shortName.toLowerCase().replace(/_/g, ' ')
  const at = label.indexOf(token)
  if (at === 0) return LABEL_HEAD
  if (at > 0) return isWordStart(label, at) ? LABEL_WORD : LABEL_MID
  return haystack(family).includes(token) ? AXIS_ONLY : 0
}

/**
 * How well a row answers the query. Only comparable **within** one section.
 *
 * The sum over the tokens, so a two-word query that lands both words on the
 * label beats one that lands a word on the label and a word on a hidden tag.
 * Zero for the empty query, which is what makes {@link rankFamilies} a no-op
 * there.
 */
export function rowScore(family: TemplateFamily, tokens: readonly string[]): number {
  return tokens.reduce((total, token) => total + tokenScore(family, token), 0)
}

/**
 * `': '`-delimited qualifiers on the row's own label, beyond the first segment.
 *
 * The tiebreak, and the one that decides the owner's query. Typing `corner`
 * leaves four assemblies whose label begins with the word — two of them
 * `Corner (Any, …)` and two `Corner: Low (…)` — and they are indistinguishable
 * by where the token landed. The rule that separates them is **length
 * normalisation**: a qualifier the query did not ask for makes the row a worse
 * answer to that query, so the unqualified `Corner` sorts above `Corner: Low`.
 * Ask for `corner low` and the extra token pays for the qualifier and the order
 * inverts, which is the property that makes this a ranking rather than a
 * preference.
 *
 * **0 for all 51 single-tile labels**, measured — the generator writes every one
 * of them as one segment plus a parenthesised build — so this term orders the
 * assemblies alone, which is where the fixtures put the qualifier structure.
 */
function qualifiers(family: TemplateFamily): number {
  return family.shortName.split(': ').length - 1
}

/**
 * The rows in the order a query leaves them, and **untouched when there is no
 * query**.
 *
 * The no-query case is the important half of that sentence: with nothing typed
 * every score is 0 and the sort is a no-op, so the 40 assemblies stay in fixture
 * order and the 51 single tiles in the corpus order §3.1 argued for. Ranking is
 * something a query does, not a permanent reordering.
 *
 * **How an assembly gets above a single tile.** Not here — {@link
 * paletteSections} renders the assemblies section first, so for an equal-quality
 * match the assembly is above by construction, and this function never compares
 * the two kinds against each other. What it does is decide the order *inside*
 * each section, and the measurement that matters is the owner's own query:
 * `corner` leaves 24 rows, 8 assemblies and 16 single tiles, and it puts
 * `Corner (Any, Single Piece)` — column, right wall, left wall, floor, base —
 * **first of all 24**.
 *
 * `Array.prototype.sort` is stable by specification, so `TEMPLATE_FAMILIES`'
 * declared order is the final tiebreak and equal rows never shuffle between
 * keystrokes.
 */
export function rankFamilies(
  families: readonly TemplateFamily[],
  query: string,
): readonly TemplateFamily[] {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return families
  const scored = new Map(families.map((family) => [family, rowScore(family, tokens)]))
  return [...families].sort(
    (a, b) => (scored.get(b) ?? 0) - (scored.get(a) ?? 0) || qualifiers(a) - qualifiers(b),
  )
}

/** The two facet axes, as §3.1 names them: *"form and build as facets"*. */
export interface PaletteFacets {
  /**
   * One of B1's seven forms, or `undefined` for all of them.
   *
   * **Narrows the single tiles only** — see {@link filterFamilies}.
   */
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
 * reason is the row count: 91 rows over 7 forms and 6 build values means the
 * average chip narrows to 13, so a second chip on the same axis is almost always
 * a way to build an empty intersection by accident. Re-pressing the chosen chip
 * clears it, which is what `aria-pressed` promises and what the palette's rows
 * have always done.
 *
 * ## The two axes reach different numbers of sections, and that is the data
 *
 * §3.1 wrote *"form and build as facets"* over one list. There are two lists
 * now, and each axis is scoped to what a template **actually carries on itself**
 * rather than to whichever scope reads more simply:
 *
 *   - **`build` narrows both sections.** Every one of the 91 carries at most one
 *     `build|` tag of its own — all 40 assemblies are `build|s2w`, 34 of the 51
 *     single tiles name one of the five systems and the other 17 name none, which
 *     is `families.ts#NO_BUILD` and a disjoint set rather than a superset
 *     (`pipeline/families.ts#BUILD_TAGS` denies all five by name). One value per
 *     row on both sides, so one chip means the same thing on both.
 *   - **`form` narrows the single tiles only, and leaves the assemblies section
 *     exactly as it was.** An assembly carries **no `form|` tag** — its own tags
 *     are the fixtures' `object|`, `build|`, `shape|` and `component|` roots — and
 *     its form is not one value but up to five, one per part, in the parts'
 *     `require` blocks: the 5-part corner asks for `shape|column|corner`,
 *     `shape|corner|right`, `shape|corner|left`, `shape|floor|corner` and
 *     `shape|base|square`. There is no single form for a chip to mean.
 *
 * **The alternative was measured and refused.** C1's rule applied `form` to
 * everything, so a form chip hid all 40 assemblies — pressing `Corner`, the most
 * natural narrowing for the query the owner actually ran, emptied the section
 * holding the answer. Reproducing the defect inside the fix is not a defensible
 * reading of *"never offer a value nothing reaches"*, and the honest reading is
 * that the value does reach every assembly, because none of them is excluded by
 * an axis they do not have. The nearest thing to a form on those 40 is
 * `shape|corner` / `shape|internal_corner` / `shape|wall` on the template — 3
 * values over the 40, and `form|` is a separate tag root the corpus emits
 * independently, so treating one as the other would be a **second, unmeasured
 * derivation** of B1's axis. `s2w` in the search field still reaches all 40,
 * because {@link haystack} carries the axis values.
 */
export function filterFamilies(
  families: readonly TemplateFamily[],
  query: string,
  facets: PaletteFacets = ALL_FACETS,
): readonly TemplateFamily[] {
  const tokens = queryTokens(query)
  return families.filter((family) => {
    if (facets.form !== undefined && family.kind === 'family' && family.form !== facets.form) {
      return false
    }
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
 *
 * The **forms** are collected from the single tiles alone, which needs no filter
 * of its own: an assembly's `form` is `undefined`, and `undefined` is not a chip.
 * The **builds** come from both sections, which is what makes the `S2W` chip
 * offerable while the 40 assemblies are the only thing it would leave.
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
 * under-admissions over all 51 families at all 299 sized positions); this is
 * that same resolution, live, against whatever index the app loaded.
 *
 * **Items, not files** — `SlotCandidates.items` — because the noun on screen is
 * *tiles* and the whole app counts a tile as a design (`screens/catalog`'s field
 * says *"N tiles match"* over items, and two counts over one archive disagreeing
 * about the noun would read as two different archives).
 *
 * `undefined` for the 40 assemblies rather than 0: an assembly has 3 or 5 slots,
 * so one number cannot answer *"how many tiles fill this"*, and its row shows the
 * slot count and its build system instead. Measured over the emitted index, **all 51 families and all 350
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
 * 91 rows measure 7 ms over the real corpus and every keystroke re-renders the
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
 * Six. It is a strip of chips above **both** sections rather than a third one,
 * and that shape is a consequence rather than a style choice: **a section would
 * duplicate rows.** All 91 rows are always listed, so a RECENT *section* puts a
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

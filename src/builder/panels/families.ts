/**
 * The 87 placeable templates, as the palette's rows — and the map from a catalog
 * item back to one of them.
 *
 * Row **C1**. `templates.ts` emits two arrays and a size table and says nothing
 * about how they are shown; this module is that decision, made without a DOM so
 * the grouping, the facets and the size domain can be measured rather than
 * eyeballed. `palette.ts` counts what a row admits and `PalettePanel.tsx`
 * renders it.
 *
 * **The catalog drawer's question lives next door, in `familyKey.ts`, and the
 * split is a bundle measurement rather than a taste.** *"Which family admits
 * this tile"* is answered there by constructing B4's key from the tile's tags,
 * because a value import of this module from the drawer gives the catalog chunk
 * an edge to the generated template table — and three lazy chunks sharing that
 * table hoists it into the entry chunk, at **+5.95 kB gzip on every visit to
 * every page**. That file carries the A/B build and the tests that keep the
 * construction and this table in step.
 *
 * ## 87, and they are two different kinds of thing
 *
 *   - **47 generated families** (`GENERATED_FAMILIES`), one required slot each,
 *     keyed on B4's derived `(role, form, build)` — plus `shape-base`, which no
 *     such key can name because `base` is a `layer` value and not one of B1's
 *     eight roles (row A9 proved that, and `shape|base` is coextensive with
 *     `layer === 'base'` on all 1,963 records with zero exceptions either way).
 *
 *     **It was 51 until row D1.** A base keeps the role of the piece it sits
 *     under, so the key selected all 1,963 of them into a role family as well —
 *     17 rows offering bases, 1,963 wrong candidates, and four rows whose every
 *     candidate was a base. Every family now denies `shape|base` and the four
 *     that admitted nothing else are not generated: two walls
 *     (`wall|corner|separate wall`, `wall|internal_corner|s2w`) and two floors
 *     (`floor|straight|separate wall`, `floor|curve|separate wall`), 134 records
 *     between them, all reached through `shape-base` instead.
 *   - **40 shipped recipes** (`RECIPE_TEMPLATES`), read from the 20 blueprint
 *     fixtures, 128 authored parts between them, every one of them a
 *     `S2W: Wall on Tile` composition.
 *
 * Both are `RecipeTemplate`s and both are placeable through `placeTemplate`, and
 * **row C1 read that as licence to list them together. It is not, and the cost
 * of the mistake was measured in a real browser.** The project owner placed a
 * corner, got a one-slot row, and reported:
 *
 * > *"It shows everywhere as having one slot only. … I can't individually modify
 * > the walls. I also can't select a floor. I need to be able to do that though.
 * > Thats the whole point of the templates I wanted."*
 *
 * Everything underneath was working. `S2W: Wall on Tile: Corner (Any, Single
 * Piece)` ships, with `[column, right wall, left wall, floor, base]` — the floor,
 * the two walls and the column, in their own words. It was row 50 of 87, under a
 * heading that named a build system rather than a kind, and the eleven — measured
 * **fourteen**, and sixteen before row D1's drop — one-slot rows whose names also
 * say *corner* were above it. So the
 * kind of thing a row is is the **first** distinction the palette makes now
 * (`palette.ts#paletteSections`), and the slot count is on every row.
 *
 * The other two differences C1 named still hold: an assembly has **no size
 * control** (its parts name their own `size|width|2`, so size is part of its
 * identity) and no single candidate count, because 3 or 5 slots have no one
 * answer to *"how many tiles fill this"*.
 *
 * ## Grouped by role inside the single tiles, because that is what inverts the cost
 *
 * §3.1's measurement is the whole argument for this shape: predicated on raw
 * tags the palette would have grown from roughly 20 recognisable library rows to
 * **3,862** entries — recognition becoming recall. Role-predicated families make
 * it **47**, in eight groups, under one section heading.
 *
 * {@link GROUP_ORDER} is ordered by the corpus, not alphabetically, and the
 * figures are records carrying each `role|` tag over the emitted index (measured
 * here, re-measured by `palette.corpus.test.ts`):
 *
 * | group | records | families |
 * | --- | ---: | ---: |
 * | wall | 5,381 | 17 |
 * | floor | 2,162 | 15 |
 * | riser | 319 | 2 |
 * | column | 223 | 6 |
 * | stair | 206 | 3 |
 * | roof | 100 | 2 |
 * | decor | 26 | 1 |
 * | base | 1,963 | 1 |
 *
 * The family counts do **not** follow the record counts — riser has 319 records
 * in 2 families and column 223 in 6 — so the two orderings are different lists
 * and the one that matters is where a user will look first. `base` sits after the
 * seven roles rather than in them because the *records* column double-counts it:
 * a base keeps the role of the piece it sits under (1,117 wall, 661 floor, 176
 * riser, 9 stair), so all 1,963 are inside the 5,381 and the 2,162 as well.
 *
 * What no longer double-counts is the **candidates**: since row D1 every family
 * denies `shape|base`, so the 47 rows offer 8,417 records between them and each
 * of those records exactly once — the whole corpus less the 285 inserts.
 * `palette.corpus.test.ts` measures that as a partition; it read 10,380 before.
 *
 * **There is no `insert` group, and its absence is measured rather than
 * incidental.** `role|insert` is a perfect bijection with `layer === 'insert'` —
 * the same 285 records — B1's own file says no slot should require it, and
 * `pipeline/families.ts#SKIPPED_ROLES` generates nothing for it, because **262
 * of the 285 are already reachable through a tile's own accessory slots**
 * (`screens/detail/slots/SlotFills.tsx`, which ships). So a door is not a family
 * and the panel says where a door lives instead of listing 94 designs it cannot
 * place. {@link INSERT_DESIGNS} is that count from the other end.
 *
 * ## Size is a control on the family, and 7 families have none
 *
 * B3's reason it is a control at all: keyed on `(role, form, build)` the corpus
 * needs 47 families and keyed with size in the key, 217 to 277. So a position is
 * a *parameter* of one placed instance, and `GENERATED_FAMILY_SIZES` holds the
 * domain — **304 positions across the 47**, median 4 and maximum 32 counting the
 * `any size` position every family carries.
 *
 * **The brief for this row said 5 families have no size domain. Measured, 7 have
 * no size control**, and the difference is not a mistake in either figure — it is
 * two causes that produce the same row:
 *
 *   - **B3's five empty domains** — `wall|diagonal|separate wall` (121 records),
 *     `decor|straight` (26), `wall|octagon|separate wall` (20),
 *     `wall|hex|thick wall` (8) and `floor|octagon` (8); 183 records that
 *     resolve no grid cell at all.
 *   - **two whose whole domain is inexpressible** — `stair|curve` and
 *     `column|corner|s2w`. Their records *do* resolve cells; no `size|` tag
 *     names them, which is B4's 16 refused cells (12 annular sectors whose cell
 *     is `rOut x rOut`, 3 columns at `0.5 x 0.5` where `size|width` has no
 *     `0.5`, and one `3x0.5` curve wall).
 *
 * Both arrive here as a one-entry table, and the panel must render **no control**
 * rather than a control with one position in it — a radio group of one is a
 * control that cannot be operated. {@link TemplateFamily.sizes} is therefore
 * empty for all 7, and `[]` never means "any size is unavailable": with no size
 * chosen the slot's `constrain` block collects nothing and the family admits
 * every size, which is what makes `any size` a real default rather than a missing
 * selection.
 *
 * Two of those figures are row D1's and both moved for the same reason: the
 * third inexpressible family was `floor|curve|separate wall`, which is gone
 * because all 41 of its records were bases, and `wall|hex|thick wall` fell from
 * 56 records to 8 because 48 of its 56 were.
 */
import type { RecipeTemplate } from '@/assembly'
import { GENERATED_FAMILIES, GENERATED_FAMILY_SIZES, RECIPE_TEMPLATES } from '@/assembly/templates'
import { TemplateId } from '@/store'

import { axisOf } from './familyKey'

/**
 * One position of a family's size control.
 *
 * Structurally `pipeline/families.ts#FamilySizePosition`, declared again here
 * because that module is outside `src/`'s composite project and its type is not
 * importable. `tags` are exact-match `size|width|w` / `size|depth|d` refs that
 * join the instance's `parentTags`, where the slot's own `constrain` collects
 * them — so a position costs no resolution code and no index bytes.
 */
export interface SizePosition {
  /** *"2 wide by 2 deep"*, *"2 wide"*, *"any size"*. True of everything it admits. */
  readonly label: string
  /** One or two tags, or none on the `any size` position. */
  readonly tags: readonly string[]
}

/**
 * Which of the two arrays a row came from. See the module note.
 *
 * **The code's word and the screen's word are not the same word, and row D2
 * fixed the screen's.** `recipe` is what `screens/assemblies` calls a
 * multi-slot composition and it stays the name in the types; on screen those 40
 * rows are **assemblies** and the 47 one-slot rows are **single tiles**, because
 * the owner's report of this palette was that it *"shows everywhere as having
 * one slot only"* — the two kinds were listed as one list of 87 and the words
 * `family` and `recipe` were nowhere on it. `palette.ts#SECTION_LABEL` is the
 * one place the display words are spelled.
 */
export type FamilyKind = 'family' | 'recipe'

/**
 * The eight groups the single-tile rows are split into — {@link GROUP_ORDER}.
 *
 * **The 40 assemblies are not in here and no longer have a group.** They were a
 * ninth `recipe` group under a heading that said `S2W: Wall on Tile`, which is
 * how the owner came to place a one-slot corner and conclude the templates were
 * broken: the assembly they wanted was thirty-eight rows further down under a heading
 * naming a build system rather than a kind. Row D2 makes the kind the *section*
 * (`palette.ts#paletteSections`) and the role the sub-group inside one of them,
 * so `TemplateFamily.group` is `undefined` for all 40.
 */
export type GroupKey = 'wall' | 'floor' | 'riser' | 'column' | 'stair' | 'roof' | 'decor' | 'base'

/** One palette row: a template, with what the panel needs to show and filter it. */
export interface TemplateFamily {
  /** Branded on the way in; all 87 emitted ids parse. */
  readonly id: TemplateId
  /** The template's own name — `"Wall: Corner (S2W)"`, `"S2W: Wall on Tile: Wall: Torch (Modular)"`. */
  readonly name: string
  /**
   * {@link name} with the words the row's own heading already says taken off
   * the front.
   *
   * The group heading already says `WALL`, so 19 rows that each begin *"Wall: "*
   * spend a third of a 272px column repeating it. Falls back to the full name
   * whenever the prefix is not there, so nothing is ever trimmed to nothing.
   *
   * For an assembly that prefix is {@link RECIPE_PREFIX} — `S2W: Wall on
   * Tile: ` — and **row D2 kept the strip while deleting the heading it used to
   * pay for.** The section is now called *Assemblies*, so nothing on screen
   * would say `s2w` any more; the build system moved onto the row itself
   * instead, from the template's own `build|` tag (`PalettePanel.tsx#rowFact`),
   * which is a per-row fact and stays right when D4 adds an assembly for a
   * different build system.
   */
  readonly shortName: string
  readonly kind: FamilyKind
  /** The single-tile group, or `undefined` for the 40 assemblies. */
  readonly group: GroupKey | undefined
  /** B1's axes, from the template's own tags. `undefined` where the key has no such value. */
  readonly role: string | undefined
  readonly form: string | undefined
  readonly build: string | undefined
  /**
   * Slots to fill — **`template.parts.length` and nothing derived from it**.
   *
   * 1 for all 47 families; **3 or 5** across the 40 assemblies — the 4 outer
   * corners at 5, the other 36 at 3 (measured; C1's docblock said *"2 to 5"*
   * and no template has 2 or 4). Row D2 puts this number on every row, and
   * it is the row's whole job to be the number the next surface agrees with:
   * the owner's report was a row that said one thing and behaved as another, so
   * a second derivation — parts minus the 20 that declare `fulfills`, say — is
   * the one thing this field must not be. `screens/assemblies/assembly.ts`
   * measured that reading and rejected it: part-level `fulfills` filters the
   * *nested* blueprint's parts and has *"no sibling impact"*, so the sibling
   * `base` part of a 5-part corner stays a choice and 5 is the honest count.
   */
  readonly slots: number
  /**
   * The size control's positions, or **empty when there is nothing to choose**.
   *
   * Empty for the 40 recipes and for the 7 families whose table holds only
   * `any size` — see the module note for the two different causes of that 7, and
   * for why an empty control is not an unavailable one.
   */
  readonly sizes: readonly SizePosition[]
  /** The underlying record, for the resolver. */
  readonly template: RecipeTemplate
}

/**
 * The single-tile group order, and the labels.
 *
 * Ordered by corpus records rather than by family count or the alphabet; the
 * table in the module note carries both figures and the reason they differ.
 * Eight rather than nine since row D2 — the 40 assemblies are a section and not
 * a group, and {@link GroupKey} says why.
 */
export const GROUP_ORDER: readonly GroupKey[] = [
  'wall',
  'floor',
  'riser',
  'column',
  'stair',
  'roof',
  'decor',
  'base',
]

/**
 * What a group is called on screen.
 *
 * The seven role labels are B1's own words, capitalised the way
 * `pipeline/families.ts#LABELS` capitalises them, so the heading and the row
 * names cannot disagree.
 */
export const GROUP_LABEL: Readonly<Record<GroupKey, string>> = {
  wall: 'Wall',
  floor: 'Floor',
  riser: 'Riser',
  column: 'Column',
  stair: 'Stair',
  roof: 'Roof',
  decor: 'Decor',
  base: 'Base',
}

/**
 * The facet chips' labels, from `familyKey.ts`'s one table.
 *
 * Re-exported rather than declared, because the same 20 strings are what
 * `pipeline/families.ts` baked into the 47 generated names — two copies of them
 * in `src/` would be two copies too many, and the copy that exists is compared
 * to the generator's output by `palette.corpus.test.ts`.
 */
export { NO_BUILD, axisLabel } from './familyKey'

/**
 * Designs no family can name: the inserts.
 *
 * 94 of the 3,822, measured by mapping every design's own tags through
 * `familyKey.ts#armForTags`; all 94 are `role|insert` and they hold all 285
 * insert records. Stated as a number the panel can show, because "the palette lists
 * everything except these 94, and here is where they live instead" is the honest
 * form of a gap and "the palette lists everything" is not.
 */
export const INSERT_DESIGNS = 94

/**
 * The prefix all 40 shipped recipes share, taken off their row names.
 *
 * **The only stripper, and row D2 deliberately did not add a second one.** It
 * paid for itself while the heading above those 40 rows *was*
 * `S2W: Wall on Tile`; that heading is now `Assemblies`, and the strip is kept
 * because the words it removes are still not the row's own — every one of the 40
 * carries them, so they distinguish nothing and cost a third of a 272px column.
 * What did have to be replaced is the build system the heading used to carry:
 * `PalettePanel.tsx#rowFact` reads it off the template's own `build|` tag and
 * puts it on the row beside the slot count.
 */
const RECIPE_PREFIX = 'S2W: Wall on Tile: '

/**
 * The size table for an id, reduced to *what there is to choose*.
 *
 * One position is nothing to choose — see the module note on the 7 — and a
 * recipe has no entry in the table at all.
 */
function sizesFor(id: string): readonly SizePosition[] {
  const table = GENERATED_FAMILY_SIZES[id] ?? []
  return table.length > 1 ? table : []
}

function familyOf(template: RecipeTemplate, kind: FamilyKind): TemplateFamily {
  const role = axisOf(template.tags, 'role')
  const form = axisOf(template.tags, 'form')
  const build = axisOf(template.tags, 'build')
  const group: GroupKey | undefined =
    kind === 'recipe' ? undefined : role === undefined ? 'base' : (role as GroupKey)
  const prefix = group === undefined ? RECIPE_PREFIX : `${GROUP_LABEL[group]}: `
  return {
    // Parsed rather than cast: the pattern is the one thing about a generated id
    // this module can check, all 87 pass it today, and a generator that emitted
    // `Wall Straight` should fail here loudly rather than resolve to nothing on
    // the grid three rows later.
    id: TemplateId.parse(template.id),
    name: template.name,
    shortName: template.name.startsWith(prefix) ? template.name.slice(prefix.length) : template.name,
    kind,
    group,
    role,
    form,
    build,
    slots: template.parts.length,
    sizes: sizesFor(template.id),
    template,
  }
}

/** A row's place in {@link GROUP_ORDER}; the 40 groupless assemblies come last. */
const groupRank = (family: TemplateFamily): number =>
  family.group === undefined ? GROUP_ORDER.length : GROUP_ORDER.indexOf(family.group)

/**
 * All 87, in group order.
 *
 * A module constant because it is a pure function of two generated arrays: the
 * panel would otherwise rebuild it on every mount, and nothing about it can
 * change while the bundle is loaded.
 *
 * **This is a declared order and not the display order any more.** Row D2 shows
 * the 40 assemblies *above* the 47 single tiles, and does it in
 * `palette.ts#paletteSections` rather than by resorting this array — because
 * this array is also {@link PLACEABLE_TEMPLATES}, which two screens build a
 * `Map` from, and moving it would be moving a list for a reason that belongs to
 * one panel's layout. What the order still is, is the **tiebreak** the ranked
 * list falls back on: fixture order inside the assemblies and corpus order
 * inside each single-tile group.
 */
export const TEMPLATE_FAMILIES: readonly TemplateFamily[] = [
  ...GENERATED_FAMILIES.map((template) => familyOf(template, 'family')),
  ...RECIPE_TEMPLATES.map((template) => familyOf(template, 'recipe')),
].sort((a, b) => groupRank(a) - groupRank(b))

/**
 * Every placeable template, as the resolver's own type.
 *
 * **This is the list `BuilderScreen`'s recipe table must be built from**, and
 * until it is, every placement the palette arms resolves to nothing:
 * `assembly/resolve.ts#resolveInstance` answers an id its `templates` lookup does
 * not hold with one `unknown-template` note and no parts, and `billView.ts`
 * renders that as *"1 placed piece names a recipe this build does not ship"*.
 * The screen holds `new Map(RECIPE_TEMPLATES.map(…))` — the 40 — which is
 * correct for every id that existed before this row and wrong for all 47
 * families. `src/screens/builder/BuilderScreen.tsx` belongs to row C3; this
 * export is the one line it needs.
 */
export const PLACEABLE_TEMPLATES: readonly RecipeTemplate[] = TEMPLATE_FAMILIES.map(
  (family) => family.template,
)

const BY_ID = new Map(TEMPLATE_FAMILIES.map((family) => [family.id as string, family]))

/** One row by id, or `undefined` for an id this build does not ship. */
export function familyById(id: string): TemplateFamily | undefined {
  return BY_ID.get(id)
}

/**
 * The most specific position of `family`'s control that `tags` satisfies.
 *
 * **The reader's half of the handoff, and the palette's own size question.** A
 * `PendingArm` carries the *tile's* size tags rather than a position of this
 * family's control (`familyKey.ts` says why it cannot carry a position), so the
 * side that holds the domain picks from it — and picks the tightest one, so a 2x2
 * floor lands on *"2 wide by 2 deep"* and not on *"2 wide"* when both are true
 * of it.
 *
 * It is a **narrowing and never an invention**: a position whose tags the arm
 * does not carry cannot be chosen. `[]` — `any size` — is what is left when none
 * is, which covers the 7 families with no control, the 522 designs whose cell no
 * position expresses, all 40 recipes, and the one reachable failure of a
 * handoff: a catalog re-import between the press and the claim retiring the cell
 * a tile was measured at.
 *
 * The same function answers both questions this row asks about a size, which is
 * why there is one: *"which position do these tile tags name"* (the handoff) and
 * *"which chip is pressed"* (the panel) differ only in where the tags came from.
 */
export function positionOf(family: TemplateFamily, tags: readonly string[]): readonly string[] {
  let best: readonly string[] = []
  for (const position of family.sizes) {
    if (position.tags.length <= best.length) continue
    if (position.tags.every((tag) => tags.includes(tag))) best = position.tags
  }
  return best
}

/**
 * The label for a chosen position, for a readout that is not the control itself.
 *
 * `any size` when nothing is chosen, which is what the slot then admits.
 */
export function sizeLabelOf(family: TemplateFamily, tags: readonly string[]): string {
  if (tags.length === 0) return ANY_SIZE_LABEL
  const found = family.sizes.find(
    (position) =>
      position.tags.length === tags.length && position.tags.every((tag) => tags.includes(tag)),
  )
  return found?.label ?? ANY_SIZE_LABEL
}

/** The first position of every emitted table, and the panel's default. */
export const ANY_SIZE_LABEL = 'any size'

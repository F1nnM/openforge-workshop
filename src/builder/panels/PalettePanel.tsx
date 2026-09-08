/**
 * The builder's left column — design-contract.md §2.4's palette: **the 87
 * templates this build can place**, as two sections — 40 assemblies, then 47
 * single tiles grouped by role — with a slot count on every row, form and build
 * as facets and size as a control on the armed single tile.
 *
 * ## Row D2, and the report that caused it
 *
 * Row C1 listed all 87 as one list in nine groups, because all 87 place through
 * one function. The project owner placed a `Corner (Wall on Tile)` from it and
 * reported:
 *
 * > *"It shows everywhere as having one slot only. In the menu I can select a few
 * > corner variations, for this one slot, which are already corner combinations
 * > of walls. I can't individually modify the walls. I also can't select a floor.
 * > I need to be able to do that though. Thats the whole point of the templates I
 * > wanted."*
 *
 * They had found a one-slot generated family — row 12. The assembly they were
 * describing ships — `S2W: Wall on Tile: Corner (Any, Single Piece)`, with
 * `column`, `right wall`, `left wall`, `floor` and `base` — as **row 50 of 87**,
 * under a heading that named a build system rather than a kind, with all
 * fourteen one-slot rows whose names also say *corner* above it. **Nothing
 * underneath was broken: the palette had 87 rows of two different kinds and did
 * not distinguish them.**
 *
 * What this row changes is three things and no engine: the list is two sections
 * with the assemblies first (`palette.ts#paletteSections`), a query ranks each
 * section so `corner` puts `Corner (Any, Single Piece)` first of 22
 * (`palette.ts#rankFamilies`), and every row states its slot count — 5 or 3 on
 * an assembly, 1 on a single tile — from `template.parts.length` and nothing
 * derived from it.
 *
 * ## What it was, twice, and why neither survived
 *
 * §2.4 wrote this column as "the library as a selectable list", with a search
 * above it offering "+ add" rows for items not saved yet. Row **A0** deleted the
 * library and the two blocks collapsed into the one that never needed it: the
 * archive itself, listed by the same engine and the same ranking, armed
 * directly. Row **A8** then had to make that list arm **nothing at all** and say
 * so on screen, because the work surface places a `TemplateId` and the list held
 * `DesignId`s — two id spaces `store/schema.ts` measures as *not* lexically
 * disjoint, so passing one for the other compiles and would report every
 * placement `unknown-template`.
 *
 * **This row makes it place templates.** The list is the 47 generated families
 * plus the 40 shipped recipes, `arm()` writes `tools.setSelectedTemplate`, and
 * A8's disclaimer is gone with the list it was about. `palette.ts` carries the
 * argument for the shape of the list and `families.ts` for the rows themselves;
 * this file is the control.
 *
 * ## 87 rows, two sections, eight groups, and the cost that inverts
 *
 * The UX research measured the honest cost of a tag-predicated palette: from
 * roughly 20 recognisable library rows to **3,862** entries, which is
 * recognition becoming recall. Role-predicated families make it **47** — walls
 * (17 families over 5,381 records), floors (15 / 2,162), risers, columns,
 * stairs, roofs, decor and the one bare-base family — under the second of two
 * section headings, above which the 40 authored assemblies are a flat list.
 * **RECENT mitigates what is left of that cost and does not fix it**;
 * `palette.ts` says so where the ring is implemented, because that is the claim
 * most likely to be quietly inflated later.
 *
 * **The single tiles are second and not lesser.** B4 measured them reaching
 * 96.7% of records and — row D1's correction — 97.5% of designs, against the
 * assemblies' 35.4%, and every curve, riser, stair and roof is reachable only
 * through one of them, so both sections render in full, in one scroll, with
 * their own counts.
 *
 * There is no `insert` group and the panel says where inserts went instead: 285
 * records, **262 of them already reachable through a tile's own accessory
 * slots**, so a door is a fill and not a family.
 *
 * ## Size is one control on the armed row, not a row per size
 *
 * B3's measurement is the whole reason: keyed on `(role, form, build)` the
 * corpus needs 47 families; with size in the key it needs 217 to 277. So a
 * position is a parameter — a set of tags that joins the instance's `parentTags`
 * where the slot's own `constrain` block collects them — and the control belongs
 * to the *armed* family rather than to all 87 at once, which would be 304
 * positions on a 272px column.
 *
 * `any size` is the default and a real position: with nothing chosen the
 * `constrain` collects nothing and the family admits every size. **7 families get
 * no control at all** — 5 with no size domain and 2 whose domain no `size|` tag
 * can express (`families.ts` enumerates both) — because a control with one
 * position cannot be operated.
 *
 * ## What a row says: a name, a slot count, and one second fact
 *
 * Every row carries its name and its **slot count**, which is the fact the
 * owner's report was about and the reason it is on all 87 rather than on the 40
 * that surprised them. Beside it sits one more fact, and which one depends on
 * what the row *has*:
 *
 *   - a **single tile** shows {@link candidateCount}'s number — how many archive
 *     tiles its one slot admits at the chosen size, resolved through
 *     `@/composition`'s own `resolveSlotTags` so it is the set a fill will be
 *     chosen from rather than a second opinion about it;
 *   - an **assembly** shows its **build system**, from the template's own
 *     `build|` tag. It has no single candidate count — 3 or 5 slots have no one
 *     answer — and it needs to say `S2W` somewhere, because the group heading
 *     that used to say it is now the section heading `Assemblies`. On the row
 *     rather than on the heading, so it stays right when a second build system's
 *     assemblies arrive.
 *
 * **No thumbnail.** A family has no picture, and picking a representative would
 * reintroduce the defect rows V3 and V5 spent two revisions removing — a palette
 * row showing one file while the placement contains another. `palette.ts` has
 * the argument.
 *
 * ## The handoff from "Use in builder"
 *
 * Row G5's channel, re-aimed by this row: the catalog drawer posts a
 * {@link PendingArm} — a family and a size position, derived from the tile's own
 * tags by `familyKey.ts#armForTags` — and this panel **claims** it once, on
 * mount, and arms it. It is here rather than in the builder screen because this
 * panel is already the one component that writes the selection; a second writer
 * would be two palettes.
 *
 * The claim is guarded, and the guard is narrower than A0's was: a family is
 * refused only when **this build ships no such template**, which is the one
 * reachable failure (a share link or a stale tab against a re-imported catalog).
 * A0's second case — the item's footprint — is gone from here, because a
 * footprint is a property of a *fill* and a family has none; the plan view still
 * refuses the 370 unplaceable items visibly, one level down, where the file is
 * chosen.
 *
 * Claiming also **clears the facets**, so the armed row is on screen rather than
 * hidden behind a filter the user set ten minutes ago on another screen.
 *
 * ## Where the search comes from
 *
 * The whole `FacetSearch` from `/builder`, not just the text — `routeTree.tsx`
 * gives the builder route the facet schema precisely so this box is linkable.
 * **What it searches has changed**: `q` now narrows the 87 rows by name and axis
 * (`palette.ts#queryTokens`), not 3,822 items, so `?kinds=wall` is carried by the
 * route and no longer read here — there is nothing in a family for a catalog
 * facet to narrow.
 *
 * The input holds a **draft** and commits it after {@link COMMIT_DELAY_MS}, with
 * `committed` as the discriminator that tells this field's own echo from a real
 * external change (Back, a shared link). `../../screens/catalog/SearchField.tsx`
 * explains at length why the naive `useEffect(() => setDraft(q), [q])` silently
 * rewinds a fast typist mid-word. That component is not exported from the catalog
 * screen and its markup is a full-width 520px field with a result count beside
 * it, which is not this 272px column; the debounce logic is what is shared, and
 * it is thirty lines.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { PlanTools, PositionAxis } from '@/builder/canvas'
import type { FacetSearch } from '@/search'
import { MAX_QUERY_LENGTH } from '@/search'
import type { CatalogIndex } from '@/screens/catalog'
import { countLabel } from '@/screens/catalog'
import type { PendingArm } from '@/store'
import { claimPendingArm, usePendingArm } from '@/store'
import { Chip, Eyebrow } from '@/ui/primitives'

import type { SizePosition, TemplateFamily } from './families'
import {
  ANY_SIZE_LABEL,
  INSERT_DESIGNS,
  NO_BUILD,
  TEMPLATE_FAMILIES,
  axisLabel,
  familyById,
  positionOf,
  sizeLabelOf,
} from './families'
import type { CandidateCounter, PaletteFacets, PaletteSection } from './palette'
import {
  ALL_FACETS,
  createCounter,
  paletteSections,
  reachableFacets,
  recentArms,
  rememberArm,
} from './palette'

import './panels.css'

/** How long a keystroke waits before it reaches the URL. See `SearchField.tsx`. */
export const COMMIT_DELAY_MS = 180

export interface PalettePanelProps {
  readonly index: CatalogIndex
  /**
   * Shared with the toolbar and the surface.
   *
   * **The selection is back in here, as row A8 said it would be.**
   * `tools.selectedTemplate` is the armed family and this panel is its only
   * writer; the panel keeps no copy of it, so there is nothing for the two to
   * disagree about. **Row C5 put the size position in the same object** —
   * `tools.armedSize` — for the identical reason, and this panel is its only
   * writer too.
   */
  readonly tools: PlanTools
  /** `/builder`'s validated search. Only `q` is read. */
  readonly search: FacetSearch
  readonly onQueryChange: (text: string) => void
}

export function PalettePanel({ index, tools, search, onQueryChange }: PalettePanelProps) {
  /**
   * The candidate counter, over the index this panel holds.
   *
   * `createCounter` reaches `compositionIndexFor`, whose `WeakMap` is keyed on
   * the parsed file — so this is the same 409,432-byte inverted index the bill
   * and C3's slot editor use, not a second one. The memo is per index and the
   * cache inside it is per row and size.
   */
  const count = useMemo<CandidateCounter>(
    () => createCounter(index.file, index.engine.aggregates),
    [index],
  )

  const [facets, setFacets] = useState<PaletteFacets>(ALL_FACETS)
  /**
   * The armed family's size position, as the position's own tags.
   *
   * **`PlanTools` since row C5, and that is this row's whole handoff.** It was
   * panel state, because `usePlanTools` held `selectedTemplate` and nothing
   * beside it, and C1 wrote the consequence down rather than hiding it: what
   * reached a placement was the family alone (`three/edits.ts` placed with
   * `fills: {}`), so the position narrowed the count on screen and nothing else.
   * C5 solves the fills on the click and hands the position to
   * `FillContext.position`, so *2 wide by 2 deep* now decides what lands. The
   * state lives one level up, where the surface can see it.
   *
   * **Three axes since the recipe fold**, and the hook keeps them apart so that
   * choosing a component does not clear a size. `position` here is all of them
   * joined, which is what a control compares against to know whether it is the
   * chosen chip.
   */
  const position = tools.armedPosition
  const setAxis = tools.setArmedPosition
  /** The RECENT ring, snapshotted — `palette.ts` owns the ring itself. */
  const [recent, setRecent] = useState<readonly RecentEntry[]>(() => recentArms())

  const armed = tools.selectedTemplate

  const arm = useCallback(
    (family: TemplateFamily, position: readonly string[] = []) => {
      tools.setSelectedTemplate(family.id)
      /* `setSelectedTemplate` has just cleared every axis, so this writes the
         one the caller asked for onto a clean position rather than merging into
         whatever the previous row was armed at. */
      if (position.length > 0) setAxis('size', position)
      rememberArm({ template: family.id, size: position })
      setRecent(recentArms())
      // §3: selecting forces place mode. Arming a family while the eraser is up
      // otherwise looks like the palette ignored the click.
      tools.setTool('place')
    },
    [tools],
  )

  const disarm = useCallback(() => {
    // `setSelectedTemplate(null)` clears every axis on its own.
    tools.setSelectedTemplate(null)
  }, [tools])

  /**
   * Choose a size for the armed family.
   *
   * It goes into the ring as well as into the state, because the ring holds
   * *arms*: a user who sizes a family after arming it has made the choice the
   * strip exists to offer back, and a chip that came back at `any size` would
   * drop the only part of it they made twice.
   */
  const chooseAxis = useCallback(
    (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => {
      setAxis(axis, tags)
      /* Only a size goes into the ring. The ring re-arms a row *at a size* — four
         2x2 floors and then a fifth — and `PendingArm` carries one position, so a
         chip that also restored a component would need a shape the store does not
         have. Choosing a component still arms; it just does not re-write the
         chip. */
      if (axis === 'size') {
        rememberArm({ template: family.id, size: tags })
        setRecent(recentArms())
      }
    },
    [setAxis],
  )

  // Row G5's one call site. Claiming is read-and-clear, so this is a one-shot
  // handoff and not a piece of state two screens have to keep in step: a second
  // run — a re-mount, or React's development double-invoke — claims `null` and
  // does nothing, and a family the user has since disarmed is not re-armed
  // behind their back. See the module note for the guard.
  const pending = usePendingArm()
  useEffect(() => {
    if (pending === null) return
    const claimed: PendingArm | null = claimPendingArm()
    if (claimed === null) return
    const family = familyById(claimed.template)
    if (family === undefined) return
    setFacets(ALL_FACETS)
    arm(family, positionOf(family, claimed.size))
  }, [pending, arm])

  const sections = useMemo(
    () => paletteSections(TEMPLATE_FAMILIES, search.q, facets),
    [search.q, facets],
  )
  /** Every row on screen, both sections — the search readout and RECENT's filter. */
  const rows = useMemo(() => sections.flatMap((section) => section.rows), [sections])
  const reachable = useMemo(
    () => reachableFacets(TEMPLATE_FAMILIES, search.q, facets),
    [search.q, facets],
  )
  /** The strip only offers what the query and the facets have left. */
  const recentRows = useMemo(
    () => recent.filter((entry) => rows.includes(entry.family)),
    [recent, rows],
  )

  return (
    <aside className="of-palette" aria-label="Palette">
      <PaletteSearch
        query={search.q}
        shown={rows.length}
        total={TEMPLATE_FAMILIES.length}
        onQueryChange={onQueryChange}
      />

      <FacetBar facets={facets} reachable={reachable} onChange={setFacets} />

      {/* One region around both sections, and it keeps its own name rather than
          borrowing a heading: the two `<h2>`s below belong to the sections, and
          `screens/builder/builder.test.tsx` reads *"which templates does `?q=`
          leave"* off this landmark, which is a question about the whole list and
          not about either section. It carries no count — the search field's
          readout already says `22 of 87 templates` for exactly the same set. */}
      <section className="of-pal-block" aria-label="Templates">
        {rows.length === 0 ? (
          <p className="of-pal-note">
            No template matches. The {countLabel(TEMPLATE_FAMILIES.length)} rows are assemblies and
            single tiles, not tiles from the archive — search the catalog screen for a texture or a
            tile name, then use its &ldquo;Use in builder&rdquo;.
          </p>
        ) : null}

        {/* Above **both** sections, because the ring mixes both kinds: a strip of
            the last six things armed is a fact about the session and not about
            either list. `palette.ts#MAX_RECENT` carries the rest. */}
        {recentRows.length > 0 ? (
          <RecentStrip rows={recentRows} armed={armed} size={position} arm={arm} />
        ) : null}

        {sections.map((section) => (
          <PaletteSectionBlock
            key={section.key}
            section={section}
            armed={armed}
            position={position}
            count={count}
            arm={arm}
            disarm={disarm}
            onAxis={chooseAxis}
          />
        ))}

        {/*
          The one population no family can name, named. `role|insert` is a
          perfect bijection with `layer === 'insert'` — the same 285 records —
          and 262 of them are already reachable as a fill for a host tile's own
          accessory slot, so listing 94 designs here that the grid cannot hold
          would be worse than a sentence saying where they live.
        */}
        <p className="of-pal-note">
          Doors, windows and other inserts are not templates: {countLabel(INSERT_DESIGNS)} designs
          fit into a tile&rsquo;s own accessory slots instead, on the tile&rsquo;s page.
        </p>
      </section>
    </aside>
  )
}

/* ----------------------------------------------------------------- sections */

/**
 * What a section says about itself, under its heading.
 *
 * One sentence each, and between them they answer the owner's report in the
 * panel rather than only in a docblock: an assembly is *several tiles you fill
 * one by one*, a single tile is *one*. C1 had one sentence over the whole list
 * — *"a placed family arrives with its slot empty"* — which was true of both
 * kinds and therefore said nothing about the difference between them.
 */
const SECTION_NOTE: Readonly<Record<PaletteSection['key'], string>> = {
  assemblies:
    'Several tiles in one placement — a corner brings its own walls, floor and base. Each slot is a choice you make on the placed piece.',
  tiles:
    'One tile, one slot. The number is how many archive tiles could fill it at the chosen size.',
}

/**
 * One section: its heading and count, its sentence, and its rows.
 *
 * The **assemblies have no sub-groups** and the single tiles have eight, which
 * is the asymmetry the data has: a role is what makes 47 one-slot rows findable
 * (§3.1's 3,862-to-47 measurement), and the 40 assemblies are already one flat
 * list short enough to read — their sub-structure would have been the build
 * system, and today all 40 share one, so it is on the rows instead
 * ({@link rowFact}).
 */
function PaletteSectionBlock({
  section,
  armed,
  position,
  count,
  arm,
  disarm,
  onAxis,
}: {
  readonly section: PaletteSection
  readonly armed: PlanTools['selectedTemplate']
  readonly position: readonly string[]
  readonly count: CandidateCounter
  readonly arm: (family: TemplateFamily, position?: readonly string[]) => void
  readonly disarm: () => void
  readonly onAxis: (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => void
}) {
  const headingId = useId()
  const rowProps = { armed, position, count, arm, disarm, onAxis }
  return (
    <section className="of-pal-section" aria-labelledby={headingId}>
      <h2 className="of-pal-heading" id={headingId}>
        <Eyebrow>{section.label}</Eyebrow>{' '}
        <Chip tone="count">{countLabel(section.rows.length)}</Chip>
      </h2>
      <p className="of-pal-note">{SECTION_NOTE[section.key]}</p>
      {section.groups.length === 0 ? (
        <PaletteList rows={section.rows} {...rowProps} />
      ) : (
        section.groups.map((group) => (
          <PaletteGroupBlock key={group.key} label={group.label} rows={group.rows} {...rowProps} />
        ))
      )}
    </section>
  )
}

/* --------------------------------------------------------------------- rows */

/** What every row renderer needs from the panel. */
interface RowProps {
  readonly armed: PlanTools['selectedTemplate']
  /** Every axis's tags, joined — see `usePlanTools#armedPosition`. */
  readonly position: readonly string[]
  readonly count: CandidateCounter
  readonly arm: (family: TemplateFamily, position?: readonly string[]) => void
  readonly disarm: () => void
  readonly onAxis: (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => void
}

/** One role group of the single-tile section: a sub-heading over a {@link PaletteList}. */
function PaletteGroupBlock({
  label,
  rows,
  ...rowProps
}: RowProps & { readonly label: string; readonly rows: readonly TemplateFamily[] }) {
  const headingId = useId()
  return (
    <section className="of-pal-group" aria-labelledby={headingId}>
      <h3 className="of-pal-heading of-pal-subheading" id={headingId}>
        <Eyebrow>{label}</Eyebrow> <Chip tone="count">{countLabel(rows.length)}</Chip>
      </h3>
      <PaletteList rows={rows} {...rowProps} />
    </section>
  )
}

/**
 * The rows themselves, with the size control under the armed one.
 *
 * The size control lives **inside the armed row's `<li>`** rather than in a
 * panel of its own, for the reason the row itself is the control's subject: a
 * separate block would have to name which family it belonged to, and a 272px
 * column has no room to say "Size — Wall: Corner (S2W)" over a set of chips.
 *
 * Heading-free, because its two callers put different headings above it — an
 * `<h2>` section for the 40 assemblies, an `<h3>` role group for each slice of
 * the 47 single tiles.
 */
function PaletteList({
  rows,
  armed,
  position,
  count,
  arm,
  disarm,
  onAxis,
}: RowProps & { readonly rows: readonly TemplateFamily[] }) {
  return (
    <ul className="of-pal-list" role="list">
      {rows.map((family) => {
        const selected = armed === family.id
        // The count follows the armed position, because that is the set a fill
        // will be chosen from. An unarmed row counts what it admits at `any
        // size`, which is what it will arm at.
        const fact = rowFact(family, count(family, selected ? position : []))
        const slots = slotLabel(family.slots)
        return (
          <li key={family.id} className="of-pal-row" data-selected={selected ? '' : undefined}>
            <button
              type="button"
              className="of-pal-pick"
              aria-pressed={selected}
              /* The **full** name and the nouns, because the visible row drops
                 both: the heading carries the role and the column has no width
                 for `tiles`. Two families are called `Straight` — one under
                 Wall and one under Floor — so without this a screen reader
                 hears the same row name twice and a test cannot tell them
                 apart either. */
              aria-label={`${family.name}, ${slots}, ${fact.spoken}`}
              onClick={() => {
                // Re-selecting the armed row disarms it, which is what
                // `aria-pressed` promises.
                if (selected) disarm()
                else arm(family)
              }}
            >
              <span className="of-pal-name">{family.shortName}</span>
              <span className="of-pal-detail" aria-hidden="true">
                <span className="of-pal-slots">{slots}</span>
                <span className="of-pal-fact">{fact.visible}</span>
              </span>
            </button>
            {selected ? (
              <RowControls family={family} position={position} count={count} onAxis={onAxis} />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The slot count, on **every** row.
 *
 * The owner's report is one sentence long and this is the word in it: *"It shows
 * everywhere as having one slot only."* They were right about the row they had
 * and wrong about the palette, and neither the row nor the palette said which.
 * `family.slots` is `template.parts.length` — `families.ts` argues why it must be
 * that and not a count of the slots that still need a choice.
 */
function slotLabel(slots: number): string {
  return `${countLabel(slots)} ${slots === 1 ? 'slot' : 'slots'}`
}

/**
 * The row's second fact — the one that differs by kind.
 *
 * A **single tile** shows how many archive tiles its slot admits. An **assembly**
 * shows its build system, because it has no single candidate count (3 or 5 slots
 * have no one answer) and because the group heading that used to carry `S2W` is
 * now the section heading `Assemblies`. Read off `family.build`, the template's
 * own `build|` tag, so this is a per-row fact that stays correct when a second
 * build system's assemblies land rather than a heading that would have to be
 * rewritten.
 *
 * `visible` is abbreviated to the width of the column and `spoken` carries the
 * noun: *"tiles"* rather than *"items"* is the whole app's word for a design, and
 * `screens/catalog`'s field says the same word over the same figures.
 */
function rowFact(
  family: TemplateFamily,
  candidates: number | undefined,
): { readonly visible: string; readonly spoken: string } {
  if (family.kind !== 'recipe') {
    const tiles = countLabel(candidates ?? 0)
    return { visible: tiles, spoken: `${tiles} tiles` }
  }
  // Unreachable over the 40 shipped assemblies, which all carry `build|s2w`; an
  // assembly emitted without one says `assembly` rather than an empty cell.
  const build = family.build === undefined ? undefined : axisLabel(family.build)
  return build === undefined
    ? { visible: 'assembly', spoken: 'assembly' }
    : { visible: build, spoken: `${build} build system` }
}

/**
 * The armed row's controls: **size, and since the recipe fold component and
 * height as well.**
 *
 * A `role="group"` of `aria-pressed` buttons per axis and not a `<select>`: B3
 * measured the size domain at a **median of 4 cells and a maximum of 31** — a
 * control, not a dropdown — and every size position carries its own candidate
 * count, which a `<select>` has nowhere to put. Wrapped rather than scrolled,
 * because the longest domain is 32 positions and a horizontal scroller in a
 * 272px column hides most of them behind a gesture.
 *
 * ## What the fold changed here, and what it did not
 *
 * Row D2 wrote that no assembly has a size control, and gave the reason: an
 * assembly's parts *"`require` their sizes outright … so a size is part of which
 * assembly this is"*, and a control would be *"a chip that changed nothing."*
 * **True of the 8 corners and false of the 32 wall recipes.** The corners really
 * do require `size|width|2` and `size|depth|2` on their slots, so their whole
 * domain is that one 2x2 and they still get no control. The wall recipes carried
 * `constrain: [size|width, size|depth]` and no size of their own — so `constrain`
 * collected nothing and the assembly's size was whatever the user happened to
 * click. Those two now have a domain of pairs that each pin one footprint.
 *
 * The **component** axis is what the fold bought in exchange for 30 rows: 14
 * component variants that used to be 14 templates are 14 positions on one. The
 * **height** axis is `shape|wall` against `shape|wall|low`, which are disjoint in
 * the corpus — so it also reaches the 527 low walls that `Wall (Any)`'s
 * `shape|wall` require could not see at all.
 *
 * Renders **nothing for an axis with nothing to choose**: a one-position axis is
 * a control that cannot be operated. The 7 families with no expressible size get
 * a sentence instead, because a row that simply omits the control its sixteen
 * neighbours have reads as a bug; an axis no *assembly* has needs no sentence,
 * since there is no neighbour to compare against.
 */
function RowControls({
  family,
  position,
  count,
  onAxis,
}: {
  readonly family: TemplateFamily
  readonly position: readonly string[]
  readonly count: CandidateCounter
  readonly onAxis: (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => void
}) {
  return (
    <>
      <AxisControl
        family={family}
        axis="component"
        label="Component"
        entries={family.controls?.component ?? []}
        position={position}
        onAxis={onAxis}
      />
      <AxisControl
        family={family}
        axis="height"
        label="Height"
        entries={family.controls?.height ?? []}
        position={position}
        onAxis={onAxis}
      />
      <SizeControl family={family} size={position} count={count} onAxis={onAxis} />
    </>
  )
}

/**
 * One non-size axis, as labelled chips.
 *
 * No candidate count, and that is the difference from the size control rather
 * than an omission. `candidateCount` answers *"how many tiles does this row's one
 * slot admit"* and every row with a component axis is a **3-slot** assembly, so
 * there is no one number — the same reason an assembly shows its build system
 * where a single tile shows a count.
 */
function AxisControl({
  family,
  axis,
  label,
  entries,
  position,
  onAxis,
}: {
  readonly family: TemplateFamily
  readonly axis: PositionAxis
  readonly label: string
  readonly entries: readonly SizePosition[]
  readonly position: readonly string[]
  readonly onAxis: (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => void
}) {
  // One position is nothing to choose, and none is nothing to show.
  if (entries.length < 2) return null
  return (
    <div className="of-pal-sizes" role="group" aria-label={`${label} for ${family.name}`}>
      {entries.map((entry) => {
        /* An `any` position carries no tags, so it is chosen exactly when no tag
           of this axis is armed — which is what makes it a real position rather
           than the absence of one. */
        const chosen =
          entry.tags.length === 0
            ? !entries.some((other) => other.tags.length > 0 && other.tags.every((tag) => position.includes(tag)))
            : entry.tags.every((tag) => position.includes(tag))
        return (
          <button
            key={entry.label}
            type="button"
            className="of-pal-sizebtn"
            aria-pressed={chosen}
            aria-label={`${label}: ${entry.label}`}
            onClick={() => {
              onAxis(family, axis, entry.tags)
            }}
          >
            {entry.label}
          </button>
        )
      })}
    </div>
  )
}

/** The size axis, which is the only one carrying a candidate count per position. */
function SizeControl({
  family,
  size,
  count,
  onAxis,
}: {
  readonly family: TemplateFamily
  readonly size: readonly string[]
  readonly count: CandidateCounter
  readonly onAxis: (family: TemplateFamily, axis: PositionAxis, tags: readonly string[]) => void
}) {
  if (family.sizes.length === 0) {
    if (family.kind === 'recipe') return null
    return (
      <p className="of-pal-note of-pal-nosize">
        The archive tags no size for this family — it places at any size.
      </p>
    )
  }
  return (
    <div className="of-pal-sizes" role="group" aria-label={`Size for ${family.name}`}>
      {family.sizes.map((entry: SizePosition) => {
        const chosen = entry.tags.length === size.length && entry.tags.every((tag) => size.includes(tag))
        const candidates = count(family, entry.tags) ?? 0
        return (
          <button
            key={entry.label}
            type="button"
            className="of-pal-sizebtn"
            aria-pressed={chosen}
            /* The authored label in full plus the count: the visible text is
               abbreviated to fit, and a number with no noun beside it says
               nothing on its own. */
            aria-label={`${entry.label}, ${countLabel(candidates)} tiles`}
            onClick={() => {
              onAxis(family, 'size', entry.tags)
            }}
          >
            {sizeChipLabel(entry.label)}
            <span className="of-pal-sizecount">{countLabel(candidates)}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A position's label, abbreviated to the width of a chip.
 *
 * *"2 wide by 2 deep"* is authored for a sentence and is 16 characters in a
 * column that fits about 12; `2 x 2` is the same claim. **Lossless, and the
 * distinction it must not lose is B4's own**: 251 positions are a *cell* (a
 * width and a depth) and 48 are a *run* (a width, because the corpus does not
 * tag a wall's depth), so *"2 wide"* stays *"2 wide"* rather than becoming
 * `2 x ?`. `any size` is unchanged. The full label is on the button's
 * `aria-label`.
 *
 * **The run figure was 48 and is measured at 47**, and 24 of those 47 now say
 * *"N wide, any depth"* because they admit records at two to seven depths and sat
 * in the same control as the `(w, d)` position they contain.
 * `pipeline/families.test.ts` carries the biconditional.
 */
function sizeChipLabel(label: string): string {
  if (label === ANY_SIZE_LABEL) return label
  const pair = /^(.+) wide by (.+) deep$/.exec(label)
  if (pair !== null) return `${pair[1]!} \u00d7 ${pair[2]!}`
  /* *"2 wide, any depth"* \u2014 a run position that admits records at more than one
     depth, and 24 of the 47 do. `2 \u00d7 any` keeps the distinction the abbreviation
     above must not lose, in the same width as `2 \u00d7 2` and beside it: the chip has
     to say that this position is the *wider* of the two, which plain `2 wide`
     read as the narrower. */
  const anyDepth = /^(.+) wide, any depth$/.exec(label)
  return anyDepth === null ? label : `${anyDepth[1]!} \u00d7 any`
}

/** What the RECENT strip holds: a family and the size it was armed at. */
type RecentEntry = { readonly family: TemplateFamily; readonly size: readonly string[] }

/**
 * RECENT, as a strip of chips above **both** sections.
 *
 * **A strip and not a third section**, because all 87 rows are always listed: a
 * section would put a second row on screen for the same family, and since the
 * size control lives inside the armed row it would put a second live copy of that
 * control there too. `palette.ts#MAX_RECENT` carries the argument and the
 * research's own caveat — this mitigates the recognition cost of 87 rows and
 * does not fix it, which is why it is six chips and not a curated list.
 *
 * **Above both sections rather than inside one**, because the ring mixes the two
 * kinds: the last six things armed can be four assemblies and two single tiles,
 * and filing that under either heading would make it a claim about one list when
 * it is a fact about the session.
 *
 * A chip carries the size as well as the family, because re-placing something is
 * usually re-placing it *at the same size*: four 2x2 floors and then a fifth.
 */
function RecentStrip({
  rows,
  armed,
  size,
  arm,
}: {
  readonly rows: readonly RecentEntry[]
  readonly armed: PlanTools['selectedTemplate']
  readonly size: readonly string[]
  readonly arm: (family: TemplateFamily, position?: readonly string[]) => void
}) {
  return (
    <div className="of-pal-facet" role="group" aria-label="Recent">
      <Eyebrow as="span">Recent</Eyebrow>
      {rows.map((entry) => {
        const pressed =
          armed === entry.family.id &&
          entry.size.length === size.length &&
          entry.size.every((tag) => size.includes(tag))
        return (
          <button
            key={`${entry.family.id} ${entry.size.join(' ')}`}
            type="button"
            className="of-pal-chip"
            aria-pressed={pressed}
            aria-label={`${entry.family.name}, ${sizeLabelOf(entry.family, entry.size)}`}
            onClick={() => {
              arm(entry.family, entry.size)
            }}
          >
            {entry.family.shortName}
            {entry.size.length > 0 ? ` ${sizeChipLabel(sizeLabelOf(entry.family, entry.size))}` : ''}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------- facets */

/**
 * §3.1's two facets: form and build.
 *
 * Single-select per axis and re-press to clear — `palette.ts#filterFamilies`
 * carries the argument — and only the values that leave at least one row are
 * offered, so no chip is a dead end. The axis is not shown at all when one value
 * is all there is: with `?q=octagon` narrowing to two rows, a "form" row holding
 * only "Octagon" is a control with nothing to choose.
 *
 * **The two axes reach different numbers of sections, and the labels say which.**
 * `build` is a tag every one of the 87 templates carries at most one of, so its
 * chips narrow both sections and its label is the bare axis name. `form` is a tag
 * only the 47 single tiles carry — an assembly's form lives in up to five
 * separate `require` blocks, one per part — so it narrows that section alone and
 * is labelled **Tile form** to say so. `palette.ts#filterFamilies` carries the
 * measurement and what C1's rule did instead: it hid all 40 assemblies, which
 * meant pressing `Corner` emptied the section holding the assembly the owner was
 * looking for.
 */
function FacetBar({
  facets,
  reachable,
  onChange,
}: {
  readonly facets: PaletteFacets
  readonly reachable: { readonly forms: readonly string[]; readonly builds: readonly string[] }
  readonly onChange: (facets: PaletteFacets) => void
}) {
  return (
    <div className="of-pal-facets">
      <FacetRow
        label="Tile form"
        values={reachable.forms}
        labelOf={axisLabel}
        chosen={facets.form}
        onPick={(value) => {
          onChange({ ...facets, form: value })
        }}
      />
      <FacetRow
        label="Build"
        values={reachable.builds}
        labelOf={(value) => (value === NO_BUILD ? 'No system' : axisLabel(value))}
        chosen={facets.build}
        onPick={(value) => {
          onChange({ ...facets, build: value })
        }}
      />
    </div>
  )
}

function FacetRow({
  label,
  values,
  labelOf,
  chosen,
  onPick,
}: {
  readonly label: string
  readonly values: readonly string[]
  readonly labelOf: (value: string) => string
  readonly chosen: string | undefined
  readonly onPick: (value: string | undefined) => void
}) {
  if (values.length < 2) return null
  return (
    <div className="of-pal-facet" role="group" aria-label={label}>
      <Eyebrow as="span">{label}</Eyebrow>
      {values.map((value) => {
        const pressed = chosen === value
        return (
          <button
            key={value}
            type="button"
            className="of-pal-chip"
            aria-pressed={pressed}
            onClick={() => {
              onPick(pressed ? undefined : value)
            }}
          >
            {labelOf(value)}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------- search */

function PaletteSearch({
  query,
  shown,
  total,
  onQueryChange,
}: {
  readonly query: string
  readonly shown: number
  readonly total: number
  readonly onQueryChange: (text: string) => void
}) {
  const inputId = useId()
  const [draft, setDraft] = useState(query)
  const committed = useRef(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query === committed.current) return
    // The URL moved on its own — Back, or a shared link. Drop any pending commit
    // or it would immediately undo the navigation that just happened.
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    committed.current = query
    setDraft(query)
  }, [query])

  // Only on unmount: a timer left running would navigate after the screen is
  // gone, which TanStack turns into a navigation to a route nothing is rendering.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <div className="of-pal-search">
      <label className="of-sr-only" htmlFor={inputId}>
        Search the template families
      </label>
      <input
        id={inputId}
        className="of-search-input of-pal-input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        placeholder={`Search ${countLabel(total)} templates…`}
        value={draft}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            timer.current = null
            committed.current = text
            onQueryChange(text)
          }, COMMIT_DELAY_MS)
        }}
      />
      {/* Polite, and only while a query is live: the number changes on every
          keystroke, and an assertive region would interrupt the typing that
          caused it. */}
      <p className="of-pal-count" role="status">
        {query.trim() === '' ? '' : `${countLabel(shown)} of ${countLabel(total)} templates`}
      </p>
    </div>
  )
}

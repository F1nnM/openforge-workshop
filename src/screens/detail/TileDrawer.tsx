/**
 * The tile inspector — design-contract.md §2.5, over aggregates.
 *
 * A 442px right-hand drawer over the scrim, opened by `?tile={ordinal}` on
 * `/catalog` and containing, in the mock's order: a mono accent eyebrow, the
 * 288px preview well, the gated 3D panel, a serif title with its family
 * subtitle, the two actions, the 2x2 spec grid, the storage address, and — row
 * A5 — the variants table, then the tag chips.
 *
 * ## The 3D panel, and which host it uses
 *
 * design-contract.md §2.5 asks for a *"288px live 3D canvas"*. Row 21 built it
 * as {@link Tile3DPanel} and mounted it nowhere, so until row X2 three.js
 * reached `dist/` only through the builder's own room. It is one line here,
 * under the sprite rotator, exactly as that module's docblock specifies — and
 * the two coexist rather than replace each other, because the rotator is the
 * **keyboard** route to every angle (`role="slider"`, arrow keys, a pole pad)
 * and `OrbitControls` has no key bindings. The panel is offered closed: the
 * chunk, the WebGL context and the up-to-25 MB fetch all start on the same
 * press, and 978 tiles (11.2%) are over the gate and get a sentence instead of
 * a control.
 *
 * The host is `Stage` — the panel's own canvas, reached through
 * `lazy(() => import('./Viewer'))`. Not row G3's `SharedStage`, which exists for
 * the case a grid of live previews creates: browsers cap live WebGL contexts and
 * drop the oldest, so *many* subjects need one shared context. G3 stated the
 * rule when it declined to move `BuilderRoom` — a room is one subject, so it
 * keeps `Stage` — and **a drawer is one subject too, and only ever one at a
 * time**: the drawer unmounts its whole subtree on close. Routing it through the
 * shared host would buy nothing and would put the subject registry and the 2D
 * blit in the path of the single-canvas case the plain host already serves.
 *
 * The record the panel needs is assembled from the **aggregate and the shown
 * variant**, not from {@link recordOf}. `blob`, `bytes` and `file` are
 * per-variant fields and A1 measured `name`'s variance within an aggregate at 0,
 * so every field is already in hand — and the panel then renders for the one
 * record a scan could in principle miss, which a preview well should survive.
 *
 * ## The drawer shows an item, and the URL names a file
 *
 * Row A1 made the catalog **3,822 aggregates over 8,702 files**, so those are two
 * different objects and `src/routes/tileAddress.ts` is the join. This component
 * does not re-derive it: it calls {@link resolveTileTarget} and switches on the
 * three states that function publishes.
 *
 *   - `closed` — no `tile` param. The drawer is shut.
 *   - `unknown` — a well-formed ordinal in no index this session loaded. A rotted
 *     or forward-dated link, and a **first-class state**: ordinals are
 *     append-only and never reissued, so a shared link can outlive its tile.
 *     Rendering it as "closed" would leave `?tile=` in the address bar with an
 *     empty screen behind it. Before A4 this case was a miss on a local map;
 *     it now arrives typed, and the panel it renders is the same one.
 *   - `open` — the aggregate, the variant the URL named, and `canonical`.
 *
 * ## What `canonical` decides
 *
 * A4's flag is `true` when the URL named `variants[0]`, the address holder — and
 * a link to the address holder cannot be told apart from a link to the item. So:
 *
 *   - **`canonical: true`** — the link asked for the item. The build's lock
 *     preference may apply, and it does: {@link selectVariant} picks the file to
 *     show. This matters on **1,612 aggregates (42.2%)** under an `openlock`
 *     preference, where the pick is not `variants[0]`.
 *   - **`canonical: false`** — the link asked for this print. `target.variant` is
 *     shown exactly, no preference applied, because a link that silently showed
 *     a different file than the one it addressed would make its number
 *     decorative.
 *
 * The URL is **never rewritten** to the preferred variant. Doing so would consume
 * the `canonical` signal — the next render could no longer tell an item link from
 * a file link — and would freeze a preference into a URL the user may share. The
 * variants table states which of the two happened instead.
 *
 * `bottom` is passed only once the user has actually chosen a lock
 * (`useLockChosen`). The default is `openlock` and applying an unchosen default
 * would reorder the corpus for a preference nobody expressed; with `bottom`
 * absent, A1's rank still prefers one part over two, which is preference-free and
 * is what aggregation is for.
 *
 * ## Where the record comes from, and the map that is gone
 *
 * `catalog` is a prop, and the catalog screen passes the index it has already
 * loaded. Without it the drawer loads its own copy through the shell's memoised
 * `loadCatalogIndex()`, and only once a tile is actually open — the index is
 * 5.6 MB, and a mounted-but-closed drawer has no business fetching it.
 *
 * This file used to build a `Map<number, CatalogRecord>` over all 8,702 records
 * on **every open**. It is gone. Resolution takes A1's derived index, whose
 * `byOrdinal` and `byDesign` maps are built once per catalog rather than once per
 * open — and `aggregates` is an accepted prop precisely so a caller holding a
 * `SearchEngine` can pass `engine.aggregates` and pay for the derivation zero
 * extra times (it measures 86.8ms over the real corpus, which is not a cost to
 * pay twice).
 *
 * The one thing still read off a `CatalogRecord` is **`tags`**. Everything else
 * the drawer renders is on the aggregate or the variant: A1 measured variance
 * within an aggregate at **0** for `name`, `texture`, `build`, `kinds`,
 * `sizeCode`, `rotStep` and `foot`, and `bytes`, `blob`, `file` and `family` are
 * per-variant fields. So the lookup is a single scan for a single record on a
 * variant swap, retaining nothing — see {@link recordOf} for why that is not a
 * map.
 *
 * ## The two actions
 *
 * §2.5 asks for two and row **A0** deleted the first with the library it wrote
 * to. **Row C3 puts one back, with a different verb**: templates are the only
 * placement unit, so *these are the tiles I am going to print* is now *this
 * piece is on my plan*. "Place on the plan" resolves the shown file to one of
 * B4's one-slot generated families, pins the file into that family's slot and
 * places the instance at a cell the plan's own collision predicate says is
 * free — `./placeOnPlan.ts` carries the whole argument, including why it arrives
 * through `await import()` rather than as a static dependency of the catalog
 * route.
 *
 * It **does not navigate**, and that is what makes it a second action rather
 * than a quieter copy of the first: the library toggle accumulated without
 * leaving the catalog, and so does this — press it on four tiles, then go to the
 * builder. `Use in builder →` is the one that leaves.
 *
 * The refusal is a real state and is measured rather than defensive: B5's
 * families reach **99.0% of records**, so a file in no family's pool exists, and
 * the drawer says which file and why instead of a press that appears to work.
 *
 * ## "Use in builder"
 *
 * The contract's third clause — "pre-selects the tile" — has a channel, and row
 * **C1** changed what travels down it. Row G5 added an un-persisted one-shot
 * mailbox the builder's palette claims on mount; it used to carry the **item**,
 * and this action also seeded the palette's search with the item's name so that
 * a row for it was on screen when the claim happened.
 *
 * **Neither of those halves survives, because the palette no longer lists
 * items.** After row A1 a placement is a template family with a fill per slot,
 * and after row C1 the palette lists the 91 templates this build can place — so
 * a `DesignId` in the box named nothing the reader could arm, and seeding the
 * search with a tile's name now narrows a list of family names to nothing.
 *
 * What travels instead is a {@link PendingArm}: **the family that admits this
 * tile, at this tile's own size.** `builder/panels/familyKey.ts#armForTags`
 * derives it from the shown record's tags — `shape|base` first, then
 * `(role, form, build)`, with the tile's own `size|` tags alongside — and the
 * action navigates with no search at all. The *position* of the family's size
 * control is chosen by the **palette**, which is the side that holds the domain;
 * `familyKey.ts` measured that the table costs +5.95 kB gzip in the entry chunk
 * if this file imports it, which is why the two halves are split that way.
 *
 * Three measurements make that honest rather than approximate:
 *
 *   - **3,728 of 3,822 designs (97.5%) resolve to a family**, which they must:
 *     every record carries exactly one role and one form, so the families
 *     partition the corpus. **3,206 of those (86.0%) also land on a real size
 *     position** once the palette resolves the tags, so the press usually arms
 *     *"Floor: Straight"* at *"2 wide by 2 deep"* and the rest arm the family at
 *     `any size`, which is a real position and not a missing selection.
 *   - **The 94 that resolve to nothing are all `role|insert`** — doors, windows,
 *     grates. `role|insert` is a perfect bijection with `layer === 'insert'`, no
 *     family is generated for it, and **262 of those 285 records are already
 *     reachable as a fill for a host tile's own accessory slot** — which is the
 *     `SlotFills` grid further down this very drawer. So the action is *replaced
 *     by a sentence* for those, rather than arming a family that cannot admit
 *     the tile on screen.
 *   - **Reading the shown variant's tags rather than the item's is safe, and it
 *     is measured**: over all 3,822 items, the number whose variants disagree
 *     about either the family or the size position is **0**. Same shape as
 *     `foot`'s hoisting argument, and the same reason the drawer is allowed to
 *     ask a record a question about a tile.
 *
 * **The lossiness is real and it is disclosed on screen.** A family is not the
 * tile: the fill solver may put a different print, or a different tile of the
 * same family, in the slot. So the button says which family and size it will arm
 * — the alternative is a press that silently means something weaker than it
 * says. This is also *why* the map lives at this end of the channel rather than
 * in the palette: the reader could do the same derivation, but it could not
 * explain it to the person who pressed the button.
 *
 * What has not changed is that **nothing here resolves a file.** A6's rule 0
 * re-picks a variant at bill time and the three locks disagree for **37.1% of
 * items**, so the print on screen is one of several prints of the thing the user
 * chose; a family and a size have no print in them to freeze. The navigation
 * still comes last, because the claim happens when the palette mounts.
 */
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { PRINT_OPTIONS } from '@/assembly'
import type { AggregateIndex, CatalogFile, CatalogRecord, TileAggregate, TileId, TileVariant } from '@/catalog'
import { buildAggregateIndex, resolveTags, selectVariant } from '@/catalog'
/* Deep, and not through `@/builder/panels`: that barrel is the bill panel, the
   download hook and the archive planner, none of which belongs in the catalog's
   chunk. `familyKey.ts` imports `@/store` for one brand and nothing else —
   **including not the template table**, which is the whole reason it is a
   separate module from `families.ts`: an A/B build measured that table landing
   in the entry chunk at +5.95 kB gzip for every visitor to every page. Its
   docblock carries the figures. */
import { armForTags, armNameForTags, armRefusalFor } from '@/builder/panels/familyKey'
import { closeTileDrawer, resolveTileTarget } from '@/routes'
import { resolveMaterial } from '@/materials'
import type { PendingArm, TemplateId } from '@/store'
import { armTemplateInBuilder, useLockChosen, useLockSystem } from '@/store'
import { Tile3DPanel } from '@/three'
import { Chip, Drawer, Eyebrow } from '@/ui/primitives'
import { loadCatalogIndex } from '@/ui/shell'

import type { SpecValue } from './labels'
import {
  buildLabel,
  componentLabel,
  familyTrail,
  fileLabel,
  footprintLabel,
  heightLabel,
  storageAddress,
  textureSetLabel,
} from './labels'
import { SpriteRotator } from './SpriteRotator'
import { spriteSheetUrl } from './spriteFrames'
import type { VariantChoice } from './VariantsTable'
import { VariantsTable } from './VariantsTable'

import './detail.css'

const catalogApi = getRouteApi('/')

export interface TileDrawerProps {
  /**
   * The catalog index.
   *
   * Passed by the catalog screen, which has already loaded and parsed it. Omit
   * it and the drawer loads its own — see the docblock.
   */
  catalog?: CatalogFile
  /**
   * A1's derived aggregate layer, when the caller already has one.
   *
   * Optional and preferred. `buildAggregateIndex` is a pure function of the
   * catalog and measures 86.8ms over the real corpus, so a caller holding a
   * `SearchEngine` should pass `engine.aggregates` rather than let the drawer
   * derive a second copy. Omitted, the drawer derives its own, memoised on the
   * file.
   */
  aggregates?: AggregateIndex
}

/* ------------------------------------------------------------------ the index */

/** The index, from the prop or from the shell's memoised loader. */
function useIndex(provided: CatalogFile | undefined, wanted: boolean): CatalogFile | undefined {
  const [loaded, setLoaded] = useState<CatalogFile | undefined>(undefined)

  useEffect(() => {
    if (provided !== undefined || !wanted || loaded !== undefined) return
    let alive = true
    loadCatalogIndex().then(
      (file) => {
        if (alive) setLoaded(file)
      },
      (error: unknown) => {
        // The drawer is one tile's worth of detail; a failed index should leave
        // the honest "not in this index" panel rather than take the screen down.
        if (alive) console.warn('tile detail: catalog index unavailable', error)
      },
    )
    return () => {
      alive = false
    }
  }, [provided, wanted, loaded])

  return provided ?? loaded
}

/**
 * The record behind a variant — a scan, and deliberately not a map.
 *
 * Read for exactly one field, `tags`, and for exactly one variant at a time: the
 * drawer's other facts are all on the aggregate or the variant. A
 * `Map<TileId, CatalogRecord>` would retain 8,702 entries to answer one question
 * per variant swap, which is the shape of the map row A4 asked this file to
 * retire. `ord === index in records` holds on all 8,702 records today but the
 * schema forbids relying on it — ordinals retire and are never reissued, so
 * density is a coincidence of the current corpus and not a contract.
 */
function recordOf(catalog: CatalogFile, id: TileId): CatalogRecord | undefined {
  return catalog.records.find((record) => record.id === id)
}

/* -------------------------------------------------------------------- drawer */

export function TileDrawer({ catalog, aggregates }: TileDrawerProps) {
  const { tile } = catalogApi.useSearch()
  const router = useRouter()
  const index = useIndex(catalog, tile !== null)

  // Memoised on the file, so a drawer that opens twenty times derives once — and
  // skipped entirely when the caller handed us an index it had already built.
  const derived = useMemo(
    () => (aggregates ?? (index === undefined ? undefined : buildAggregateIndex(index))),
    [aggregates, index],
  )

  const target = useMemo(
    () => (derived === undefined ? undefined : resolveTileTarget(derived, tile)),
    [derived, tile],
  )

  const open = target?.state === 'open' ? target : undefined
  // Off the **aggregate**, not off a record: A1 measured `texture` and `kinds`
  // variance within an aggregate at 0, so both are properties of the item and
  // reading them from a variant's record would be a scan for an answer that
  // cannot differ — and would describe the URL's variant while the body
  // describes the shown one.
  const eyebrow =
    open === undefined
      ? 'Tile detail'
      : `${textureSetLabel(open.aggregate)} · ${componentLabel(open.aggregate)}`

  return (
    <Drawer
      className="of-detail"
      open={tile !== null}
      onOpenChange={(next) => {
        if (!next) void closeTileDrawer(router)
      }}
      title={open?.aggregate.name ?? 'Tile detail'}
      titleHidden
      description={<Eyebrow tone="accent">{eyebrow}</Eyebrow>}
      closeLabel="Close tile detail"
    >
      {open !== undefined && index !== undefined ? (
        <TileDetail
          catalog={index}
          aggregate={open.aggregate}
          urlVariant={open.variant}
          canonical={open.canonical}
        />
      ) : (
        <div className="of-detail-state">
          {index === undefined || target === undefined ? (
            <p className="of-shimmer">Loading the catalog index…</p>
          ) : (
            <p>
              Nothing in this index is tile <code>{String(tile)}</code>. Ordinals are never
              reissued, so a link can outlive the tile it named.
            </p>
          )}
        </div>
      )}
    </Drawer>
  )
}

/* -------------------------------------------------------------------- content */

/**
 * Which variant to show, and how that was decided.
 *
 * The whole of `canonical`'s consequence, in one hook so the rule is stated once.
 * `preference.bottom` is set only when the user has chosen a lock — see the
 * module docblock.
 */
function useShownVariant(
  aggregate: TileAggregate,
  urlVariant: TileVariant,
  canonical: boolean,
): { readonly shown: TileVariant; readonly choice: VariantChoice } {
  const lock = useLockSystem()
  const chosen = useLockChosen()

  return useMemo(() => {
    if (!canonical) return { shown: urlVariant, choice: { by: 'url' } as const }

    const selection = selectVariant(aggregate, {
      ...(chosen ? { bottom: lock } : {}),
      options: PRINT_OPTIONS,
    })
    return {
      shown: selection.variant,
      choice: { by: 'preference', lock, chosen, optionTie: selection.optionTie } as const,
    }
  }, [aggregate, urlVariant, canonical, lock, chosen])
}

/**
 * The drawer's body, split out so the item-dependent hooks are only called when
 * there is an item to call them about.
 */
function TileDetail({
  catalog,
  aggregate,
  urlVariant,
  canonical,
}: {
  catalog: CatalogFile
  aggregate: TileAggregate
  urlVariant: TileVariant
  canonical: boolean
}) {
  const router = useRouter()
  const { shown, choice } = useShownVariant(aggregate, urlVariant, canonical)

  const record = useMemo(() => recordOf(catalog, shown.id), [catalog, shown.id])
  const tags = useMemo(() => (record === undefined ? [] : resolveTags(catalog, record)), [catalog, record])

  // Every one of these is hoisted or per-variant — see the docblock. `foot` and
  // `sizeCode` come off the aggregate because A1 measured their variance at 0.
  // Per-variant, not hoisted: the material comes from the *shown* file's tags
  // and filename, and `resolveMaterial` is the full resolution rather than
  // `TEXTURE_ROOT_MATERIAL[record.texture]` — row P3 measured those two
  // disagreeing on 691 of 8,702 records (7.9%).
  const material = useMemo(() => resolveMaterial(tags, shown.file).material, [tags, shown.file])
  /* The family that admits this tile, and the gate on both actions. See the
     comment on the actions block, and `familyKey.ts` for why the derivation
     lives at this end of the channel. */
  const arm = useMemo(() => armForTags(tags), [tags])
  const footprint = footprintLabel({ foot: aggregate.foot, sizeCode: aggregate.sizeCode }, tags)
  const height = heightLabel(tags)
  const address = storageAddress(catalog.assets, shown)

  return (
    <>
      <SpriteRotator
        material={material}
        name={aggregate.name}
        sheet={catalog.sprite}
        sheetUrl={shown.sprite ? spriteSheetUrl(catalog.assets, shown.blob) : null}
      />

      {/*
        §2.5's live 3D view, gated on `bytes` and opened on a press. The record
        is assembled from the aggregate and the variant rather than read off a
        `CatalogRecord` — see the module docblock for why, and for why this uses
        the panel's own `Stage` and not row G3's shared canvas.
      */}
      <Tile3DPanel
        record={{
          blob: shown.blob,
          bytes: shown.bytes,
          file: shown.file,
          name: aggregate.name,
        }}
        tags={tags}
        assets={catalog.assets}
      />

      {/*
        A `<p>`, not a heading. The drawer's accessible name is already the
        primitive's `Dialog.Title`, rendered visually-hidden because §2.5 opens on
        the eyebrow rather than on an `<h2>` — and that hidden element is a real
        heading in the accessibility tree. A second heading with the same text
        would put the tile's name in the rotor twice and announce it twice.
      */}
      <p className="of-detail-title">{aggregate.name}</p>
      <p className="of-detail-family">
        <code>{familyTrail(shown)}</code> family
      </p>

      <div className="of-detail-actions">
        {/*
          §2.5's two actions, and they are two verbs rather than one twice.
          **Both are gated on the same answer** — `armForTags`, row C1's — so a
          tile no family admits offers neither, and the refusal below is the only
          one in this file. `arm` is derived twice (here and inside
          {@link UseInBuilder}) and that is a second *call* and not a second
          rule: the function is a pure walk of ten tags, both call sites memoise
          it, and hoisting it would mean rewriting C1's component to take what it
          can work out itself.
        */}
        {arm === undefined ? null : (
          <PlaceOnPlanAction catalog={catalog} shown={shown} template={arm.template} />
        )}
        <UseInBuilder tags={tags} onGo={() => void router.navigate({ to: '/builder' })} />
      </div>

      <dl className="of-detail-specs">
        <Spec label="Footprint" value={footprint} unit={unitFor(footprint.basis)} />
        <Spec label="Height" value={height} />
        <Spec label="Build system" value={buildLabel(aggregate)} />
        <Spec label="File" value={fileLabel(shown)} />
      </dl>

      <Eyebrow as="span" className="of-detail-section">
        Storage address
      </Eyebrow>
      {/*
        A real link to the archive, which is what the design surfaces here. It
        leaves the app, so it opens in a new tab and carries `noreferrer` —
        `objects.openforge.tools` has no need of this app's URL, which contains
        the visitor's filters.
      */}
      <a className="of-detail-address" href={address} target="_blank" rel="noreferrer">
        {address}
      </a>

      <VariantsTable aggregate={aggregate} catalog={catalog} shown={shown} choice={choice} />

      <Eyebrow as="span" className="of-detail-section">
        Tags
      </Eyebrow>
      <div className="of-detail-tags">
        {tags.map((tag) => (
          <Chip tone="tag" key={tag}>
            {tag}
          </Chip>
        ))}
      </div>
    </>
  )
}

/**
 * A grid-unit suffix, and only where one applies.
 *
 * `GRID_UNIT_MM` is 25.4, so a catalog unit is exactly an inch and the mock's
 * `in` is the right word. An arc's label carries a radius *and* a swept angle, so
 * a single unit after it would attach to the degrees; that cell states its units
 * in its note instead.
 */
function unitFor(basis: SpecValue<string>['basis']): string | undefined {
  return basis === 'rect' || basis === 'wall' ? 'in' : undefined
}

/**
 * The second action, and what it says it will arm.
 *
 * Two states, and the second is not an error: a tile whose tags name no family
 * cannot be armed, and all 94 such designs are inserts, which go in a host
 * tile's accessory slot instead — the grid this same drawer renders further
 * down. So the button is replaced by the sentence that says where to go, rather
 * than disabled or left to arm something wrong. The module docblock carries the
 * measurements.
 *
 * The armed family and size are named under the button because a press means
 * something weaker than *"use this tile"*: the family admits this tile, and the
 * fill solver may put another print of it — or another tile of the family — in
 * the slot.
 */
function UseInBuilder({ tags, onGo }: { tags: readonly string[]; onGo: () => void }) {
  const arm: PendingArm | undefined = useMemo(() => armForTags(tags), [tags])
  const name = useMemo(() => armNameForTags(tags), [tags])

  if (arm === undefined || name === undefined) {
    // Two causes, and they are different sentences: an insert has somewhere else
    // to go, and an unclassified tile has nowhere at all. `armRefusalFor` carries
    // the measurement that the second is unreachable over the emitted index.
    return (
      <p className="of-detail-armnote">
        {armRefusalFor(tags) === 'insert'
          ? 'Inserts are not placed on their own — pick one in the accessory slots of the tile it goes into, below.'
          : 'This build files no template family for this tile, so the builder cannot arm it.'}
      </p>
    )
  }

  return (
    <>
      <button
        type="button"
        className="of-detail-action"
        data-variant="ghost"
        onClick={() => {
          armTemplateInBuilder(arm)
          onGo()
        }}
      >
        Use in builder &rarr;
      </button>
      <p className="of-detail-armnote">
        Arms the <strong>{name}</strong> family, at this tile&rsquo;s size.
      </p>
    </>
  )
}


/** One spec cell. `data-empty` marks a value that is a refusal, not a measurement. */
function Spec({
  label,
  value,
  unit,
}: {
  label: string
  value: SpecValue<string>
  unit?: string | undefined
}) {
  const empty = value.basis === 'unspecified' || value.basis === 'none'
  return (
    <div className="of-detail-spec">
      <dt>{label}</dt>
      <dd data-empty={empty ? '' : undefined} title={value.note}>
        {value.text}
        {unit === undefined ? null : <span className="of-detail-unit"> {unit}</span>}
      </dd>
    </div>
  )
}

/* ------------------------------------------------------- place on the plan */

/**
 * §2.5's first action: put **this file** on the plan, as one instance of the
 * family that admits it.
 *
 * The second verb beside {@link UseInBuilder}'s, and the difference is what each
 * one keeps. Arming keeps the **family** and hands the print back to the fill
 * solver, which C1 discloses on the button because it is lossy. This keeps the
 * **file**: the family's one slot is filled with the variant on screen and
 * pinned, so the piece on the plan is the piece in the preview well. That is
 * §2.5's *"+ Add to library"* in the only verb left after row A0 — *these are
 * the tiles I am going to print* is now *this piece is on my plan* — and it
 * deliberately does **not** navigate, which is what keeps it a second action
 * rather than a quieter copy of the first: the library toggle accumulated
 * without leaving the catalog, and so does this.
 *
 * ## The family comes from `armForTags`, and row C3's own rule was wrong
 *
 * This took a `familyForRecord` in `./placeOnPlan.ts` that walked the generated
 * table and preferred **the most specific family by `require` count**. Merging
 * row C1 measured that rule against `familyKey.ts#armForTags` over the live
 * index, and it is wrong on the bases — **1,963 of 1,963 `shape|base` records,
 * zero exceptions**: a base carries the role of the piece it sits under (1,117
 * are `role|wall`), so the three-ref `(role, form, build)` key always outranks
 * the one-ref `shape|base`, and every base would have been placed as a wall.
 * `armForTags` asks `shape|base` **first** for exactly that reason. On the other
 * 6,739 records the two agreed exactly, and both refuse the same 285 insert
 * records — so the whole disagreement was the defect. The function is deleted
 * and this reads C1's answer, which is also the answer that reaches the channel,
 * so the two actions cannot disagree about what this tile is.
 *
 * The **table** is still needed for one thing the tags cannot answer — the
 * *name* of the family's single slot, which is where the file goes — and that is
 * a lookup rather than a derivation. It happens inside `./placeOnPlan.ts`, which
 * arrives through `await import()` on the press, so the +5.95 kB gzip entry-chunk
 * cost `familyKey.ts` measured for importing the table here is not paid: the
 * catalog route's chunk is byte-identical with this button present.
 *
 * Three states, and the fourth is gone: the caller only renders this when a
 * family exists, so *"no family"* is C1's sentence beside the missing arm and
 * not a refusal of its own. What is left is nothing pressed, the import in
 * flight, and placed at a named cell.
 */
function PlaceOnPlanAction({
  catalog,
  shown,
  template,
}: {
  catalog: CatalogFile
  shown: TileVariant
  /** The family `armForTags` derived. The caller has already gated on it. */
  template: TemplateId
}) {
  const [state, setState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'placing' }
    | { readonly kind: 'placed'; readonly where: string; readonly family: string }
  >({ kind: 'idle' })

  return (
    <>
      <button
        type="button"
        className="of-detail-action"
        disabled={state.kind === 'placing'}
        onClick={() => {
          setState({ kind: 'placing' })
          void (async () => {
            const { placeFileAsFamily } = await import('./placeOnPlan')
            const placed = placeFileAsFamily(catalog, template, shown.id)
            // `undefined` only if this build ships no such family, which the
            // gate above has already ruled out — `armForTags` constructs the id
            // and `families.test.ts` holds that construction to the emitter with
            // 0 mismatches. Kept as a branch rather than asserted, because a
            // press that silently did nothing would be worse than one that says
            // nothing happened.
            setState(placed === undefined ? { kind: 'idle' } : { kind: 'placed', ...placed })
          })()
        }}
      >
        {state.kind === 'placing' ? 'Placing…' : '+ Place on the plan'}
      </button>

      {state.kind === 'placed' ? (
        <p className="of-detail-placed" role="status">
          {`Placed as ${state.family} at ${state.where}.`}
        </p>
      ) : null}
    </>
  )
}

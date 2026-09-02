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
 * ## "Use in builder"
 *
 * The contract's third clause — "pre-selects the tile" — now has a channel. Row
 * G5 added `@/store`'s {@link sendTileToBuilder}, an un-persisted one-shot
 * mailbox the builder's palette claims on mount, so the action does all four of
 * the things the clause asks for: it adds the **shown variant** to the library,
 * asks the builder to arm that same file, navigates, and seeds the palette's
 * search with the item's name.
 *
 * The order is load-bearing. The library write comes first because the palette
 * lists the library, and it refuses to arm a file it holds no placeable row for
 * — so arming before filing would be a handoff the reader is right to drop. The
 * navigation comes last because the claim happens when the palette mounts.
 *
 * **The variant travels, not the address holder, and not a resolution.** The user
 * is looking at a specific print and that is the file they meant, so that exact
 * `TileId` is what goes over. No lock preference is applied on the way: A6's rule
 * 0 re-picks the variant at bill time and the three locks disagree on the answer
 * for 37.1% of items, so a channel that pre-resolved would hand the palette a
 * file the drawer never showed. What the user selected and what the bill prints
 * are two facts, and only the first one is this action's business.
 */
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import { PRINT_OPTIONS } from '@/assembly'
import type { AggregateIndex, CatalogFile, CatalogRecord, TileAggregate, TileId, TileVariant } from '@/catalog'
import { buildAggregateIndex, resolveTags, selectVariant } from '@/catalog'
import { closeTileDrawer, resolveTileTarget } from '@/routes'
import { resolveMaterial } from '@/materials'
import { MAX_QUERY_LENGTH } from '@/search'
import { addToLibrary, sendTileToBuilder, toggleLibrary, useIsInLibrary, useLockChosen, useLockSystem } from '@/store'
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

const catalogApi = getRouteApi('/catalog')

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
  const inLibrary = useIsInLibrary(shown.id)

  const record = useMemo(() => recordOf(catalog, shown.id), [catalog, shown.id])
  const tags = useMemo(() => (record === undefined ? [] : resolveTags(catalog, record)), [catalog, record])

  // Every one of these is hoisted or per-variant — see the docblock. `foot` and
  // `sizeCode` come off the aggregate because A1 measured their variance at 0.
  // Per-variant, not hoisted: the material comes from the *shown* file's tags
  // and filename, and `resolveMaterial` is the full resolution rather than
  // `TEXTURE_ROOT_MATERIAL[record.texture]` — row P3 measured those two
  // disagreeing on 691 of 8,702 records (7.9%).
  const material = useMemo(() => resolveMaterial(tags, shown.file).material, [tags, shown.file])
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
        <button
          type="button"
          className="of-detail-action"
          aria-pressed={inLibrary}
          onClick={() => {
            toggleLibrary(shown.id)
          }}
        >
          {inLibrary ? '✓ In library' : '+ Add to library'}
        </button>
        <button
          type="button"
          className="of-detail-action"
          data-variant="ghost"
          onClick={() => {
            addToLibrary(shown.id)
            sendTileToBuilder(shown.id)
            void router.navigate({
              to: '/builder',
              search: { q: aggregate.name.slice(0, MAX_QUERY_LENGTH) },
            })
          }}
        >
          Use in builder →
        </button>
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

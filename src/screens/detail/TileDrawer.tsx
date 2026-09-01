/**
 * The tile inspector — design-contract.md §2.5.
 *
 * A 442px right-hand drawer over the scrim, opened by `?tile={ordinal}` on
 * `/catalog` and containing, in the mock's order: a mono accent eyebrow, the
 * 288px preview well, a serif title with its family subtitle, the two actions,
 * the 2×2 spec grid, the storage address, the tag chips, and the family variant
 * buttons.
 *
 * ## The drawer is search state, and its history rules are not this file's
 *
 * `src/routes/tileDrawer.ts` owns them, and this component calls it rather than
 * navigating by hand — the whole reason that module exists is that a plain
 * `navigate({ tile: null })` pushes a third entry and makes Back re-open the
 * drawer the user just dismissed. So: opening pushed (the catalog card's
 * `<Link>`), a variant swap **replaces** via `showTileInDrawer`, and every close
 * path — `Escape`, the backdrop, the ✕ — goes through `closeTileDrawer`.
 *
 * ## Where the record comes from
 *
 * `catalog` is a prop, and the catalog screen passes the index it has already
 * loaded. Without it the drawer loads its own copy through the shell's memoised
 * `loadCatalogIndex()`, and only once a tile is actually open — the index is
 * 5.6 MB, and a mounted-but-closed drawer has no business fetching it.
 *
 * A `?tile=` that names no record is a first-class state, not an error: ordinals
 * are append-only but retired ordinals are never reissued, so a shared link can
 * outlive its tile. That renders an explicit panel rather than an empty drawer or
 * a thrown boundary.
 *
 * ## "Use in builder →"
 *
 * The contract's third clause — "pre-selects the tile" — has no channel in v1
 * that this PR owns: the builder route carries the facet params and nothing else
 * (`src/routes/routeTree.tsx`), and the store holds a library and placements but
 * no selection (`src/store/schema.ts`). Both belong to other rows. So the action
 * does what it can honestly do: it adds the tile to the library, navigates to the
 * builder, and seeds the palette's search with the tile's own name, which puts it
 * at the top of the palette PR 18 builds. When a selection channel lands, this is
 * the one call site to change.
 */
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { resolveTags } from '@/catalog'
import { closeTileDrawer, showTileInDrawer } from '@/routes'
import { MAX_QUERY_LENGTH } from '@/search'
import { addToLibrary, toggleLibrary, useIsInLibrary } from '@/store'
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
import { familyVariants } from './variants'

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

/* -------------------------------------------------------------------- drawer */

export function TileDrawer({ catalog }: TileDrawerProps) {
  const { tile } = catalogApi.useSearch()
  const router = useRouter()
  const index = useIndex(catalog, tile !== null)

  const byOrdinal = useMemo(() => {
    const map = new Map<number, CatalogRecord>()
    for (const record of index?.records ?? []) map.set(record.ord, record)
    return map
  }, [index])

  const record = tile === null ? undefined : byOrdinal.get(tile)

  const eyebrow =
    record === undefined
      ? 'Tile detail'
      : `${textureSetLabel(record)} · ${componentLabel(record)}`

  return (
    <Drawer
      className="of-detail"
      open={tile !== null}
      onOpenChange={(next) => {
        if (!next) void closeTileDrawer(router)
      }}
      title={record?.name ?? 'Tile detail'}
      titleHidden
      description={<Eyebrow tone="accent">{eyebrow}</Eyebrow>}
      closeLabel="Close tile detail"
    >
      {record !== undefined && index !== undefined ? (
        <TileDetail catalog={index} record={record} />
      ) : (
        <div className="of-detail-state">
          {index === undefined ? (
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
 * The drawer's body, split out so the record-dependent hooks —
 * `useIsInLibrary`, and the memos over the index — are only called when there is
 * a record to call them about.
 */
function TileDetail({ catalog, record }: { catalog: CatalogFile; record: CatalogRecord }) {
  const router = useRouter()
  const inLibrary = useIsInLibrary(record.id)

  const tags = useMemo(() => resolveTags(catalog, record), [catalog, record])
  const variants = useMemo(() => familyVariants(catalog, record), [catalog, record])

  const footprint = footprintLabel(record, tags)
  const height = heightLabel(tags)
  const address = storageAddress(catalog.assets, record)

  return (
    <>
      <SpriteRotator
        name={record.name}
        sheet={catalog.sprite}
        sheetUrl={record.sprite ? spriteSheetUrl(catalog.assets, record.blob) : null}
      />

      {/*
        A `<p>`, not a heading. The drawer's accessible name is already the
        primitive's `Dialog.Title`, rendered visually-hidden because §2.5 opens on
        the eyebrow rather than on an `<h2>` — and that hidden element is a real
        heading in the accessibility tree. A second heading with the same text
        would put the tile's name in the rotor twice and announce it twice.
      */}
      <p className="of-detail-title">{record.name}</p>
      <p className="of-detail-family">
        <code>{familyTrail(record)}</code> family
      </p>

      <div className="of-detail-actions">
        <button
          type="button"
          className="of-detail-action"
          aria-pressed={inLibrary}
          onClick={() => {
            toggleLibrary(record.id)
          }}
        >
          {inLibrary ? '✓ In library' : '+ Add to library'}
        </button>
        <button
          type="button"
          className="of-detail-action"
          data-variant="ghost"
          onClick={() => {
            addToLibrary(record.id)
            void router.navigate({
              to: '/builder',
              search: { q: record.name.slice(0, MAX_QUERY_LENGTH) },
            })
          }}
        >
          Use in builder →
        </button>
      </div>

      <dl className="of-detail-specs">
        <Spec label="Footprint" value={footprint} unit={unitFor(footprint.basis)} />
        <Spec label="Height" value={height} />
        <Spec label="Build system" value={buildLabel(record)} />
        <Spec label="File" value={fileLabel(record)} />
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

      {variants.length === 0 ? null : (
        <>
          <Eyebrow as="span" className="of-detail-section">
            Other sizes in this family
          </Eyebrow>
          <div className="of-detail-variants">
            {variants.map((variant) => (
              <button
                key={variant.ord}
                type="button"
                className="of-detail-variant"
                title={variant.name}
                onClick={() => {
                  // Replaces, so Back still closes the drawer rather than
                  // walking back through every variant looked at.
                  void showTileInDrawer(router, variant.ord)
                }}
              >
                {variant.label}
              </button>
            ))}
          </div>
        </>
      )}
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

/**
 * `/library` — design-contract.md §2.3.
 *
 * A heading, a mono summary (`{n} tiles · {mb} MB`), an "Open in builder →"
 * primary action, then the saved tiles grouped by component kind under mono
 * uppercase rules; an empty state with a "Browse the catalog" call to action.
 * This is the curated palette — the tiles the user actually prints with, and the
 * set the builder's palette draws from.
 *
 * ## What it delegates
 *
 * Almost everything, and deliberately:
 *
 *   - **The grouping rule, the resolution and the byte total** are
 *     `./grouping.ts`, so all three are tested without a DOM. That file's
 *     docblock carries the corpus figures behind the precedence order, the md5
 *     dedupe and the gap between the file a card shows and the file it downloads
 *     as; they are the decisions on this screen that are not obvious from the
 *     contract.
 *   - **The thumbnail** is `@/ui/thumb` — the sprite-sheet maths, moved out of the
 *     catalog card by row P0 because four subtrees render it. The skeleton below
 *     is the one place this screen draws a `.of-thumb` well itself: a bare
 *     shimmer plate, with no image and nothing to tint.
 *   - **The size chip and every formatted figure** come from `@/screens/catalog`,
 *     whose `format` helpers are what make a size chip here read identically to
 *     the same chip on a catalog card.
 *   - **The library and the lock preference** are `@/store`. This screen holds no
 *     state beyond the import report, which belongs to the control that produced
 *     it.
 *
 * ## It lists items, because the store holds items
 *
 * Row V2, on top of V1. This section used to reconcile two counts — cards against
 * saved files — and print both on the summary line (`12 tiles · 15 files ·
 * 148.2 MB`). `WorkshopState.library` is keyed by design now, so there is one
 * count and the summary is the contract's original `{n} tiles · {mb}` again.
 *
 * What arrived in its place is a **dependency on the lock preference**. A design
 * does not name a file, so the byte total is the total of what each item
 * *resolves to* under the build's current lock — which means this screen
 * re-derives when the lock changes, and the same library honestly reports a
 * different size under openlock than under magnetic (54.28 GB against 53.39 GB
 * with the whole corpus saved). The summary's headline count does not move,
 * because the number of items never depended on the lock.
 *
 * ## Group counts sum to the summary
 *
 * The one internal consistency the screen must not break: a summary that says
 * "12 tiles" above groups adding to 15 is a bug the user can see, and it is
 * exactly what grouping a multi-kind tile into every bucket it matches would
 * produce (19.5% of the corpus is in two or more). `collectLibrary` puts every
 * saved design in exactly one group or in `missing`.
 *
 * ## Waiting, failing, and designs the catalog no longer has
 *
 * The item count comes from the store and is known immediately; the byte total
 * needs the 5.6 MB index, so the summary shows the count first and grows the
 * size when the index lands. An **empty** library never waits at all — nothing
 * about "you have saved nothing" depends on the catalog.
 *
 * A saved design the current catalog does not contain is reported rather than
 * skipped. With this key it happens when a **tag edit moves the item to another
 * design**, which `src/store/schema.ts` accepts as the price of a key that
 * survives a reimport precisely because it fails closed here. Skipping it
 * silently would leave an entry in `localStorage` that renders nowhere and can
 * never be removed.
 *
 * ## It renders a `<section>`, not a `<main>`
 *
 * `AppFrame` owns the document's one `<main>`. The `<h1>` here *is* visible,
 * unlike the catalog's — the contract opens this screen on a heading and a
 * summary rather than on a control.
 */
import { Link } from '@tanstack/react-router'
import { useMemo } from 'react'

import { PRINT_OPTIONS } from '@/assembly'
import type { CatalogAssets, DesignId, SpriteSheet } from '@/catalog'
import type { CatalogIndex } from '@/screens/catalog'
import { connLabel, countLabel, kindLabel, useCatalogIndex } from '@/screens/catalog'
import type { LockSystem } from '@/store'
import { libraryDesigns, removeFromLibrary, useLibrary, useLockSystem } from '@/store'
import { Button, Chip, Eyebrow, buttonProps } from '@/ui/primitives'

import type { LibraryContents, LibraryItem } from './grouping'
import { collectLibrary, roundBytesLabel, totalBytesLabel } from './grouping'
import { LibraryCard } from './LibraryCard'
import { LibraryTransfer } from './LibraryTransfer'

import './library.css'

export function LibraryScreen() {
  const library = useLibrary()
  const lock = useLockSystem()
  const state = useCatalogIndex()
  const index = state.status === 'ready' ? state.index : null

  // `library` is replaced only when the library changes, `index` only when the
  // catalog resolves and `lock` only when the user changes their build, so this
  // runs once per add, once per remove, once on load and once per lock change —
  // not on every unrelated store write.
  const contents = useMemo(
    () =>
      index === null
        ? null
        : collectLibrary({
            // `libraryDesigns` and **not** `Object.keys(library) as DesignId[]`,
            // which is what stood here and is the trap this screen was warned
            // about. Verified with `tsc`: a `Record<TileId, true>` *is* assignable
            // to a `Record<DesignId, true>` (a brand does not survive a `Record`
            // key), so a cast naming the brand would still compile the day the
            // store is re-keyed and every entry would land in `missing`. The
            // helper infers the key type off the store's own field and hands back
            // an array, where the brand does hold — so this line stops compiling
            // instead of quietly emptying the screen. There is no assertion left
            // here at all.
            ids: libraryDesigns(library),
            record: (id) => index.engine.record(id),
            // The engine's own aggregate layer, not a second `buildAggregateIndex`
            // over the same file — A2 exposed it precisely so rows A3 to A7 share
            // one pass over 8,702 records.
            aggregates: index.engine.aggregates,
            preference: { bottom: lock, options: PRINT_OPTIONS },
            kindOrder: index.engine.vocabulary.kinds,
          }),
    [index, library, lock],
  )

  const saved = Object.keys(library).length

  return (
    <section className="of-library" aria-labelledby="of-lib-heading">
      <header className="of-lib-head">
        <h1 className="of-lib-title" id="of-lib-heading">
          Library
        </h1>
        <p className="of-lib-summary">
          {/*
            The store's own count until the index lands, and then the count of
            items the catalog could describe — which is smaller exactly when a
            saved design has gone missing, and `MissingNote` is what accounts for
            the difference.
          */}
          {countLabel(contents?.items ?? saved)} {(contents?.items ?? saved) === 1 ? 'tile' : 'tiles'}
          {/*
            The count comes from the store and is known immediately; the size
            needs the index, so it arrives a beat later. An empty library gets no
            size at all — "0 tiles · 0 kB" states the same nothing twice.
          */}
          {contents === null || saved === 0 ? null : (
            <>
              {' · '}
              <span data-verdict={contents.size.verdict}>{totalBytesLabel(contents.size.bytes)}</span>
            </>
          )}
        </p>

        {saved > 0 ? (
          <Link {...buttonProps({ tone: 'primary' })} to="/builder">
            Open in builder <span aria-hidden="true">→</span>
          </Link>
        ) : null}
      </header>

      {contents === null ? null : <LibraryNotes contents={contents} lock={lock} />}

      {saved === 0 ? <LibraryEmpty /> : null}

      {saved > 0 && state.status === 'error' ? (
        <div className="of-lib-error" role="alert">
          <p className="of-empty-title">The catalog index could not be loaded.</p>
          <p className="of-empty-note">
            {state.error.message} Your library is safe — this screen needs the index to describe the
            tiles in it.
          </p>
          <Button tone="secondary" onClick={state.retry}>
            Try again
          </Button>
        </div>
      ) : null}

      {saved > 0 && state.status === 'loading' ? <LibrarySkeleton count={Math.min(saved, 8)} /> : null}

      {index === null || contents === null
        ? null
        : contents.groups.map((group) => (
            <LibraryGroupBlock
              key={group.kind}
              kind={group.kind}
              items={group.items}
              assets={index.file.assets}
              sheet={index.file.sprite}
              materialOf={index.materialOf}
            />
          ))}

      <LibraryTransfer />
    </section>
  )
}

/* -------------------------------------------------------------------- groups */

/**
 * One kind's rule and its cards.
 *
 * The rule is a real `<h2>` wrapping the mono {@link Eyebrow}, so the groups are
 * navigable headings rather than styled text — a screen reader lands on "Walls,
 * 6" and can skip the six cards under it. The count is beside the label because
 * that is the question a grouped library is asked ("how many walls do I have"),
 * and because it is what lets a reader check the groups against the summary.
 */
function LibraryGroupBlock({
  kind,
  items,
  assets,
  sheet,
  materialOf,
}: {
  kind: string
  items: readonly LibraryItem[]
  assets: CatalogAssets
  sheet: SpriteSheet
  /** `CatalogIndex.materialOf`, threaded rather than resolved per card — it is
      memoised on the index and this screen re-renders on every add and remove. */
  materialOf: CatalogIndex['materialOf']
}) {
  // `!other` is a sentinel, not a word: kept out of the id so the attribute
  // stays a plain slug.
  const headingId = `of-lib-group-${kind.replaceAll(/[^a-z0-9]+/gi, '-')}`

  return (
    <section className="of-lib-group" aria-labelledby={headingId}>
      {/*
        The space before the chip is load-bearing, not formatting: without a text
        node between the two spans the accessible name of the rule is "Walls6".
        `../catalog/FacetSidebar.tsx` spaces its count chips for the same reason.
      */}
      <h2 className="of-lib-group-heading" id={headingId}>
        <Eyebrow>{kindLabel(kind)}</Eyebrow>{' '}
        <Chip tone="count">{countLabel(items.length)}</Chip>
      </h2>
      <div className="of-lib-grid">
        {items.map((entry) => (
          <LibraryCard
            key={entry.item.design}
            entry={entry}
            assets={assets}
            sheet={sheet}
            material={materialOf(entry.preview)}
          />
        ))}
      </div>
    </section>
  )
}

/* --------------------------------------------------------------------- notes */

/**
 * What the byte total means, what it leaves out, and what the catalog could not
 * find.
 *
 * Size is a warning surface rather than a footnote, because the numbers make it
 * one: the corpus median is 10.36 MB and p95 is 32.89 MB, so a library of sixty
 * walls is past a gigabyte and a bare figure buries that. The thresholds and the
 * verdict are `downloadSize()` from `@/assembly`, so this screen warns at exactly
 * the byte counts the builder's bill of tiles warns at.
 *
 * The **base** note is row V2's addition and it exists because the total's claim
 * changed. It used to sum files the user had explicitly picked, so it made no
 * claim about what a complete print was; it now sums the file each item resolves
 * to, and for the majority of items under every lock — 55.9% openlock, 80.1%
 * dragonlock, 80.3% magnetic — that file is a topper whose base is a second
 * print. Stating it once here rather than on four cards in five is the only
 * placement that reads as a property of the total; `grouping.ts` explains why the
 * base's own bytes are not added instead.
 */
function LibraryNotes({ contents, lock }: { contents: LibraryContents; lock: LockSystem }) {
  const shared = contents.items - contents.files
  const { verdict, threshold } = contents.size

  if (
    verdict === 'ok' &&
    shared === 0 &&
    contents.needsBase === 0 &&
    contents.missing.length === 0
  ) {
    return null
  }

  return (
    <div className="of-lib-notes">
      {verdict === 'ok' ? null : (
        <p className="of-lib-note" data-tone={verdict} role="status">
          Over {roundBytesLabel(threshold)} to download.{' '}
          {verdict === 'huge'
            ? 'That is past what one browser download reliably finishes — build in sections and take each one from the builder.'
            : 'Expect a long transfer; the median model in this archive is 10.4 MB on its own.'}
        </p>
      )}

      {contents.needsBase === 0 ? null : (
        <p className="of-lib-note">
          {countLabel(contents.needsBase)} of these{' '}
          {contents.needsBase === 1 ? 'items prints' : 'items print'} as a topper under{' '}
          {connLabel(lock)}, so {contents.needsBase === 1 ? 'it needs' : 'they need'} a base printed
          with {contents.needsBase === 1 ? 'it' : 'them'}. This total counts the tile alone; the
          builder picks the base when it resolves the placement, and its bill of tiles is what counts
          both.
        </p>
      )}

      {shared === 0 ? null : (
        <p className="of-lib-note">
          {countLabel(shared)} of these {shared === 1 ? 'items resolves' : 'items resolve'} to a model
          already counted — the same STL filed under a second catalog path — so the total counts{' '}
          {countLabel(contents.files)} {contents.files === 1 ? 'file' : 'files'} rather than{' '}
          {countLabel(contents.items)}.
        </p>
      )}

      {contents.missing.length === 0 ? null : <MissingNote missing={contents.missing} />}
    </div>
  )
}

function MissingNote({ missing }: { missing: readonly DesignId[] }) {
  return (
    <p className="of-lib-note" data-tone="warn" role="status">
      {countLabel(missing.length)} saved {missing.length === 1 ? 'tile is' : 'tiles are'} not in this
      build of the catalog and cannot be shown.{' '}
      <button
        type="button"
        className="of-lib-inline-action"
        onClick={() => {
          for (const design of missing) removeFromLibrary(design)
        }}
      >
        Remove {missing.length === 1 ? 'it' : 'them'}
      </button>
    </p>
  )
}

/* --------------------------------------------------------------- empty state */

/**
 * design-contract.md §2.3's empty state.
 *
 * The note says where the tiles come from, because "empty" on this screen is
 * ambiguous in a way it is not on the catalog: a returning user's library can be
 * empty because they never saved anything *or* because the browser cleared its
 * storage, and those want different next actions. Both are offered — browse, or
 * import a backup from the block below.
 */
function LibraryEmpty() {
  return (
    <div className="of-lib-empty">
      <Eyebrow as="div">Nothing saved</Eyebrow>
      <p className="of-empty-title">Your library is empty.</p>
      <p className="of-empty-note">
        Saved tiles are the palette the builder draws from — add the ones you print with, and they
        stay here between visits. If you kept a JSON backup, import it below.
      </p>
      <Link {...buttonProps({ tone: 'primary' })} to="/catalog">
        Browse the catalog
      </Link>
    </div>
  )
}

/* ------------------------------------------------------------------ skeleton */

/**
 * Card-shaped shimmer for the wait on the index.
 *
 * One per saved item up to eight, so the reserved space is roughly the space the
 * cards will take rather than an arbitrary screenful — the item count is already
 * known from the store, which is the whole reason this screen can be honest about
 * how much is coming.
 */
function LibrarySkeleton({ count }: { count: number }) {
  return (
    <div className="of-lib-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, position) => (
        <div className="of-lib-card of-lib-card-pending" key={position}>
          <div className="of-thumb of-shimmer" />
          <div className="of-pending-line of-shimmer" />
          <div className="of-pending-line of-pending-short of-shimmer" />
        </div>
      ))}
    </div>
  )
}

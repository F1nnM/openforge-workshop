/**
 * The 60px sticky header — design-contract.md §2.0.
 *
 * Transcribed from the approved mock (`design/OpenForge-Studio.dc.html`, lines
 * 23–37) rather than reinterpreted: the wordmark's rotated tile mark, the 19px
 * display face at 3px letter-spacing, the uppercase nav at 1.6px, the accent
 * inset on the active tab, and the right-aligned mono stat. The measurements are
 * in `shell.css`; this file is the structure and the semantics.
 *
 * ## The three accessibility decisions
 *
 * **The nav is a real landmark.** `<nav aria-label="Sections">`, so a screen
 * reader user can jump to it, and named because a document with more than one
 * `<nav>` (row 16's footer may add one) needs them distinguishable.
 *
 * **Active is programmatic, not just visual.** TanStack Router stamps
 * `data-status="active"` on a matching `Link`, which is what draws the accent
 * inset — but a data attribute is invisible to assistive technology, so
 * `activeProps` adds `aria-current="page"` alongside it. One source of truth
 * (the router's own match), two expressions of it.
 *
 * **The count chips are sentences.** A chip reading `4` beside "Library"
 * announces as "Library 4", which tells a screen reader user nothing. The digits
 * stay visual (`aria-hidden`) and a clipped span supplies the real name:
 * "Library, 4 tiles saved". Deliberately *not* a live region — the counts change
 * on every add and every placement, and announcing "5 tiles saved" over the
 * user's current task would be worse than silence. The chip is a label on a
 * link, and it is read when the link is reached.
 */
import { Link } from '@tanstack/react-router'

import { useLibraryCount, usePlacementCount } from '@/store'
import { Chip, VisuallyHidden } from '@/ui/primitives'

import { useCatalogStats } from './catalogStats'

/** English-only app, so an explicit locale rather than the visitor's. */
const NUMBER = new Intl.NumberFormat('en-US')

function plural(count: number, singular: string, plural_: string): string {
  return `${NUMBER.format(count)} ${count === 1 ? singular : plural_}`
}

/**
 * `OPENFORGE` / `Catalog & Workshop`, linking home.
 *
 * The eyebrow is mono here where the mock had it in the body face. The
 * contract's typography section is explicit that eyebrow labels are mono, and
 * this is the same device that sits above every section and sidebar group on the
 * other four screens; setting it in two different faces depending on which one
 * you are looking at is the kind of drift the mono rule exists to prevent.
 *
 * The mark is `aria-hidden` and the link carries its own name, so the whole
 * thing announces once, as one destination.
 */
function Wordmark() {
  return (
    <Link to="/" className="of-wordmark" aria-label="OpenForge Catalog & Workshop — home">
      <span className="of-mark" aria-hidden="true" />
      <span className="of-wordmark-text" aria-hidden="true">
        <span className="of-wordmark-name">OPENFORGE</span>
        <span className="of-wordmark-eyebrow">Catalog &amp; Workshop</span>
      </span>
    </Link>
  )
}

interface NavTabProps {
  to: '/catalog' | '/library' | '/builder'
  label: string
  /** Omitted for Catalog, which has no count. */
  count?: { value: number; singular: string; plural: string }
}

function NavTab({ to, label, count }: NavTabProps) {
  return (
    <Link
      to={to}
      className="of-nav-tab"
      // The router decides what is active; this only mirrors that decision into
      // the accessibility tree, where `data-status` is not visible.
      activeProps={{ 'aria-current': 'page' }}
    >
      {label}
      {count === undefined ? null : (
        <>
          <Chip tone="count">
            <span aria-hidden="true">{NUMBER.format(count.value)}</span>
          </Chip>
          <VisuallyHidden>{`, ${plural(count.value, count.singular, count.plural)}`}</VisuallyHidden>
        </>
      )}
    </Link>
  )
}

/**
 * `{n} tiles · {archive host}`.
 *
 * The contract's line is `{n} tiles · s3 archive`. The count is real — read from
 * the emitted index, see `catalogStats.tsx` — and `s3 archive` is not: the
 * archive is a Cloudflare R2 bucket served over HTTPS from
 * `objects.openforge.tools`, and has never been on S3. Naming the host the index
 * itself points at is both true and more useful than naming a storage vendor,
 * and it is the one piece of chrome that tells a visitor where the STLs come
 * from.
 *
 * Until the count lands it shows `…`, which is what the mock does
 * (`statTiles: tiles.length || '…'`). The host is withheld until then rather
 * than guessed.
 */
function ArchiveStat() {
  const stats = useCatalogStats()

  if (stats === null) {
    return (
      <p className="of-stat">
        <span className="of-stat-count" aria-hidden="true">
          …
        </span>{' '}
        tiles
        <VisuallyHidden>, counting the archive</VisuallyHidden>
      </p>
    )
  }

  return (
    <p className="of-stat">
      <span className="of-stat-count">{NUMBER.format(stats.tileCount)}</span>{' '}
      {stats.tileCount === 1 ? 'tile' : 'tiles'}
      <VisuallyHidden> in the archive at </VisuallyHidden>
      <span aria-hidden="true"> · </span>
      <span>{stats.archiveHost}</span>
    </p>
  )
}

export function Header() {
  const libraryCount = useLibraryCount()
  const placementCount = usePlacementCount()

  return (
    <header className="of-header">
      <Wordmark />
      <nav className="of-nav" aria-label="Sections">
        <NavTab to="/catalog" label="Catalog" />
        <NavTab
          to="/library"
          label="Library"
          count={{ value: libraryCount, singular: 'tile saved', plural: 'tiles saved' }}
        />
        <NavTab
          to="/builder"
          label="Builder"
          count={{ value: placementCount, singular: 'tile placed', plural: 'tiles placed' }}
        />
      </nav>
      <ArchiveStat />
    </header>
  )
}

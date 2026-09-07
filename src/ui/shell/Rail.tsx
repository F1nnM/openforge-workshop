/**
 * The rail — the app's identity, its navigation, and the slot the screen fills.
 *
 * **It was a 60px sticky header** (design-contract.md §2.0), transcribed from
 * the approved mock: wordmark left, uppercase tabs beside it, a right-aligned
 * mono archive stat. This row turns that column on its side, against a mockup
 * the owner drew: the wordmark at the top of a 265px rail, the tabs below it as
 * two icon tiles, a divider, and then whatever the screen contributes — the
 * catalog's filter groups, the builder's palette. `railSlot.tsx` owns that last
 * part.
 *
 * Three things about the change are decisions rather than transcription:
 *
 *   - **The wordmark is unchanged**, mark and all, because it is the one thing
 *     the owner asked to keep and because it already read as a block: the mark,
 *     `OPENFORGE`, and a mono eyebrow under it. In the header it was a row 13px
 *     apart; here it is the same row at the top of a column.
 *   - **The tabs gained icons and lost their inset.** A 2px accent inset under
 *     an uppercase label is a *bottom* border — it reads as a tab in a tab strip
 *     and reads as nothing in a vertical list. The mockup's tiles are what
 *     replace it: a bordered box each, the active one filled with the accent
 *     wash and bordered in the accent, which is a state that survives being
 *     stacked. The glyphs are inline SVG and `aria-hidden`; the label is the
 *     accessible name, as it was.
 *   - **The archive stat is deleted, not moved.** `{n} tiles ·
 *     objects.openforge.tools` was the one thing in the header that was neither
 *     navigation nor identity, and the old stylesheet already dropped it at
 *     900px for exactly that reason. Nothing in the rail replaces it;
 *     `loadCatalog.ts` records what the deletion left of the module behind it.
 *
 * ## The four accessibility decisions
 *
 * **The nav is a real landmark.** `<nav aria-label="Sections">`, so a screen
 * reader user can jump to it, and named because a document with more than one
 * `<nav>` needs them distinguishable.
 *
 * Two tabs. There have been five: `Settings` went with its route in row L1,
 * `Library` with the library in row A0, and `Assemblies` with the guided screen
 * in this one — the walk it led to is in the builder's slot editor now. That is
 * worth recording, because "a route needs a nav slot" was the reasoning for
 * three of these tabs and it only ever applied to routes.
 *
 * **Active is programmatic, not just visual.** TanStack Router stamps
 * `data-status="active"` on a matching `Link`, which is what fills the tile —
 * but a data attribute is invisible to assistive technology, so `activeProps`
 * adds `aria-current="page"` alongside it. One source of truth (the router's own
 * match), two expressions of it.
 *
 * **The count chip is a sentence.** A chip reading `4` beside "Builder"
 * announces as "Builder 4", which tells a screen reader user nothing. The digits
 * stay visual (`aria-hidden`) and a clipped span supplies the real name:
 * "Builder, 4 tiles placed". Deliberately *not* a live region — the count changes
 * on every placement, and announcing "5 tiles placed" over the user's current
 * task would be worse than silence. The chip is a label on a link, and it is read
 * when the link is reached.
 *
 * **The banner ends where the screen's content begins.** The wordmark and the
 * nav are in a `<header>`, so they are the document's banner; the slot below is
 * outside it, because a screen's filter groups are not site-wide chrome and a
 * banner landmark that contained them would say they were.
 *
 * There was a second chip until row A0, on `Library`, and `count` stays optional
 * because `Catalog` still has nothing to count.
 */
import { Link } from '@tanstack/react-router'

import { usePlacementCount } from '@/store'
import { Chip, VisuallyHidden } from '@/ui/primitives'

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
 * other screens; setting it in two different faces depending on which one you are
 * looking at is the kind of drift the mono rule exists to prevent.
 *
 * The mark is `aria-hidden` and the link carries its own name, so the whole
 * thing announces once, as one destination.
 *
 * Home is the catalog now, which makes this link and the Catalog tab the same
 * destination. That is not a duplicate to remove: a wordmark that does not link
 * home is a broken convention, and the tab is what says *which* screen you are
 * on. Only the tab takes `aria-current`.
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

/**
 * The two glyphs, drawn rather than imported.
 *
 * Both are 18px line drawings on a 24px grid in `currentColor`, so they take the
 * tile's own colour in all three states and need no separate active variant. A
 * four-pane grid for the catalog and a cube for the builder, which is the
 * mockup's pairing and is the plainest available reading of "a lot of tiles" and
 * "one thing built out of them". `aria-hidden`, because the label beside them
 * says the same thing in words.
 *
 * Inline, and not an icon dependency: two 18-pixel drawings do not justify a
 * package, and every icon set in the ecosystem ships a font or a component per
 * glyph. `stroke-width: 1.5` matches the 1px hairlines the rest of the chrome is
 * drawn with once it is scaled down.
 */
const GLYPHS = {
  catalog: (
    <>
      <rect x="3.75" y="3.75" width="7" height="7" rx="1" />
      <rect x="13.25" y="3.75" width="7" height="7" rx="1" />
      <rect x="3.75" y="13.25" width="7" height="7" rx="1" />
      <rect x="13.25" y="13.25" width="7" height="7" rx="1" />
    </>
  ),
  builder: (
    <>
      <path d="M12 2.75 20.5 7.25v9.5L12 21.25 3.5 16.75v-9.5Z" />
      <path d="M3.5 7.25 12 11.75l8.5-4.5" />
      <path d="M12 11.75v9.5" />
    </>
  ),
} as const

function NavGlyph({ shape }: { shape: keyof typeof GLYPHS }) {
  return (
    <svg
      className="of-nav-glyph"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[shape]}
    </svg>
  )
}

interface NavTabProps {
  to: '/' | '/builder'
  label: string
  shape: keyof typeof GLYPHS
  /** Omitted for Catalog, which has no count. */
  count?: { value: number; singular: string; plural: string }
}

/**
 * One tile.
 *
 * `activeOptions` is where the catalog's move to `/` is paid for, and both
 * halves of it are `Link` defaults that were harmless at `/catalog`:
 *
 *   - **`exact: true`.** The default match is a prefix match, and every pathname
 *     in the app begins with `/`, so a `Link to="/"` is otherwise active on the
 *     builder as well.
 *   - **`includeSearch: false`.** The default compares search params too, so a
 *     tab whose link carries none stops matching the moment the user types a
 *     query or picks a facet — un-lighting the tab for the screen they are
 *     looking at. The tab is about *which screen*, and the filters are not part
 *     of that question.
 *
 * `shell.test.tsx` has a case for each, because both fail silently: the app
 * still navigates, it just marks the wrong thing.
 */
function NavTab({ to, label, shape, count }: NavTabProps) {
  return (
    <Link
      to={to}
      className="of-nav-tab"
      activeOptions={{ exact: true, includeSearch: false }}
      // The router decides what is active; this only mirrors that decision into
      // the accessibility tree, where `data-status` is not visible.
      activeProps={{ 'aria-current': 'page' }}
    >
      <NavGlyph shape={shape} />
      <span className="of-nav-label">
        {label}
        {count === undefined ? null : (
          <>
            <Chip tone="count">
              <span aria-hidden="true">{NUMBER.format(count.value)}</span>
            </Chip>
            <VisuallyHidden>{`, ${plural(count.value, count.singular, count.plural)}`}</VisuallyHidden>
          </>
        )}
      </span>
    </Link>
  )
}

export interface RailProps {
  /**
   * Ref callback for the node screens portal their sidebar into.
   *
   * Passed down from `AppFrame`, which holds it as state — see `railSlot.tsx`
   * for why it is state and not a ref.
   */
  slotRef: (node: HTMLDivElement | null) => void
}

export function Rail({ slotRef }: RailProps) {
  const placementCount = usePlacementCount()

  return (
    <div className="of-rail">
      <header className="of-rail-head">
        <Wordmark />
        <nav className="of-nav" aria-label="Sections">
          <NavTab to="/" label="Catalog" shape="catalog" />
          <NavTab
            to="/builder"
            label="Builder"
            shape="builder"
            count={{ value: placementCount, singular: 'tile placed', plural: 'tiles placed' }}
          />
        </nav>
      </header>
      {/* Empty until the screen fills it, and empty on the not-found boundary,
          which has no sidebar of its own. */}
      <div className="of-rail-slot" ref={slotRef} />
    </div>
  )
}

/**
 * One catalog card, and the sprite-sheet thumbnail inside it.
 *
 * design-contract.md §2.2: a 4:3 thumbnail well, the title, a mono size chip,
 * the texture set name, the mono file size, and a full-width library toggle. Both
 * components here are exported for row 14, which renders "a lighter variant of
 * the catalog card" and should not reinvent the sprite maths.
 *
 * ## The card has a fixed height, and that is a requirement rather than styling
 *
 * `VirtuosoGrid` measures one item and assumes every other item is the same size.
 * If a card grew a line — a two-line title where its neighbour has one, a missing
 * size chip — the virtualiser's estimate of total scroll height would be wrong by
 * a few pixels per row, and by hundreds of pixels 40 rows down: the scrollbar
 * drifts and the grid jumps when it corrects. So the title is clamped to two
 * lines at a fixed height, the texture line to one, and the size chip renders an
 * em dash rather than disappearing. `catalog.css` holds the numbers.
 *
 * ## The thumbnails are 2×5 sprite sheets, and they are the screen's real cost
 *
 * There is no thumbnail derivative yet — PR 20 owns that — so the only image in
 * the bucket is the sheet the detail viewer uses: **2 rows × 5 columns of 512 px
 * frames, ~529 KB each**, at `/sprites/{md5[:6]}/{md5}.png`. Frame 0 is shown by
 * clipping the sheet, and the consequences are dealt with as follows:
 *
 *   - **`<img>`, not `background-image`.** A background cannot be lazily loaded
 *     and has no intrinsic size, so a screenful of them is a screenful of
 *     immediate requests. This `<img>` carries `width`/`height` (the sheet's real
 *     2560×1024, so the aspect ratio is reserved before it lands),
 *     `loading="lazy"` and `decoding="async"`.
 *   - **The clip is a square box with the sheet scaled to `cols × 100%` by
 *     `rows × 100%`.** The rendered image is therefore 5× the frame's width and
 *     2× its height — which is exactly what makes this expensive, and is measured
 *     in the PR notes. Nothing can be done about it inside this PR; the WebP
 *     derivative is the fix.
 *   - **The frame box is square inside the 4:3 well**, so the frame is never
 *     distorted and the well keeps its radial gradient at the sides.
 *   - **The sheets are blue**, not grey — `stl-thumb`'s default Phong material.
 *     v1 accepts a blue grid beside tinted 3D views (architecture-plan.md §8).
 *     They are deliberately **not** CSS-tinted: a `filter` over a lit render
 *     produces a muddy wash, and it would also be a lie about a colour the
 *     material registry has a real answer for.
 *   - **One live tile has no sheet at all** (`CatalogRecord.sprite` is `false` for
 *     exactly one of 8,702). It gets a mono "no render" plate rather than a
 *     broken-image glyph.
 */
import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'

import type { BlobId, CatalogAssets, CatalogRecord, SpriteSheet } from '@/catalog'
import { shardedPath } from '@/catalog'
import { MATERIALS, resolveMaterial } from '@/materials'
import { toggleLibrary, useIsInLibrary } from '@/store'
import { Chip, Eyebrow, VisuallyHidden } from '@/ui/primitives'

import { fileSizeLabel, humaniseSegment, sizeLabel } from './format'

/* ----------------------------------------------------------------- thumbnail */

export interface TileThumbProps {
  blob: BlobId
  /** `CatalogRecord.sprite` — whether a sheet exists at all. */
  sprite: boolean
  assets: CatalogAssets
  sheet: SpriteSheet
  /** Which of the 10 camera angles to show. Frame 0 is the default view. */
  frame?: number
  className?: string
}

/** One frame of a tile's sprite sheet, in a 4:3 radial-gradient well. */
export function TileThumb({ blob, sprite, assets, sheet, frame, className }: TileThumbProps) {
  const index = frame ?? sheet.defaultFrame
  const column = index % sheet.cols
  const row = Math.floor(index / sheet.cols)

  // Geometry comes from the index's own `sprite` block, not from constants: the
  // schema holds it as data so a future sheet layout needs no code change here.
  const style = {
    '--of-sheet-cols': String(sheet.cols),
    '--of-sheet-rows': String(sheet.rows),
    '--of-sheet-x': `${String(column * -100)}%`,
    '--of-sheet-y': `${String(row * -100)}%`,
  } as CSSProperties

  return (
    <div className={['of-thumb', className].filter(Boolean).join(' ')}>
      {sprite ? (
        <div className="of-thumb-frame" style={style}>
          <img
            className="of-thumb-sheet"
            src={`${assets.sprites}/${shardedPath(blob)}.png`}
            width={sheet.cols * sheet.tile}
            height={sheet.rows * sheet.tile}
            loading="lazy"
            decoding="async"
            // Decorative: the card's title is the tile's name, and a second
            // reading of it here would make every card announce twice.
            alt=""
          />
        </div>
      ) : (
        <Eyebrow className="of-thumb-missing">no render</Eyebrow>
      )}
    </div>
  )
}

/* ---------------------------------------------------------------------- card */

export interface TileCardProps {
  record: CatalogRecord
  /** The record's de-interned tags, for the material swatch. */
  tags: readonly string[]
  assets: CatalogAssets
  sheet: SpriteSheet
}

export function TileCard({ record, tags, assets, sheet }: TileCardProps) {
  const material = resolveMaterial(tags, record.file)

  return (
    <article className="of-card">
      {/*
        A real link, so the drawer is reachable by keyboard, middle-click and
        copy-link — and so `?tile=` is what a shared card URL looks like. The
        drawer that reads the param is PR 15's (`src/screens/detail/**`); until it
        lands the param is inert, which is the correct interim state for a URL
        contract PR 6 already validates.
      */}
      <Link className="of-card-open" to="/catalog" search={(prev) => ({ ...prev, tile: record.ord })}>
        <TileThumb blob={record.blob} sprite={record.sprite} assets={assets} sheet={sheet} />
        <h2 className="of-card-title">{record.name}</h2>
      </Link>

      <p className="of-card-texture">
        {/*
          The material the 3D views will tint this mesh with (PR 8), as a dot
          beside the texture set it was resolved from. Supplementary and
          aria-hidden: the set name is right next to it, so the colour is never
          the only carrier of anything.
        */}
        <span
          className="of-card-swatch"
          style={{ background: material.family.tint }}
          title={MATERIALS[material.material].label}
          aria-hidden="true"
        />
        {record.texture === undefined ? 'Untextured' : humaniseSegment(record.texture)}
      </p>

      <p className="of-card-meta">
        <Chip tone="size">{sizeLabel(record.foot, record.sizeCode)}</Chip>
        <span className="of-card-bytes">{fileSizeLabel(record.bytes)}</span>
      </p>

      <LibraryToggle record={record} />
    </article>
  )
}

/* ------------------------------------------------------------ library toggle */

/**
 * "+ Add to library" / "✓ In library".
 *
 * §2.2 changes the visible label with the state, so the accessible name changes
 * with it and there is **no `aria-pressed`**: a button that announces "In
 * library" *and* "pressed" says the same thing twice, and WAI's guidance is to
 * pick one. The state is the name.
 *
 * The name also carries the tile, in clipped text after the label, so forty
 * cards do not present forty identically-named buttons to a screen reader's
 * element list. `aria-label` would have been shorter and is wrong here: it
 * replaces the accessible name outright, so the visible words would stop being
 * part of it (WCAG 2.5.3) and voice control would lose the phrase on screen.
 *
 * Subscribed through `useIsInLibrary(id)`, which selects a boolean: a card
 * re-renders when *its own* membership changes and not when any other tile is
 * added.
 */
export function LibraryToggle({ record }: { record: CatalogRecord }) {
  const inLibrary = useIsInLibrary(record.id)

  return (
    <button
      type="button"
      className="of-card-add"
      data-in-library={inLibrary ? '' : undefined}
      onClick={() => {
        toggleLibrary(record.id)
      }}
    >
      <span aria-hidden="true">{inLibrary ? '✓' : '+'}</span>
      <span>{inLibrary ? 'In library' : 'Add to library'}</span>{' '}
      <VisuallyHidden>{record.name}</VisuallyHidden>
    </button>
  )
}

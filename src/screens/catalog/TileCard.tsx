/**
 * One catalog card.
 *
 * design-contract.md §2.2: a 4:3 thumbnail well, the title, a mono size chip,
 * the texture set name and the mono file size. The well itself is `@/ui/thumb`,
 * which the builder's bill and the builder's palette render too; row P0 moved it
 * out of this file so all three of them, and P1's tint filters, have one owner.
 *
 * **§2.2's full-width library toggle is gone, and nothing replaces it yet.** Row
 * **A0** deleted the library, so "+ Add to library" had nowhere to add to; row
 * **C3** gives the card its action back, and it is a different action — placing
 * the item, or filling a slot with it, rather than saving it. The card is the
 * catalog's, not the builder's, so it holds no store write at all in between: the
 * only way into the builder from here is the drawer's "Use in builder", which
 * posts to the un-persisted selection channel row G5 owns.
 *
 * ## A card is one aggregate, not one file — 3,822 cards over 8,702 files
 *
 * Row A3. What changes, and what does not:
 *
 *   - **The seven facets the card already showed are hoisted, so they are read
 *     off the aggregate unchanged.** A1 measured that across all 3,822
 *     aggregates the number holding two distinct values of `name`, `kinds`,
 *     `texture`, `build`, `foot`, `sizeCode` or `rotStep` is **0**, so the title,
 *     the texture line and the size chip needed no reconciliation logic at all.
 *   - **The file size becomes a range**, because `bytes` is the one figure on the
 *     old card that genuinely varies within an item — on 1,669 aggregates. See
 *     {@link bytesRangeLabel}.
 *   - **The connection facts become the availability strip** (`availability.ts`),
 *     which answers a build question rather than printing a tag.
 *   - **A filename token joins the card**, because 131 display names are shared
 *     by 323 aggregates and a card that cannot be told from its neighbour is not
 *     a card. See {@link fileTokenLabel} for what it separates and what it does
 *     not.
 *   - **Tag chips close the remainder** — row X2, and the last row of A3's
 *     cascade. The token leaves 21 groups over 45 items identical on every other
 *     facet; measured, these chips take that to **0**, and nothing else the card
 *     could show would. {@link cardTagChips} carries the three rules and the
 *     measurement, and {@link TagStrip} the markup.
 *   - **The thumbnail still renders a file** — {@link TileAggregate.preview},
 *     A1's answer to which variant has a sprite sheet. A sprite sheet, a blob id
 *     and a material are per-file things, and an aggregate does not have them.
 *
 * ## The card has a fixed height, and that is a requirement rather than styling
 *
 * `VirtuosoGrid` measures one item and assumes every other item is the same size.
 * If a card grew a line — a two-line title where its neighbour has one, a missing
 * size chip — the virtualiser's estimate of total scroll height would be wrong by
 * a few pixels per row, and by hundreds of pixels 40 rows down: the scrollbar
 * drifts and the grid jumps when it corrects. So the title is clamped to two
 * lines at a fixed height, the texture line to one, the size chip renders an em
 * dash rather than disappearing, **the availability strip is a fixed two-line box
 * holding a variable one to four chips**, and **the tag row is a fixed single
 * line** that is empty on 1,044 of 3,822 items. `catalog.css` holds the numbers,
 * `availability.ts`'s `CHIP_BUDGET` the arithmetic behind the strip's height, and
 * `format.ts`'s `TAG_CHIP_BUDGET` the width the tag row can hold — which is why
 * that row truncates rather than wraps.
 *
 * ## The thumbnail is a sprite sheet, and it is the screen's real cost
 *
 * There is still no thumbnail derivative in the bucket — row P3 probed all
 * 8,352 candidate URLs and found 0 — so the card's well shows frame 0 of the
 * detail viewer's 2×5 sheet, ~529 KB each, and a screenful decodes hundreds of
 * megabytes. `@/ui/thumb` carries that arithmetic, the switch that will pick the
 * 256px derivative up the moment `CatalogRecord.thumb` says it exists, and the
 * "no render" plate for the one tile of 8,702 with no sheet. What stays this
 * file's decision is only *which file* is shown — {@link
 * TileAggregate.preview}, above — and which material it is tinted as, which is
 * the same `resolveMaterial` result the swatch reads.
 */
import { Link } from '@tanstack/react-router'

import type { CatalogAssets, CatalogRecord, SpriteSheet, TileAggregate } from '@/catalog'
import { MATERIALS, resolveMaterial } from '@/materials'
import { Chip, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { AvailabilityChip } from './availability'
import { availabilityChips, availabilityOf } from './availability'
import type { CardTagChip } from './format'
import { bytesRangeLabel, cardTagChips, fileTokenLabel, humaniseSegment, sizeLabel } from './format'

/* ---------------------------------------------------------------------- card */

export interface TileCardProps {
  /** The item. One card, whatever its variant count. */
  item: TileAggregate
  /**
   * The record behind {@link TileAggregate.preview} — the variant whose sprite
   * sheet, blob and material the card renders.
   *
   * Passed in rather than resolved here: `TileGrid` already holds the engine
   * that maps an id to a record, and a card that did its own lookup would need
   * the engine too and would have to handle a miss it cannot handle.
   */
  preview: CatalogRecord
  /** The preview record's de-interned tags, for the material swatch. */
  tags: readonly string[]
  assets: CatalogAssets
  sheet: SpriteSheet
}

export function TileCard({ item, preview, tags, assets, sheet }: TileCardProps) {
  const material = resolveMaterial(tags, preview.file)
  const token = fileTokenLabel(preview.file)
  const texture = item.texture === undefined ? 'Untextured' : humaniseSegment(item.texture)
  const size = sizeLabel(item.foot, item.sizeCode)

  return (
    <article className="of-card">
      {/*
        A real link, so the drawer is reachable by keyboard, middle-click and
        copy-link — and so `?tile=` is what a shared card URL looks like.

        It still carries the *preview variant's* manifest ordinal and not the
        aggregate's address: row A4 owns `?tile=` and types it as a
        `ManifestOrdinal`, resolving ordinal → file → design → aggregate with that
        variant selected. A1 brands `AggregateAddress` precisely so it cannot be
        handed to a param expecting an ordinal — an aggregate can split, and a
        link that persisted a derived grouping's identity would rot.
      */}
      <Link className="of-card-open" to="/catalog" search={(prev) => ({ ...prev, tile: preview.ord })}>
        {/*
          `material.material` is the same resolution the swatch below uses, so
          the dot and the tint cannot disagree about what this tile is made of —
          which they would if this passed `item.texture` instead. Row P3.
        */}
        <TileThumb
          blob={preview.blob}
          sprite={preview.sprite}
          thumb={preview.thumb}
          assets={assets}
          sheet={sheet}
          material={material.material}
        />
        <h2 className="of-card-title">{item.name}</h2>
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
        {texture}
      </p>

      <p className="of-card-meta">
        <Chip tone="size">{size}</Chip>
        {/*
          The filename's variant token, between the size and the bytes because
          all three are the same kind of fact — a measured property of the thing,
          set in mono per design-contract.md §1. It is what tells two of the 323
          same-named cards apart; `fileTokenLabel` carries the measurement.

          Empty on 40 aggregates, and then nothing is rendered — the span stays so
          the line's height cannot depend on it.
        */}
        <span className="of-card-token">{token}</span>
        <span className="of-card-bytes">{bytesRangeLabel(item.bytesRange)}</span>
      </p>

      <AvailabilityStrip item={item} />

      {/*
        The design contract's tag chips. They were last *before* the toggle as
        §2.2 lists them and are simply last since row A0. What the card has
        already said is passed in rather than re-derived, so the suppression rule
        is measured against the exact strings above.
      */}
      <TagStrip tags={tags} said={[item.name, texture, size]} />
    </article>
  )
}

/* ------------------------------------------------------------- availability */

/**
 * The availability chips — see `availability.ts` for what they say and why
 * magnetic has no side state.
 *
 * A `<ul>`, because it is a list of independent claims about one item rather
 * than a sentence; a screen reader announces "list, 3 items" and can step
 * through them. Each chip's accessible name is its visible label plus a clipped
 * sentence: "Base optional" alone does not say optional between what, and the
 * fill difference that distinguishes `underside` from `sides` is not available to
 * a reader who cannot see it.
 *
 * `data-kind` and `data-state` rather than composed class names, so every colour
 * and fill lives in `catalog.css` and this component holds none.
 */
export function AvailabilityStrip({ item }: { item: TileAggregate }) {
  const chips = availabilityChips(availabilityOf(item))

  return (
    <ul className="of-avail-strip" aria-label="Availability">
      {chips.map((chip) => (
        <AvailabilityChipItem chip={chip} key={chip.key} />
      ))}
    </ul>
  )
}

function AvailabilityChipItem({ chip }: { chip: AvailabilityChip }) {
  return (
    <li className="of-avail" data-kind={chip.kind} data-state={chip.state}>
      {chip.label} <VisuallyHidden>— {chip.hint}</VisuallyHidden>
    </li>
  )
}

/* ----------------------------------------------------------------- tag chips */

/**
 * The tag row — design-contract.md §2.2's tag chips, and A3's last facet.
 *
 * A `<ul>` for the same reason the availability strip is one: it is a list of
 * independent claims about one item, so a screen reader announces its length and
 * can step through it. Each chip prints the tag's last segment and carries the
 * segments above it as clipped text, because a one-word label is often only
 * meaningful in its path — `Imperial` does not say imperial *what*, and
 * `interface · secret door · magnetic` does.
 *
 * The row is **always rendered**, empty on 1,044 of 3,822 items, because
 * `VirtuosoGrid` assumes a uniform item height and a row that disappeared on a
 * quarter of the cards would drift the scroll position. It has no `aria-label`
 * when it is empty: an empty list announced as "Tags, list, 0 items" is noise
 * about a card that simply has nothing left to say.
 *
 * There is no `showTags` prop. §2.2 describes one, defaulting off; it would have
 * exactly one call site, which always passes it, and defaulting it off would ship
 * the 45 indistinguishable cards this row exists to fix. The prop is reported
 * back to the contract rather than implemented.
 */
export function TagStrip({ tags, said }: { tags: readonly string[]; said: readonly string[] }) {
  const chips = cardTagChips(tags, said)

  return (
    <ul className="of-card-tags" {...(chips.length === 0 ? {} : { 'aria-label': 'Tags' })}>
      {chips.map((chip) => (
        <TagChipItem chip={chip} key={chip.tag} />
      ))}
    </ul>
  )
}

function TagChipItem({ chip }: { chip: CardTagChip }) {
  return (
    <li>
      <Chip tone="tag">
        {chip.label}
        {chip.hint === '' ? null : <VisuallyHidden> — {chip.hint}</VisuallyHidden>}
      </Chip>
    </li>
  )
}

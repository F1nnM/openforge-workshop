/**
 * "Other sizes in this family" — the buttons at the foot of the drawer.
 *
 * The family is `CatalogRecord.family`, which is `dirname(full_name)`: a Dropbox
 * folder, 1,130 of them, holding the size variants of one design. That is the
 * right axis for this list and the wrong one for anything else — it is *not* the
 * material family, which resolves from the texture tag through the registry.
 *
 * ## Deduped by footprint, not listed per file
 *
 * A family holds up to 64 records but at most **24 distinct footprints** (median
 * 4), because each size is filed once per connection variant — 2.28 files per
 * design corpus-wide. Listing files would show "1×1" eight times over. So the
 * list is keyed by the footprint label and shows one entry per distinct size,
 * and the current tile's own size is dropped: what remains is exactly "other
 * sizes", which is what the contract asks for.
 *
 * Among the files sharing a footprint, the representative is chosen
 * deterministically — lowest manifest ordinal — so the same button always leads
 * to the same tile and a share of the drawer's URL is stable.
 *
 * ## Sorting
 *
 * By footprint area where there is one, then by label, so a family reads
 * 1×1, 1×2, 2×2 rather than in import order. Arcs sort by radius and walls by
 * length, which puts each kind in its own ascending run.
 */
import type { CatalogFile, CatalogRecord, ManifestOrdinal } from '@/catalog'

import { footprintLabel } from './labels'

export interface FamilyVariant {
  /** The tile the button swaps the drawer to. */
  ord: ManifestOrdinal
  /** The footprint label — the button's text, and the dedupe key. */
  label: string
  /** The representative record's display name, for the button's `title`. */
  name: string
}

/** Sort weight: area for a rectangle, length for a wall, radius for an arc. */
function extent(record: CatalogRecord): number {
  const foot = record.foot
  switch (foot.shape) {
    case 'rect':
      return foot.w * foot.d
    case 'wall':
      return foot.length
    case 'arc':
      return foot.radius
    case 'none':
      return Number.POSITIVE_INFINITY
  }
}

/**
 * The other distinct sizes in a tile's family, deduped and sorted.
 *
 * Linear over the index by design: 8,702 records is a sub-millisecond scan and
 * an index keyed by family would have to be built, memoised and invalidated for
 * a list that is rendered once per drawer open.
 */
export function familyVariants(catalog: CatalogFile, record: CatalogRecord): FamilyVariant[] {
  const own = footprintLabel(
    record,
    record.tags.map((id) => catalog.tags[id] ?? ''),
  ).text

  const best = new Map<string, { record: CatalogRecord; weight: number }>()

  for (const candidate of catalog.records) {
    if (candidate.family !== record.family) continue
    if (candidate.id === record.id) continue

    const label = footprintLabel(
      candidate,
      candidate.tags.map((id) => catalog.tags[id] ?? ''),
    ).text
    if (label === own) continue

    const held = best.get(label)
    if (held === undefined || candidate.ord < held.record.ord) {
      best.set(label, { record: candidate, weight: extent(candidate) })
    }
  }

  return [...best]
    .map(([label, held]) => ({ label, ord: held.record.ord, name: held.record.name, weight: held.weight }))
    .sort((a, b) => a.weight - b.weight || a.label.localeCompare(b.label))
    .map(({ label, ord, name }) => ({ label, ord, name }))
}

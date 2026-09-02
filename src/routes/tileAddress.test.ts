/**
 * What `?tile=` addresses, proved against a corpus whose ordinals were chosen to
 * separate the two number spaces.
 *
 * The subject of row A4 is an ambiguity, not a feature: an `AggregateAddress` is
 * the lowest `ManifestOrdinal` in its group, so the same integer is well-formed
 * under either reading. A fixture of singletons would pass every test below while
 * confusing them completely, which is why `OVERLAP` has one group of two.
 *
 * One test here is type-level and invisible at runtime. The `@ts-expect-error` on
 * {@link tileOrdinal} is the routing half of A1's claim: if `AggregateAddress`
 * ever became assignable to a URL subject the suppression would go unused and
 * `npm run typecheck` would fail. A1's own pair proves the brands are distinct;
 * this proves the distinction reaches the address bar.
 */
import { describe, expect, it } from 'vitest'

import type { AggregateIndex, DesignId, ManifestOrdinal, TileAggregate } from '@/catalog'
import { aggregateAddress, buildAggregateIndex } from '@/catalog'

import { OVERLAP, SPLIT, catalogOf } from './fixture'
import { resolveTileTarget, tileOrdinal } from './tileAddress'

const ord = (n: number) => n as ManifestOrdinal

const overlap: AggregateIndex = buildAggregateIndex(catalogOf(OVERLAP))
const split: AggregateIndex = buildAggregateIndex(catalogOf(SPLIT))

/** The `d1` aggregate — two variants before the split, one after. */
function itemOf(index: AggregateIndex, design: string): TileAggregate {
  const aggregate = index.byDesign.get(design as DesignId)
  if (aggregate === undefined) throw new Error(`design ${design} is not in the index`)
  return aggregate
}

const pairItem = itemOf(overlap, 'd1')

describe('the fixture separates the two number spaces', () => {
  it('has one group of two, so a non-minimum ordinal exists', () => {
    expect(overlap.aggregates).toHaveLength(2)
    expect(pairItem.variants.map((variant) => variant.ord)).toEqual([4, 9])
    expect(pairItem.address as unknown as number).toBe(4)
  })
})

describe('resolveTileTarget', () => {
  it('reads no tile param as a closed drawer', () => {
    expect(resolveTileTarget(overlap, null)).toEqual({ state: 'closed' })
  })

  it('resolves an ordinal to the item and the variant that ordinal named', () => {
    const target = resolveTileTarget(overlap, ord(9))
    expect(target.state).toBe('open')
    if (target.state !== 'open') return
    expect(target.aggregate.design).toBe('d1')
    expect(target.variant.id).toBe('tiles/x/openlock/wall.openlock.stl')
    expect(target.variant.ord).toBe(9)
  })

  it('resolves every ordinal in the corpus, minimum or not', () => {
    for (const ordinal of [4, 9, 12]) {
      expect(resolveTileTarget(overlap, ord(ordinal)).state).toBe('open')
    }
  })

  it('reports an ordinal no index has heard of as unknown, carrying the number', () => {
    // Ordinals are append-only and never reissued, so a link can outlive the
    // index a visitor is holding. That is a state the drawer must be able to
    // name, not a closed drawer with `?tile=` still in the address bar.
    expect(resolveTileTarget(overlap, ord(999_999))).toEqual({ state: 'unknown', ord: 999_999 })
  })

  it('marks the group minimum canonical and every other variant not', () => {
    const minimum = resolveTileTarget(overlap, ord(4))
    const other = resolveTileTarget(overlap, ord(9))
    expect(minimum.state === 'open' && minimum.canonical).toBe(true)
    expect(other.state === 'open' && other.canonical).toBe(false)
  })

  it('never throws, whatever the ordinal', () => {
    for (const ordinal of [0, 1, 4, 9, 12, 999_999_999]) {
      expect(() => resolveTileTarget(overlap, ord(ordinal))).not.toThrow()
    }
  })
})

describe('the overlap, in both directions', () => {
  it('reads an address-valued number as an ordinal and lands on the same item', () => {
    // The whole reason `?tile=` can stay an ordinal: an address *is* a member
    // ordinal, so the ordinal reading of one returns the item that address names,
    // with `variants[0]` selected.
    const address = pairItem.address
    const byAddress = overlap.byAddress.get(address)
    // `ord()` is the test's own cast, and the only place in the repo that reads
    // an address's number as an ordinal. Production code has no such conversion:
    // `aggregateAddress` is one-way and `tileOrdinal` refuses an address.
    const asOrdinal = resolveTileTarget(overlap, ord(address))
    expect(asOrdinal.state).toBe('open')
    if (asOrdinal.state !== 'open') return
    expect(asOrdinal.aggregate).toBe(byAddress)
    expect(asOrdinal.variant).toBe(pairItem.variants[0])
    expect(asOrdinal.canonical).toBe(true)
  })

  it('misses entirely when a non-minimum ordinal is read as an address', () => {
    // The other direction is not total. `aggregateAddress` is the only conversion
    // A1 published, and handing it ordinal 9 — a real ordinal, not a minimum —
    // produces a well-typed address that addresses nothing. Two of the three
    // files in this fixture are group minima; over the live corpus 4,880 of the
    // 8,702 are not.
    expect(overlap.byAddress.get(aggregateAddress(ord(9)))).toBeUndefined()
    expect(overlap.byAddress.get(aggregateAddress(ord(4)))).toBe(pairItem)
  })
})

describe('a link that outlives a split', () => {
  it('still resolves the ordinal, to the item that now holds that file', () => {
    const before = resolveTileTarget(overlap, ord(9))
    const after = resolveTileTarget(split, ord(9))
    expect(before.state).toBe('open')
    expect(after.state).toBe('open')
    if (before.state !== 'open' || after.state !== 'open') return
    // The file is the same file. Only which item contains it moved, and the link
    // followed it: that is what an ordinal buys over an address.
    expect(after.variant.id).toBe(before.variant.id)
    expect(after.aggregate.design).toBe('d1b')
    expect(before.aggregate.design).toBe('d1')
    // It was one variant of two, and is now the only variant of its own item.
    expect(before.canonical).toBe(false)
    expect(after.canonical).toBe(true)
  })

  it('is what an address-typed link could not have done', () => {
    // Address 4 survives the split as a number and keeps resolving — to a
    // strictly smaller item, silently. Nothing in the URL changed and nothing
    // errored; the link simply means something else now.
    const address = aggregateAddress(ord(4))
    expect(overlap.byAddress.get(address)?.variants).toHaveLength(2)
    expect(split.byAddress.get(address)?.variants).toHaveLength(1)
  })
})

describe('tileOrdinal', () => {
  it('passes an ordinal through', () => {
    expect(tileOrdinal(ord(9))).toBe(9)
  })

  it('takes a variant at its own ordinal', () => {
    const variant = pairItem.variants[1]
    expect(variant).toBeDefined()
    if (variant === undefined) return
    expect(tileOrdinal(variant)).toBe(9)
  })

  it('takes an aggregate at its lowest ordinal, read off the variant', () => {
    const aggregate = pairItem
    expect(tileOrdinal(aggregate)).toBe(4)
    // The value agrees with the address — they are derived from the same file —
    // but it came from `variants[0].ord`, which is a `ManifestOrdinal`. No
    // conversion out of the address brand exists, and this row added none.
    expect(tileOrdinal(aggregate)).toBe(aggregate.address)
  })

  it('names the address holder rather than the preview, whichever the preview is', () => {
    // `SearchResult.ids` names the variant a *card* renders — the first with a
    // sprite sheet — and `engine.ts` says outright that it is not an addressing
    // scheme. The rule this pins is that the link is `variants[0]`, so a change
    // to how a preview is picked cannot move anybody's URL.
    expect(tileOrdinal(pairItem)).toBe(pairItem.variants[0].ord)
    expect(overlap.byTile.get(pairItem.preview)?.ord).toBeDefined()
  })

  it('will not accept an aggregate address', () => {
    const address = aggregateAddress(ord(4))
    // @ts-expect-error an aggregate address is not something a `?tile=` can carry
    expect(() => tileOrdinal(address)).not.toThrow()
  })
})

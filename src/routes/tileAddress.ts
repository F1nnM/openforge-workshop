/**
 * What `?tile=` addresses, and how the number in it becomes an item.
 *
 * Before aggregation this was one hop: `?tile=N` named a record and the drawer
 * rendered it. Row A1 makes the catalog **3,822 aggregates over 8,702 files**, so
 * the drawer shows an *item* while the URL still has to name something stable —
 * and those are not the same object. This module is the join, and it is routing
 * rather than screen code for the same reason `tileDrawer.ts` is: the URL is the
 * app's state, so what a URL *means* belongs beside what it does.
 *
 * ## `?tile=` stays a `ManifestOrdinal`
 *
 * Three readings were available: keep the ordinal, switch to an
 * `AggregateAddress`, or accept both.
 *
 * **The two number spaces overlap.** An address *is* the lowest ordinal in its
 * group, so `4` is a well-formed value under either reading and a bare number
 * cannot say which one was meant. "Accept both" is therefore not the union of the
 * two options, it is an ambiguity: it needs a second parameter or a sigil, and it
 * then has to answer what a URL carrying both of them means.
 *
 * **The overlap collapses in one direction, and only one.** Read an address as an
 * ordinal and you land on exactly the item that address names: the address holder
 * is `variants[0]`, its `design` is the group's key, and the two hops below return
 * that aggregate with its first variant selected. Read an ordinal as an address
 * and **4,880 of the 8,702 files** — every file that is not its group's lowest —
 * miss `byAddress` entirely; the 3,822 that do hit it are exactly the minima, the
 * cases where the two readings already agree. So the ordinal reading is a strict
 * refinement of the address reading, and it is the only one of the two that is
 * total. Keeping the ordinal is not a compromise made to preserve old links; the
 * old links survive because the reading that is correct is also the one they used.
 *
 * **An aggregate can split, which is the deciding argument.** A1 branded the
 * address and kept it out of the manifest precisely because the grouping is
 * derived: a design-key change splits one item in two, and the address of the
 * group that no longer exists becomes the address of one of the halves. An
 * ordinal survives that, because it names a **file** — files do not split, ordinals
 * are never reissued, and `byOrdinal` still reaches whichever aggregate now holds
 * that file. A link written before a split lands on the item containing the tile
 * the link meant, which is the only answer that is right in every split. An
 * address-typed link would keep resolving and quietly mean a different, smaller
 * item.
 *
 * **Backward compatibility costs nothing here, so it is not the reason.** Nothing
 * is deployed (`docs/v2-pr-series.md`), so no stored state needs converting; a
 * `?tile=` that already exists in somebody's notes keeps working as a consequence
 * of the argument above rather than as a constraint on it.
 *
 * A name-based URL was never a candidate: **131 display names are shared by 323
 * aggregates**, so `?tile=corner-wall` would be ambiguous on 8.5% of the catalog.
 *
 * ## The two brands stay un-confusable
 *
 * Nothing in this module turns an `AggregateAddress` into a number.
 * `aggregateAddress` has deliberately no inverse and this module does not want
 * one: to write a `?tile=` for an item you call {@link tileOrdinal}, which reads
 * `variants[0].ord` — a real `ManifestOrdinal` taken off a variant, never off
 * `address`. The address keeps doing exactly what A1 published it for, `byAddress`
 * lookups and document order, and never reaches a URL. That is why the
 * `@ts-expect-error` pair in `src/catalog/aggregate.test.ts` is still the whole of
 * the claim: this row added no conversion for it to have to tolerate.
 *
 * ## Resolution
 *
 * `?tile=N` → `byOrdinal.get(N)` → the variant's `design` → `byDesign.get(design)`
 * → the aggregate, with the named variant selected. Two hops, both published by
 * A1 and both `O(1)`; the path is the one `aggregate.test.ts` tests directly.
 *
 * Neither hop is total, so {@link resolveTileTarget} has three answers rather than
 * an aggregate-or-undefined. A closed drawer and a link naming a tile this index
 * has never heard of are different states and the drawer must say so — ordinals
 * are append-only and never reissued, so a link can outlive the index it was
 * written against, and rendering that as "closed" would leave `?tile=` in the
 * address bar with an empty screen behind it.
 */
import type { AggregateIndex, ManifestOrdinal, TileAggregate, TileVariant } from '@/catalog'

/**
 * Anything that can name a tile in a URL.
 *
 * An aggregate is accepted because a card, a grid cell and a variants row all
 * hold one and none of them should have to know which of its variants supplies
 * the number. An `AggregateAddress` is **not** in this union and cannot be
 * widened into it — it is a distinct brand over `number`, so passing one is a
 * compile error rather than a link to the wrong item.
 */
export type TileSubject = ManifestOrdinal | TileAggregate | TileVariant

/**
 * The number a `?tile=` link carries for a subject.
 *
 * For an aggregate this is `variants[0].ord`: the lowest ordinal in the group,
 * which is the same file the address is derived from and the most stable member
 * the group has (ordinals are append-only, so a later import cannot take the
 * lowest slot). It is read off the **variant**, which is what keeps the address
 * brand out of the URL entirely.
 *
 * Deliberately not `preview`. `SearchResult.ids` picks the variant a card should
 * *render* — the first with a sprite sheet — and `engine.ts` says outright that
 * it is not an addressing scheme and nothing should persist it. A link built from
 * a preview id would freeze a rendering choice into somebody's URL.
 */
export function tileOrdinal(subject: TileSubject): ManifestOrdinal {
  if (typeof subject === 'number') return subject
  return 'variants' in subject ? subject.variants[0].ord : subject.ord
}

/**
 * What the drawer should be showing for the current `?tile=`.
 *
 * Three states, because the drawer needs to distinguish all three and a
 * `TileAggregate | undefined` collapses two of them. Exhaustive on `state`, so a
 * fourth case cannot be added without the consumer failing to compile.
 */
export type TileTarget =
  /** No `tile` param, or one the schema rejected. The drawer is shut. */
  | { readonly state: 'closed' }
  /**
   * A well-formed ordinal that is in no index this session loaded.
   *
   * A rotted or forward-dated link, not a bug: ordinals are append-only and never
   * reissued, so a number can outlive the index a visitor is holding. The ordinal
   * is carried through so the drawer can name it.
   */
  | { readonly state: 'unknown'; readonly ord: ManifestOrdinal }
  | {
      readonly state: 'open'
      /** The item — the drawer's subject, and what the variants table enumerates. */
      readonly aggregate: TileAggregate
      /**
       * The variant the URL named, always one of `aggregate.variants`.
       *
       * The URL wins over any preference: `?tile=` names a file, and a link that
       * silently showed a different print than the one it addressed would make
       * the number in it decorative.
       */
      readonly variant: TileVariant
      /**
       * `true` when the URL named `variants[0]` — the address holder.
       *
       * This is as far as an overlapping number space can be disambiguated, and it
       * is the honest form of the question "did this link ask for the item, or for
       * this print of it?". A link to the address holder is indistinguishable from
       * a link to the item, so a consumer that wants to apply the build's lock
       * preference may do so when this is `true` and must not when it is `false`.
       */
      readonly canonical: boolean
    }

/** Allocated once: a closed drawer is the common case and carries no data. */
const CLOSED: TileTarget = { state: 'closed' }

/**
 * Resolve a validated `tile` search param against the aggregate layer.
 *
 * Takes the derived {@link AggregateIndex} rather than a `CatalogFile`, so the
 * two hops are the maps A1 already built. `buildAggregateIndex` is a pure
 * function of the file and memoisable on its version stamp — the same contract
 * `createSearchEngine` offers, and whoever holds an engine can pass
 * `engine.aggregates` straight in.
 *
 * Never throws. Every failure is a state.
 */
export function resolveTileTarget(index: AggregateIndex, tile: ManifestOrdinal | null): TileTarget {
  if (tile === null) return CLOSED

  const variant = index.byOrdinal.get(tile)
  if (variant === undefined) return { state: 'unknown', ord: tile }

  const aggregate = index.byDesign.get(variant.design)
  // Unreachable against an index from `buildAggregateIndex` — every variant is
  // created from a record that was put in a group keyed by that same `design`.
  // Reported as `unknown` rather than asserted, because the alternative to a
  // state here is a thrown error inside a render.
  if (aggregate === undefined) return { state: 'unknown', ord: tile }

  return {
    state: 'open',
    aggregate,
    variant,
    canonical: variant.ord === aggregate.variants[0].ord,
  }
}

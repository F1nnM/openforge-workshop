/**
 * The ordinal ↔ tile ↔ design mapping a share link is written against, and the
 * checksum that detects it having moved underneath a link.
 *
 * ## Why a link carries ordinals at all
 *
 * A `TileId` is the fixture `full_name`:
 * `tiles/cave/thick_wall/wall/corner/openlock/cave%aggregate+2#corner.IL+corner,90.openlock.stl`
 * — 92 characters here, 39 to 183 across the corpus, and it contains `#`, `%`
 * and `+`, so a single unescaped copy-paste truncates the URL at the `#`. The
 * manifest ordinal is at most four digits and encodes to two varint bytes. That
 * ratio *is* the share link: at ~50 characters per placement a link holds about
 * thirty tiles, at two bytes it holds hundreds to tens of thousands.
 * `src/routes/tileDrawer.ts` already addresses a tile by ordinal for the same
 * reason, so this is the app's one URL currency for a tile rather than a second
 * scheme.
 *
 * ## Why a *design* still travels as an ordinal — row V4
 *
 * A placement names a {@link DesignId} now, and the obvious move would be to put
 * one on the wire: it is 13 characters flat against a `TileId`'s 39–183, which
 * looks like a saving of 26 to 170 characters per placement. **It is not a
 * saving at all, and this is the arithmetic that says so.** The codec has never
 * written a `TileId`; it writes an *ordinal*, which is one or two varint bytes,
 * and 13 raw characters is 6 to 13 times worse than that. A design id on the
 * wire would also need its own dedup table to stop repeating, which is what the
 * ordinal column gets for free from deflate.
 *
 * So a design travels as **the lowest {@link ManifestOrdinal} among its files**
 * — which is A1's {@link AggregateAddress}, computed here from the records
 * rather than imported, because this module's dependency is two fields per
 * record and building an aggregate index to read one number would pull the whole
 * derivation into the codec. Encoding takes that ordinal for determinism (two
 * shares of one scene must produce one link); decoding accepts **any** ordinal
 * of any variant and resolves it to the design, through {@link designOf}.
 *
 * That asymmetry is deliberate and it is what makes a version 2 link readable:
 * a v2 payload carried the ordinal of the exact file the user placed, and
 * resolving *that* ordinal to its design gives the design they placed. See
 * `payload.ts#SHARE_FORMAT_VERSION`.
 *
 * The cost of the address's known instability — A1: *"NOT stable under
 * retirement"* — is bounded and is a straight trade against what file addressing
 * cost. Under files, retiring **any** file dropped every placement of it. Under
 * design addressing, retiring the lowest-ordinal file of a design drops every
 * placement of that design, and retiring any other file of it drops nothing;
 * 1,705 of 3,822 designs (44.6%) hold two or more files, so the second case is
 * the common one and it used to be a loss. Either way the failure is the same
 * `unresolved` report the checksum blind spot already has words for, never a
 * plausible wrong room.
 *
 * ## The risk this module exists to manage
 *
 * `src/catalog/schema.ts#ManifestOrdinal` states the append-only invariant and
 * architecture-plan.md §13 names breaking it "the worst silent failure in the
 * system": a link encodes integers, so if an import ever reorders them, **every
 * existing link decodes to a different room, with no error anywhere.** Not a
 * crash, not an empty scene — a plausible wrong answer.
 *
 * Two defences, and they catch different failures:
 *
 *   1. **The manifest version**, `CatalogFile.version.manifest`, travels in every
 *      payload. It is bumped only when the invariant is broken *deliberately*, and
 *      a payload whose version does not match the running build is refused
 *      outright. This is the mechanism §13 specifies.
 *
 *   2. **A 32-bit checksum over the (ordinal, tile id) pairs the link actually
 *      references**, also in the payload. This catches the invariant broken *by
 *      accident* — the case where nobody bumped the version because nobody
 *      realised. It is scoped to the referenced pairs rather than to the whole
 *      manifest precisely so that **appending tiles does not invalidate old
 *      links**, which is the entire point of an append-only manifest. Four bytes,
 *      once per payload, regardless of how many placements share an ordinal.
 *
 * Defence 2 has one blind spot, and it is named rather than papered over. A link
 * may reference an ordinal that this build cannot resolve — the tile was retired
 * from the corpus, which the invariant explicitly permits (rule 3: the slot stays
 * reserved, the record does not ship). The checksum then cannot be recomputed,
 * because the missing tile id was part of it. In that case the placement is
 * dropped, the checksum is reported as unverified, and the caller is told so —
 * rather than being told "drift", which would be a false alarm for a legal import.
 */
import type { DesignId, ManifestOrdinal, TileId } from '@/catalog'

/**
 * What the codec needs from a catalog: a manifest version, and each record's
 * ordinal and design.
 *
 * Structural rather than `CatalogFile` on purpose. A parsed `CatalogFile`
 * satisfies it as-is, so the app passes one straight through; but the codec's real
 * dependency is three fields, and saying so keeps a test from having to fabricate
 * 8,702 records with a footprint and a tag list to check a checksum.
 *
 * `id` is still here and is not redundant with `design`: the **checksum** is over
 * (ordinal, tile id) pairs, because §13's failure is two ordinals swapping the
 * *files* they name, and a digest over designs would miss a swap inside one
 * design entirely.
 */
export interface ShareManifestSource {
  readonly version: { readonly manifest: number }
  readonly records: readonly {
    readonly id: TileId
    readonly ord: ManifestOrdinal
    readonly design: DesignId
  }[]
}

/** The ordinal ↔ tile ↔ design lookup, built once per catalog load. */
export interface ShareManifest {
  /**
   * `CatalogFile.version.manifest`. Written into every payload and compared on
   * every decode.
   */
  readonly version: number
  /** Tiles this build can resolve. Not the highest ordinal — ordinals are not dense. */
  readonly size: number
  /** Designs this build can resolve. 3,822 against `size`'s 8,702 on the live corpus. */
  readonly designs: number
  /**
   * The ordinal a **design** travels as — the lowest among its files — or
   * `undefined` if this build does not carry the design.
   *
   * Takes a {@link DesignId} and not a {@link TileId} since row V4, and the
   * brands are what make that a compile error rather than a lookup that misses:
   * the two spaces are separate zod brands, so a caller still handing over a
   * file id does not silently get `undefined` and drop every placement in the
   * scene.
   */
  ordinalOf(design: DesignId): ManifestOrdinal | undefined
  /**
   * Tile for an ordinal, or `undefined`.
   *
   * `undefined` has two causes and the caller cannot tell them apart: the tile was
   * retired (legal), or the link came from a newer build that had more tiles. Both
   * mean the same thing to the user — that placement cannot be restored — so both
   * are reported the same way.
   */
  tileOf(ordinal: number): TileId | undefined
  /**
   * The design an ordinal belongs to, or `undefined`.
   *
   * Total over the same population as {@link tileOf} — every record has a design
   * — so a link's ordinal resolves to a design exactly when it resolves to a
   * tile, and the two never disagree about what was lost. **Any** ordinal of any
   * variant answers, which is what lets a version 2 link (which encoded the
   * placed file) decode under version 3's reading (which encodes the design's
   * address).
   */
  designOf(ordinal: number): DesignId | undefined
}

/**
 * Build the lookup from a catalog.
 *
 * A pure function of its input, so a caller may memoise it on the catalog's
 * version stamp. Duplicate ordinals cannot occur in a validated `CatalogFile` —
 * `CatalogFile`'s `superRefine` rejects them, because a shared ordinal makes every
 * link containing it ambiguous — so this does not re-check; **first writer wins**
 * if an unvalidated source is passed, which is deterministic rather than correct
 * and is the reason validation belongs at the parse.
 *
 * The design → ordinal direction takes the **minimum** rather than the first
 * writer, and that is not tidiness: `CatalogFile.records` is emitted in ordinal
 * order today, so first-writer and minimum agree, and a link's determinism must
 * not rest on an emission order no schema states. A `Math.min` cannot be wrong
 * about it.
 */
export function buildShareManifest(source: ShareManifestSource): ShareManifest {
  const byOrdinal = new Map<number, { id: TileId; design: DesignId }>()
  const addressOf = new Map<DesignId, ManifestOrdinal>()

  for (const record of source.records) {
    if (!byOrdinal.has(record.ord)) byOrdinal.set(record.ord, { id: record.id, design: record.design })
    const current = addressOf.get(record.design)
    if (current === undefined || record.ord < current) addressOf.set(record.design, record.ord)
  }

  return {
    version: source.version.manifest,
    size: byOrdinal.size,
    designs: addressOf.size,
    ordinalOf: (design) => addressOf.get(design),
    tileOf: (ordinal) => byOrdinal.get(ordinal)?.id,
    designOf: (ordinal) => byOrdinal.get(ordinal)?.design,
  }
}

/* ----------------------------------------------------------------- checksum */

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * FNV-1a over the UTF-8 bytes of `text`.
 *
 * Not a cryptographic hash and not trying to be: the threat is a *mistaken*
 * import, not a forged link, and a forged link can only ever describe a room the
 * forger could have built by hand anyway. What it must be is cheap and stable, and
 * hashing the encoded bytes rather than the UTF-16 code units is what makes it
 * stable for an id carrying a non-ASCII character.
 */
function fnv1a32(text: string): number {
  const bytes = new TextEncoder().encode(text)
  let hash = FNV_OFFSET
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME)
  }
  return hash >>> 0
}

/** What resolving a link's ordinals against a manifest produced. */
export interface ResolvedOrdinals {
  /** Ordinal → tile, for the ordinals this build could resolve. */
  readonly tiles: ReadonlyMap<number, TileId>
  /** Referenced ordinals this build does not carry, ascending and deduplicated. */
  readonly unresolved: readonly number[]
  /**
   * Checksum over the resolved pairs.
   *
   * Comparable against a payload's digest **only when `unresolved` is empty** —
   * see the module docblock. A pair that could not be resolved was part of the
   * digest when the link was written and cannot be part of it now.
   */
  readonly digest: number
}

/**
 * Resolve a link's ordinals and checksum what they mean.
 *
 * The digest covers **distinct ordinals in ascending order**, each paired with the
 * tile id it resolves to. Two properties fall out of that, and both are needed:
 *
 *   - It is independent of placement order and of how many placements share an
 *     ordinal, so it is stable across a scene that is merely rearranged.
 *   - It includes the *ordinal* in the hashed text, not only the id. A digest over
 *     the set of ids alone would miss two referenced ordinals having swapped
 *     tiles — which is precisely the drift being guarded against.
 */
export function resolveOrdinals(ordinals: readonly number[], manifest: ShareManifest): ResolvedOrdinals {
  const distinct = [...new Set(ordinals)].sort((left, right) => left - right)
  const tiles = new Map<number, TileId>()
  const unresolved: number[] = []
  const parts: string[] = []

  for (const ordinal of distinct) {
    const tile = manifest.tileOf(ordinal)
    if (tile === undefined) {
      unresolved.push(ordinal)
      continue
    }
    tiles.set(ordinal, tile)
    parts.push(`${String(ordinal)}\u0000${tile}`)
  }

  return { tiles, unresolved, digest: fnv1a32(parts.join('\n')) }
}

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
 * Row A1 multiplied that ratio by the arity of a template rather than changing
 * it: a placement is an instance with **up to five filled slots**, so a link
 * carries three to five file addresses where it used to carry one, and the
 * choice between two bytes and 39–183 characters is made three to five times per
 * placement instead of once. `capacity.test.ts` measures what that costs.
 *
 * ## Why a *fill* travels as a file ordinal — row A5, reversing part of row V4
 *
 * A placement is a **template instance whose slots are filled with files**
 * (`src/store/schema.ts#SlotFill`, decision D1), so the thing a link has to name
 * is a file, and {@link ordinalOfTile} is the direction that names it. Row V4
 * had deleted that direction, moving `ordinalOf` from a file to a
 * {@link DesignId} on the argument that a design id is *"13 characters flat
 * against a `TileId`'s 39-183"*. **That premise was about a string this codec
 * has never put on the wire**: it writes an *ordinal*, one or two varint bytes,
 * so there was no per-character cost on either side of the choice and the
 * arithmetic decided nothing. What decides it is what a placement holds, and a
 * placement now holds files.
 *
 * Addressing the file also removes an ambiguity V4 had to introduce and live
 * with. A design's address is the **lowest ordinal among its files** - a derived
 * number, and one V4's own docblock recorded as *not* stable under retirement:
 * retire the lowest-ordinal file of a design and every link that placed that
 * design breaks, retire any other file of it and nothing breaks. A file's own
 * ordinal is append-only for ever (`src/catalog/schema.ts#ManifestOrdinal`), so
 * a fill's address is stable under exactly the invariant the whole format
 * already rests on, and there is precisely one number it can be.
 *
 * {@link ordinalOf} and {@link designOf} therefore have **no caller under
 * `src/share`** any more. They are kept because `tools/stamp/run.ts` and
 * `tools/hygiene/project.test.ts` verify the design-address round trip against
 * the real catalog on every stamp, and `tools` is not this row's to edit; a row
 * that retires that check should retire these two accessors with it.
 *
 * ## The risk this module exists to manage
 *
 * `src/catalog/schema.ts#ManifestOrdinal` states the append-only invariant and
 * architecture-plan.md §13 names breaking it "the worst silent failure in the
 * system": a link encodes integers, so if an import ever reorders them, **every
 * existing link decodes to a different room, with no error anywhere.** Not a
 * crash, not an empty scene — a plausible wrong answer.
 *
 * Two defences, and they catch different failures. Row A5 changed **what each
 * one covers** without changing either mechanism, because an ordinal in a
 * payload now names one of an instance's fills rather than a design's address:
 *
 *   1. **The manifest version**, `CatalogFile.version.manifest`, travels in every
 *      payload. It is bumped only when the invariant is broken *deliberately*, and
 *      a payload whose version does not match the running build is refused
 *      outright. This is the mechanism §13 specifies. It is a statement about the
 *      whole numbering, so it protects every ordinal in the link whatever those
 *      ordinals mean — the one of the two defences A5 leaves untouched in scope
 *      as well as in mechanism.
 *
 *   2. **A 32-bit checksum over the (ordinal, tile id) pairs the link actually
 *      references**, also in the payload. This catches the invariant broken *by
 *      accident* — the case where nobody bumped the version because nobody
 *      realised. It is scoped to the referenced pairs rather than to the whole
 *      manifest precisely so that **appending tiles does not invalidate old
 *      links**, which is the entire point of an append-only manifest. Four bytes,
 *      once per payload, regardless of how many fills share an ordinal.
 *
 *      What it covers moved, and that is the row's one real gain here. A V4 link
 *      referenced one ordinal per placement — the *design's address file* — so
 *      the digest was computed over a representative that the room need not have
 *      contained: place the second variant of a design and the checked pair was
 *      the first variant's. An A5 link references the ordinal of every fill, so
 *      the digest now covers **exactly the set of STLs the download pack would
 *      hold**, and nothing else. `link.test.ts` proves the half that is new:
 *      renumbering the file a fill actually names is drift even when that file
 *      is not its design's address.
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
 * ordinal, file id and design.
 *
 * Structural rather than `CatalogFile` on purpose. A parsed `CatalogFile`
 * satisfies it as-is, so the app passes one straight through; but the codec's real
 * dependency is three fields, and saying so keeps a test from having to fabricate
 * 8,702 records with a footprint and a tag list to check a checksum.
 *
 * `id` carries the codec: it is both what a fill names and what the **checksum**
 * is over — (ordinal, tile id) pairs, because §13's failure is two ordinals
 * swapping the *files* they name, and a digest over designs would miss a swap
 * inside one design entirely. `design` is no longer read by anything under
 * `src/share`; the module docblock says what still reads it and why it stays.
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
   * The ordinal a **file** travels as — its own — or `undefined` if this build
   * does not carry the file.
   *
   * **The direction the codec encodes with**, restored by row A5 because a
   * `SlotFill` names a file (see the module docblock). One record per ordinal
   * and one ordinal per record, so unlike {@link ordinalOf} there is nothing
   * derived about the answer and nothing for a retirement elsewhere in the
   * design to move.
   *
   * Named `ordinalOfTile` rather than reclaiming the bare `ordinalOf` only
   * because {@link ordinalOf} still has two readers under `tools`, which row A5
   * does not own. The brands mean the two cannot be confused at a call site
   * whatever they are called: a {@link TileId} and a {@link DesignId} are
   * separate zod brands, so handing one accessor the other's id is a compile
   * error rather than a lookup that silently misses and drops the scene.
   */
  ordinalOfTile(tile: TileId): ManifestOrdinal | undefined
  /**
   * The ordinal a **design** travels as — the lowest among its files — or
   * `undefined` if this build does not carry the design.
   *
   * No longer used by the codec: an A5 link addresses files. Kept for
   * `tools/stamp/run.ts`'s and `tools/hygiene/project.test.ts`'s round-trip
   * check over the real catalog — see the module docblock.
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
   * tile, and the two never disagree about what was lost.
   *
   * No longer used by the codec, for {@link ordinalOf}'s reason and kept for
   * {@link ordinalOf}'s two readers: a decoded fill is a file, and
   * {@link tileOf} is the whole of what reading one needs.
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
 *
 * The file → ordinal direction needs no such rule and that is the point of row
 * A5's restoration: the relation is one-to-one, so there is no set to take a
 * minimum over and no emission order to depend on. It is first-writer-wins for
 * the same reason `byOrdinal` is — a duplicate `id` is as impossible in a
 * validated `CatalogFile` as a duplicate `ord`, so this is a deterministic
 * answer to an unreachable question rather than a policy.
 */
export function buildShareManifest(source: ShareManifestSource): ShareManifest {
  const byOrdinal = new Map<number, { id: TileId; design: DesignId }>()
  const byTile = new Map<TileId, ManifestOrdinal>()
  const addressOf = new Map<DesignId, ManifestOrdinal>()

  for (const record of source.records) {
    if (!byOrdinal.has(record.ord)) byOrdinal.set(record.ord, { id: record.id, design: record.design })
    if (!byTile.has(record.id)) byTile.set(record.id, record.ord)
    const current = addressOf.get(record.design)
    if (current === undefined || record.ord < current) addressOf.set(record.design, record.ord)
  }

  return {
    version: source.version.manifest,
    size: byOrdinal.size,
    designs: addressOf.size,
    ordinalOfTile: (tile) => byTile.get(tile),
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
 * Since row A5 the ordinals handed in are **an instance's fills** rather than one
 * per placement, which changes nothing here: the digest is over distinct
 * ordinals, so a room whose forty instances share one floor file pays for that
 * file once, exactly as forty placements of one tile used to.
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

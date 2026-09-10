/**
 * The public codec: a scene in, a URL fragment out, and back again.
 *
 * ## Why the fragment and not the query string
 *
 * Three reasons, in order of how much they matter:
 *
 *   1. **It is never sent to a server.** A shared room is the user's own work and
 *      the app is static — putting it in the query string would write every room
 *      anyone shares into Cloudflare's request logs, forever, for no benefit.
 *   2. **Query strings are rewritten; fragments are not.** Analytics wrappers,
 *      link shorteners and mail clients append, reorder and strip query params.
 *      Nothing touches the fragment.
 *   3. **It leaves the query string to its owner.** `src/search/searchSchema.ts`
 *      owns the facet params, and this module owns the fragment, so a builder link
 *      carries a palette filter *and* a room with no negotiation between the two.
 *
 * The fragment uses the same `key=value` shape as PR 6's query codec, through the
 * same two functions, so there is one URL-encoding style in the app rather than
 * two. Only the `?` becomes a `#`.
 *
 * ## Decode is total
 *
 * Every failure is a value. Not because it is tidy, but because of where this runs:
 * a share link is opened by someone who did not build the room, often from a chat
 * client, sometimes weeks later, and the string may have been truncated by a line
 * wrap or "helpfully" edited. A throw at that point is a white screen on a cold
 * load, and the user has nothing to go back to.
 *
 * The discipline follows `src/store/migrations.ts`: **recover what is readable,
 * name what is not.** A link with one placement pointing at a retired tile opens
 * with the other forty and says which one it lost. A link whose ordinals cannot be
 * trusted at all is refused outright — the one case where refusing beats
 * recovering, because the recovered answer would be a *plausible wrong room*
 * rather than an obviously broken one.
 *
 * ## Row A1 moved the *granularity* of that salvage, and this is the contract
 *
 * A placement used to be one tile, so "the tile is gone" and "the placement is
 * gone" were the same sentence. An instance holds three to five fills, and they
 * fail independently, so the rule is now stated per level:
 *
 *   - **A retired file drops its fill and leaves the slot empty**, keeping the
 *     instance. It is not a repair and not a degradation: an absent key *is* the
 *     schema's "unfilled slot" (contract C-g, §3.2's "places anyway"), so the
 *     room opens with that part marked as needing a choice, which is a state the
 *     editor already renders. Dropping the whole instance instead would throw
 *     away a template, a position and up to four intact fills to report one
 *     missing file.
 *   - **An unreadable template drops the instance.** There is nothing to place
 *     without a family, and the fills are named against *its* slots.
 *   - **A non-finite coordinate drops the instance**, for the reason
 *     `src/store/migrations.ts` gives: there is no safe default position, and
 *     stacking it on the origin reads as a builder bug.
 *
 * Every one of those is named in `dropped`, at the level it happened.
 *
 * ## Format 6 added a fourth level, and one thing the wire cannot carry
 *
 * A hold is a fill of the *file a slot is filled with* — the torch in the wall's
 * socket — so it fails independently of the wall, and the rule reads the same one
 * level down: **a retired file drops its hold and leaves the wall filled**, named
 * as `placement 3, slot wall, hold torch: …`. Dropping the fill over a missing
 * accessory would throw away the wall to report the torch.
 *
 * The store's distinction between `holds === undefined` (*never solved*) and
 * `holds === {}` (*solved, and holds nothing*) survives too, and it takes a bit
 * of the format to do it: `WireFill.emptied`, one per fill. Without it a link
 * had to pick a reading of zero, and the repairable direction was *never
 * solved* — a room whose accessories the user had deliberately cleared arrived
 * with them all put back by the receiver's default-hold pass, and there was no
 * way to say otherwise. So the three states map exactly:
 *
 *   - **some holds survived** → the map, whatever the bit says;
 *   - **none, and the bit is set** → `{}`. The sharer emptied it, and the
 *     receiver's default-hold pass leaves an explicit empty map alone;
 *   - **none, and the bit is clear** → `undefined`, which is every fill of a
 *     format 5 link and every fill whose holds were all *dropped* — a fill that
 *     lost its accessory to a retired file arrives unsolved and is repaired
 *     rather than frozen, which is still the repairable direction where the
 *     choice is still ours to make.
 */
import type { TileId } from '@/catalog'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import type { HoldFill, LockSystem, NewTemplateInstance, SlotFill } from '@/store'
import {
  DEFAULT_LOCK_SYSTEM,
  HoldName,
  SlotName,
  TemplateId,
  UNSAFE_KEYS,
  filledSlots,
  normalizeRotation,
} from '@/store'
import { parseCompactSearch, stringifyCompactSearch } from '@/search/searchSchema'

import { MalformedPayloadError, TruncatedPayloadError } from './bytes'
import type { ShareManifest } from './manifest'
import { resolveOrdinals } from './manifest'
import type { WireFill, WireGenerated, WireHold, WireInstance, WirePayload } from './payload'
import {
  LOCK_ORDER,
  MAX_SHARE_FILLS,
  MAX_SHARE_GENERATED,
  MAX_SHARE_PLACEMENTS,
  READABLE_SHARE_FORMATS,
  decodePayload,
  encodePayload,
  payloadFormatVersion,
} from './payload'
import type { SharedScene } from './scene'
import { SharedGeneratedBase, stringifySharedGeneratedBase } from './scene'
import { deflateRaw, fromBase64Url, inflateRaw, isShareCodecSupported, toBase64Url } from './transport'

/* ----------------------------------------------------------------- the URL */

/**
 * Fragment key the payload sits under: `#s=…`.
 *
 * One character, because it is paid for on every link, and a key at all — rather
 * than a bare `#<payload>` — so a later addition (a camera position, a named
 * revision) can sit beside it without a format change. {@link decodeShareFragment}
 * accepts the bare form too, since that is what a hand-shortened link looks like.
 */
export const SHARE_PARAM = 's'

/**
 * The URL length to design against: **2,000 characters.**
 *
 * Not a spec limit — HTTP has none — but the floor of what everything in the chain
 * handles without truncating. IE's 2,083 is the historical source of the number and
 * is irrelevant now; what keeps it relevant is everything *between* two people:
 * chat clients that linkify up to a limit, mail gateways that wrap long lines, QR
 * codes, and the fact that a link nobody can select in one gesture does not get
 * shared. Browsers themselves cope with far more, so exceeding it degrades rather
 * than breaks.
 *
 * **Gate on {@link shareUrlFits}, never on a placement count.** Measured capacity
 * at this budget ranges from **80 template instances to 6,680** depending only on
 * how repetitive the build is — a factor of 84, so any count-based rule is wrong
 * in one direction or the other by nearly two orders of magnitude. The encoded
 * length is known before the link is shown, and it is the only honest test.
 *
 * Both figures are format 6's, measured on A1's shape by `capacity.test.ts`; the
 * pre-A1 pair (243 and 29,705) counted single-tile placements and is not
 * comparable. Per *file* the range moved much less than the instance counts
 * suggest: the 80-instance scattered link carries 240 to 400 files, against 243
 * before. Format 6 took the pair from format 5's 81 and 6,956 on fixtures that
 * fill no holds, which is the hold count column and the emptied bit and nothing
 * else — `payload.ts` prices both — so the *shape* of the argument is what it
 * was and only the numbers moved.
 */
export const SHARE_URL_BUDGET = 2000

/** Compose a share URL, replacing any fragment `base` already carries. */
export function buildShareUrl(base: string, fragment: string): string {
  const hash = base.indexOf('#')
  const stem = hash === -1 ? base : base.slice(0, hash)
  return `${stem}${fragment}`
}

/**
 * Whether a composed URL is inside {@link SHARE_URL_BUDGET}.
 *
 * The cutover rule, in one function, so no caller re-derives it from a guess about
 * how many tiles fit.
 */
export function shareUrlFits(url: string): boolean {
  return url.length <= SHARE_URL_BUDGET
}

/* ------------------------------------------------------------------ results */

/** Why encoding could not produce a link. Both cases are the app's fault, not the user's. */
export type ShareEncodeFailure =
  /** This runtime has no `CompressionStream`. Every targeted browser does. */
  | 'unsupported'
  /** More placements than the format carries — see `MAX_SHARE_PLACEMENTS`. */
  | 'too-many'
  /**
   * More filled slots in total than the format carries — see `MAX_SHARE_FILLS`.
   *
   * A second ceiling rather than a redundant one: since row A1 the placement
   * count no longer bounds the number of ordinals in a payload, because an
   * instance carries a fill per slot and nothing in `@/store` caps the slots of
   * a template — and format 6 repeats that a level down, since a fill carries a
   * hold per mount. **Holds count against the same ceiling**, for the reason
   * `payload.ts` gives: what is bounded is files named, and a hold names one.
   * Reachable only from a scene no template table can produce.
   */
  | 'too-many-fills'
  /** More generated bases than the format carries — see `MAX_SHARE_GENERATED`. */
  | 'too-many-generated'

export type ShareEncodeResult =
  | {
      readonly ok: true
      /** Ready to append to a URL, leading `#` included. */
      readonly fragment: string
      /** The base64url payload alone, without the `#s=` prefix. */
      readonly payload: string
      /** Payload size before compression — the columnar bytes. */
      readonly rawBytes: number
      /** Payload size after `deflate-raw`, before base64. */
      readonly compressedBytes: number
      /** Placements left out, each named with why. Empty for a clean scene. */
      readonly dropped: readonly string[]
    }
  | { readonly ok: false; readonly reason: ShareEncodeFailure; readonly message: string }

/**
 * Why a link could not be opened.
 *
 * Ordered as the decode pipeline meets them, which is also roughly least to most
 * alarming. The last three are the interesting ones: `manifest-version` and
 * `manifest-drift` are the two halves of the §13 defence, and they are the only
 * failures where the decoder *could* have produced a room and refuses to.
 */
export type ShareDecodeFailure =
  /** No `s=` in the fragment — usually just a URL with no room in it. */
  | 'absent'
  /** The payload is not base64url: characters outside the alphabet, or a `4n+1` length. */
  | 'not-base64'
  /** Valid base64url, but not a DEFLATE stream. The usual shape of a truncated link. */
  | 'not-compressed'
  /** The payload ran out mid-field. */
  | 'truncated'
  /** A payload layout this build does not read. */
  | 'format-version'
  /** Structurally impossible: unknown flags, an absurd count, trailing bytes. */
  | 'malformed'
  /** The manifest was deliberately renumbered since the link was written. */
  | 'manifest-version'
  /** The ordinals in this link no longer mean the tiles they meant. */
  | 'manifest-drift'
  /** This runtime has no `DecompressionStream`. */
  | 'unsupported'

export type ShareDecodeResult =
  | {
      readonly ok: true
      readonly scene: SharedScene
      /**
       * One entry per datum discarded or repaired, naming what it was and the
       * reason — `placement 3, slot floor: tile ordinal 9001 is not in this
       * catalog build`. A fill, an instance and a table entry are three different
       * units and each is named as itself; see the module docblock's three levels
       * of salvage. Meant for a notice beside the opened room, never for control
       * flow.
       */
      readonly dropped: readonly string[]
    }
  | { readonly ok: false; readonly reason: ShareDecodeFailure; readonly message: string }

/* ----------------------------------------------------------------- encoding */

/**
 * Encode a scene into a URL fragment.
 *
 * Asynchronous because `CompressionStream` is. **Never call this from a store
 * action** — see `src/share/transport.ts`; PR 5 keeps persistence synchronous and
 * an `await` in that path is how rapid tile placement loses writes.
 *
 * Tolerant in one direction only, at the granularity the module docblock states:
 * a fill whose file this build does not carry leaves its slot empty and is named,
 * because encoding is triggered by a user who can be told "two tiles in your room
 * are no longer in the catalog"; there is no sense in refusing to share the other
 * forty instances, or in throwing away the four intact fills beside the missing
 * one.
 */
export async function encodeShareFragment(scene: SharedScene, manifest: ShareManifest): Promise<ShareEncodeResult> {
  if (!isShareCodecSupported()) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot create share links.' }
  }

  const dropped: string[] = []
  const { templates, slots, filters, instances } = collectInstances(scene.placements, manifest, dropped)
  const ordinals = fileOrdinals(instances)

  if (instances.length > MAX_SHARE_PLACEMENTS) {
    return {
      ok: false,
      reason: 'too-many',
      message:
        `A share link carries at most ${String(MAX_SHARE_PLACEMENTS)} placements; ` +
        `this scene has ${String(instances.length)}.`,
    }
  }
  if (ordinals.length > MAX_SHARE_FILLS) {
    return {
      ok: false,
      reason: 'too-many-fills',
      message:
        `A share link carries at most ${String(MAX_SHARE_FILLS)} filled slots and holds in total; ` +
        `this scene has ${String(ordinals.length)}.`,
    }
  }

  const { recipes, generated } = collectGenerated(scene.generated, dropped)
  if (generated.length > MAX_SHARE_GENERATED || recipes.length > MAX_SHARE_GENERATED) {
    return {
      ok: false,
      reason: 'too-many-generated',
      message:
        `A share link carries at most ${String(MAX_SHARE_GENERATED)} generated bases; ` +
        `this scene has ${String(generated.length)}.`,
    }
  }

  let lockIndex = LOCK_ORDER.indexOf(scene.lock)
  if (lockIndex === -1) {
    lockIndex = Math.max(0, LOCK_ORDER.indexOf(DEFAULT_LOCK_SYSTEM))
    dropped.push(`lock: ${String(scene.lock)} is not a lock system, shared as ${DEFAULT_LOCK_SYSTEM}`)
  }

  const { digest } = resolveOrdinals(ordinals, manifest)

  const raw = encodePayload({
    manifestVersion: manifest.version,
    lockIndex,
    digest,
    templates,
    slots,
    filters,
    instances,
    recipes,
    generated,
  })
  const compressed = await deflateRaw(raw)
  if (compressed === undefined) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot create share links.' }
  }

  const payload = toBase64Url(compressed)
  return {
    ok: true,
    fragment: `#${stringifyCompactSearch({ [SHARE_PARAM]: payload }).slice(1)}`,
    payload,
    rawBytes: raw.length,
    compressedBytes: compressed.length,
    dropped,
  }
}

/**
 * An interning table: a list of distinct strings, and the index of one.
 *
 * First-use order rather than sorted, because the index column compresses on
 * *locality* and a room places its families in the order it was built. Sorting
 * the table would buy a canonical form the scene order does not have anyway —
 * `sharedSceneFromState` is explicit that determinism here is per scene object,
 * so two shares of one scene agree and two builds of one room need not.
 */
function stringTable(): { readonly entries: string[]; intern: (value: string) => number } {
  const entries: string[] = []
  const index = new Map<string, number>()
  return {
    entries,
    intern: (value) => {
      const found = index.get(value)
      if (found !== undefined) return found
      index.set(value, entries.length)
      entries.push(value)
      return entries.length - 1
    },
  }
}

/**
 * Every file ordinal in the payload, in wire order — fills **and** holds. What
 * the digest is taken over.
 *
 * A hold names a file exactly as a fill does, so it is checksummed exactly as a
 * fill is: §13's failure is two ordinals swapping the files they name, and a
 * torch that silently becomes a brazier is that failure at the size the user is
 * least likely to notice. It is also what makes a hold *decodable* — the tile map
 * the decoder reads a fill out of is the checksum's own view, and an ordinal
 * outside it has no tile to resolve to.
 *
 * Order does not matter to the digest (`resolveOrdinals` sorts the distinct set)
 * but is kept anyway, because this is also the count the {@link MAX_SHARE_FILLS}
 * gate is taken over.
 */
function fileOrdinals(instances: readonly WireInstance[]): number[] {
  return instances.flatMap((instance) =>
    instance.fills.flatMap((fill) => [fill.ordinal, ...fill.holds.map((hold) => hold.ordinal)]),
  )
}

/**
 * Turn the scene's instances into a template table, a slot table and the wire
 * instances that index them.
 *
 * The **slots of one instance are written in sorted order**, and that is not
 * cosmetic: `fills` is a `z.record`, so its key order is whatever the producer
 * happened to insert — the solver, the editor, a re-import — and two rooms that
 * are the same room would otherwise emit different slot columns. Sorting also
 * puts the same slot in the same position of every instance of a template, which
 * is what turns the slot column into a repeating pattern for deflate.
 *
 * `filledSlots` is the sanctioned crossing from the map to an array, and it is
 * imported rather than reimplemented for the reason its docblock gives: an
 * `Object.keys(fills) as SlotName[]` here would name the brand instead of
 * deriving it and would keep compiling the day the key type changes.
 */
function collectInstances(
  placements: readonly NewTemplateInstance[],
  manifest: ShareManifest,
  dropped: string[],
): { templates: string[]; slots: string[]; filters: string[]; instances: WireInstance[] } {
  const templates = stringTable()
  const slots = stringTable()
  const filters = stringTable()
  const instances: WireInstance[] = []

  placements.forEach((instance, index) => {
    if (!Number.isFinite(instance.x) || !Number.isFinite(instance.z)) {
      dropped.push(`placement ${String(index)}: position is not a finite point`)
      return
    }
    const fills: WireFill[] = []
    for (const slot of filledSlots(instance.fills).sort()) {
      const fill = instance.fills[slot]
      if (fill === undefined) continue
      // The file's own ordinal — a fill names a file, and that ordinal is
      // append-only for ever. `manifest.ts` has the argument, and row A5's
      // reversal of row V4's design addressing.
      const ordinal = manifest.ordinalOfTile(fill.tile)
      if (ordinal === undefined) {
        dropped.push(`placement ${String(index)}, slot ${slot}: ${fill.tile} is not in this catalog build`)
        continue
      }
      fills.push({
        slot: slots.intern(slot),
        ordinal,
        pinned: fill.pinned,
        holds: collectHolds(fill.holds, `placement ${String(index)}, slot ${slot}`, slots.intern, manifest, dropped),
        /* **The map was there and had nothing in it** — read off the store's own
           field rather than off the wire holds above, which are also empty when
           every hold was dropped. Those two are different rooms: one was
           emptied on purpose and one lost its accessory to a retired file. */
        emptied: fill.holds !== undefined && filledSlots(fill.holds).length === 0,
      })
    }
    instances.push({
      template: templates.intern(instance.template),
      /* Interned as a **set**, joined in the order the instance holds them — the
         axis order `slotEditor.ts#filtersWith` and `usePlanTools#armedPosition`
         both produce, so two instances at one position intern to one entry.
         Deliberately *not* sorted: the two writers already agree, and sorting
         here would hide a third writer that did not. `payload.ts` carries why the
         set is the unit. */
      filters: filters.intern((instance.filters ?? []).join('\u0000')),
      x: instance.x + 0,
      z: instance.z + 0,
      rotation: normalizeRotation(instance.rotation),
      fills,
    })
  })

  return { templates: templates.entries, slots: slots.entries, filters: filters.entries, instances }
}

/**
 * The accessories fitted into one filled file, as the wire carries them.
 *
 * **Sorted and interned into the slot table**, both for the reasons
 * {@link collectInstances} gives one level up: `holds` is a `z.record` too, so
 * its key order is the producer's accident and two rooms that are the same room
 * must be the same link; and a hold name is a short string with no manifest
 * ordinal, which is the argument the slot table already is.
 *
 * A hold whose file this build does not carry is dropped and named with the
 * placement, the slot **and** the hold, because all three are needed to find it
 * in a room — `slot wall` alone appears on ninety walls. The fill stays: an
 * accessory that cannot be encoded is not a reason to unfill the wall it sat on.
 *
 * `where` is the caller's already-composed prefix rather than an index and a slot
 * name, so the two levels cannot disagree about how a placement is named.
 */
function collectHolds(
  holds: SlotFill['holds'],
  where: string,
  intern: (value: string) => number,
  manifest: ShareManifest,
  dropped: string[],
): WireHold[] {
  if (holds === undefined) return []
  const wire: WireHold[] = []
  for (const name of filledSlots(holds).sort()) {
    const hold = holds[name]
    if (hold === undefined) continue
    const ordinal = manifest.ordinalOfTile(hold.tile)
    if (ordinal === undefined) {
      dropped.push(`${where}, hold ${name}: ${hold.tile} is not in this catalog build`)
      continue
    }
    wire.push({ slot: intern(name), ordinal, pinned: hold.pinned })
  }
  return wire
}

/**
 * Deduplicate the scene's generated bases into a recipe table and a column of
 * indices into it.
 *
 * Keyed on the {@link GeneratedPlacement.base} id, which S5 makes equal exactly
 * when the two recipes are equal — `recipeKey` *is* recipe equality, and nothing
 * on this path hashes anything — so the table holds one entry per distinct
 * recipe by construction rather than by comparison. That is the dedup the
 * measured cost depends on: ninety bases sharing one recipe cost one document.
 *
 * The first placement to name a base decides the document, so two placements
 * carrying the same id and different recipes would share the first one's. That
 * cannot come from the store — the id is derived from the recipe — and it is the
 * same assumption `placeGeneratedBase` already makes; the honest alternative
 * (key on the serialised document and let two ids collide in the table) would
 * put the disagreement in the *link* rather than surfacing it.
 *
 * A non-finite coordinate drops the placement and names it, for the reason the
 * tile path gives: there is no safe default position, and stacking it on the
 * origin reads as a builder bug.
 */
function collectGenerated(
  placements: readonly GeneratedPlacement[],
  dropped: string[],
): { recipes: string[]; generated: WireGenerated[] } {
  const recipes: string[] = []
  const indexOf = new Map<string, number>()
  const generated: WireGenerated[] = []

  placements.forEach((placement, index) => {
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.z)) {
      dropped.push(`generated base ${String(index)}: position is not a finite point`)
      return
    }
    let recipe = indexOf.get(placement.base)
    if (recipe === undefined) {
      recipe = recipes.length
      indexOf.set(placement.base, recipe)
      recipes.push(stringifySharedGeneratedBase({ base: placement.base, recipe: placement.recipe }))
    }
    generated.push({
      recipe,
      x: placement.x + 0,
      z: placement.z + 0,
      rotation: normalizeRotation(placement.rotation),
    })
  })

  return { recipes, generated }
}

/* ----------------------------------------------------------------- decoding */

/**
 * Pull the payload out of a fragment.
 *
 * Accepts `#s=…`, `s=…`, and a bare `…` payload, because all three turn up: the
 * first from `location.hash`, the second from a router, the third from someone who
 * shortened the link by hand. The forms are distinguishable without ambiguity —
 * base64url has no `=` in it once padding is stripped — so accepting all three
 * costs nothing and refusing two of them would be a support question.
 *
 * Parsing goes through PR 6's `parseCompactSearch`, which is already total,
 * prototype-safe and tolerant of a malformed percent-escape.
 */
export function readShareFragment(fragment: string): string | undefined {
  const body = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (body === '') return undefined
  if (!body.includes('=')) return body

  const value = parseCompactSearch(body)[SHARE_PARAM]
  if (typeof value === 'string') return value === '' ? undefined : value
  // `parseCompactSearch` splits a value containing `~` into an array. base64url
  // never contains one, so an array here means the fragment was not ours.
  return undefined
}

/**
 * Decode a fragment against the manifest this build was made with.
 *
 * The order of the checks is the design. Cheapest and most local first, so the
 * error a user sees names the actual problem: a mangled paste is reported as a
 * mangled paste, not as manifest drift. The two manifest checks come last, once
 * the bytes are known to be ours, and they are the only ones that refuse readable
 * data.
 */
export async function decodeShareFragment(fragment: string, manifest: ShareManifest): Promise<ShareDecodeResult> {
  if (!isShareCodecSupported()) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot open share links.' }
  }

  const payload = readShareFragment(fragment)
  if (payload === undefined) {
    return { ok: false, reason: 'absent', message: 'This link does not carry a room.' }
  }

  const compressed = fromBase64Url(payload)
  if (compressed === undefined) {
    return {
      ok: false,
      reason: 'not-base64',
      message: 'This share link is damaged — it looks like it was cut short or edited.',
    }
  }

  const raw = await inflateRaw(compressed)
  if (raw === undefined) {
    return {
      ok: false,
      reason: 'not-compressed',
      message: 'This share link is damaged — it looks like it was cut short or edited.',
    }
  }

  const format = payloadFormatVersion(raw)
  if (format === undefined || !READABLE_SHARE_FORMATS.includes(format)) {
    return {
      ok: false,
      reason: 'format-version',
      message:
        `This link was made with share format ${String(format ?? 'unknown')}, and this version reads ` +
        `${READABLE_SHARE_FORMATS.join(' and ')}. Reload the page to pick up the current build, and if the link ` +
        'still will not open, ask whoever sent it for a fresh one.',
    }
  }

  let decoded
  try {
    decoded = decodePayload(raw)
  } catch (error) {
    if (error instanceof TruncatedPayloadError) {
      return { ok: false, reason: 'truncated', message: 'This share link is incomplete — some of it is missing.' }
    }
    if (error instanceof MalformedPayloadError) {
      return { ok: false, reason: 'malformed', message: `This share link is not readable: ${error.message}.` }
    }
    return { ok: false, reason: 'malformed', message: 'This share link is not readable.' }
  }

  if (decoded.manifestVersion !== manifest.version) {
    return {
      ok: false,
      reason: 'manifest-version',
      message:
        `This link was written against tile manifest ${String(decoded.manifestVersion)} and this build uses ` +
        `${String(manifest.version)}. The numbers in it no longer name the same tiles, so opening it would ` +
        'produce a different room. Ask whoever sent it to re-share from their builder.',
    }
  }

  return assembleScene(decoded, manifest)
}

/**
 * Turn a verified payload into a scene, salvaging per placement.
 *
 * Split out because the drift check has to run against the *resolved* ordinals —
 * the checksum is over what the ordinals mean, not over the bytes — so resolution
 * and verification are one step, and the salvage loop reads the result of it.
 */
function assembleScene(decoded: WirePayload, manifest: ShareManifest): ShareDecodeResult {
  const resolved = resolveOrdinals(fileOrdinals(decoded.instances), manifest)

  if (resolved.unresolved.length === 0 && resolved.digest !== decoded.digest) {
    return {
      ok: false,
      reason: 'manifest-drift',
      message:
        'This link no longer matches the tile catalog: its tile numbers now point at different tiles, so ' +
        'opening it would silently give you the wrong room. The catalog was renumbered without a manifest ' +
        'version bump — report this, and ask whoever sent the link to re-share it.',
    }
  }

  const dropped: string[] = []
  if (resolved.unresolved.length > 0) {
    dropped.push(
      `manifest checksum not verified: ${String(resolved.unresolved.length)} tile ordinal(s) in this link are ` +
        'not in this catalog build',
    )
  }

  const placements = assembleInstances(decoded, resolved.tiles, dropped)
  const generated = assembleGenerated(decoded.recipes, decoded.generated, dropped)

  return { ok: true, scene: { lock: readLock(decoded.lockIndex, dropped), placements, generated }, dropped }
}

/**
 * How many payload entries name each index of a table.
 *
 * The reason the tables are parsed once per *entry* rather than once per use: a
 * room of ninety instances on one unreadable template must produce one line of
 * `dropped` saying so and not ninety, because `dropped` is meant for a notice
 * beside the opened room.
 */
function useCounts(indices: Iterable<number>): Map<number, number> {
  const uses = new Map<number, number>()
  for (const index of indices) uses.set(index, (uses.get(index) ?? 0) + 1)
  return uses
}

/**
 * Parse one of the payload's three string tables, reporting each entry it cannot
 * read once, with the number of things that entry cost.
 *
 * Generic over what an entry parses to, because all three tables have the same
 * shape of problem and the same shape of answer: a stranger's text, a total
 * parse, and a count of what naming it would have placed. `label` is a function
 * rather than a string so each caller's message names its own units — a template
 * costs placements, a slot costs fills, a recipe costs bases.
 */
function readStringTable<T>(
  entries: readonly string[],
  uses: ReadonlyMap<number, number>,
  parse: (entry: string) => T | undefined,
  label: (index: number, count: number) => string,
  dropped: string[],
): Map<number, T> {
  const table = new Map<number, T>()
  entries.forEach((entry, index) => {
    const parsed = parse(entry)
    if (parsed !== undefined) {
      table.set(index, parsed)
      return
    }
    // An entry nothing names is not a loss, so it is not reported. That is
    // reachable: an encoder is free to leave one, and a hand-edited payload does.
    const count = uses.get(index) ?? 0
    if (count > 0) dropped.push(label(index, count))
  })
  return table
}

function plural(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? '' : 's'}`
}

/**
 * Turn the wire instances and the two tables back into placements.
 *
 * The three levels of salvage the module docblock states are the branches below,
 * and they are in that order for a reason: a template that cannot be read makes
 * the fills meaningless, since a slot name is named against *its* parts, so there
 * is nothing to salvage from an instance whose family is gone.
 *
 * A template id that parses but names no family this build ships is **not**
 * detectable here and is deliberately not attempted: the family table lives
 * beside a screen and must not enter this closure (`src/store/schema.ts#TemplateId`
 * makes the same argument for the store). It fails closed one level up — nothing
 * renders an instance whose template it cannot find, because rendering walks the
 * template's parts.
 */
function assembleInstances(
  decoded: WirePayload,
  tiles: ReadonlyMap<number, TileId>,
  dropped: string[],
): NewTemplateInstance[] {
  const templates = readStringTable(
    decoded.templates,
    useCounts(decoded.instances.map((instance) => instance.template)),
    (entry) => TemplateId.safeParse(entry).data,
    (index, count) => `template ${String(index)}: not a readable template id, dropping ${plural(count, 'placement')}`,
    dropped,
  )
  const slots = readStringTable(
    decoded.slots,
    useCounts(decoded.instances.flatMap((instance) => instance.fills.map((fill) => fill.slot))),
    (entry) => SlotName.safeParse(entry).data,
    (index, count) => `slot ${String(index)}: not a readable slot name, dropping ${plural(count, 'fill')}`,
    dropped,
  )
  /* The **same table**, read a second time as hold names. Two passes rather than
     one, because the two are different brands looked up in different maps
     (`store/schema.ts#HoldName`), and because an entry that will not read must be
     reported in the units it cost: an unreadable entry used by fills and by holds
     is two losses and two lines, and an entry only one level names is only ever
     reported once. Six entries and a `min(1)` parse, so the second pass is free
     against what it buys. */
  const holdNames = readStringTable(
    decoded.slots,
    useCounts(
      decoded.instances.flatMap((instance) => instance.fills.flatMap((fill) => fill.holds.map((hold) => hold.slot))),
    ),
    (entry) => HoldName.safeParse(entry).data,
    (index, count) => `hold name ${String(index)}: not a readable hold name, dropping ${plural(count, 'hold')}`,
    dropped,
  )
  const filters = readStringTable(
    decoded.filters,
    useCounts(decoded.instances.map((instance) => instance.filters)),
    readFilterSet,
    (index, count) =>
      `filters ${String(index)}: not a readable filter list, widening ${plural(count, 'placement')} to any`,
    dropped,
  )

  const placements: NewTemplateInstance[] = []
  decoded.instances.forEach((instance, index) => {
    const template = templates.get(instance.template)
    if (template === undefined) return
    if (!Number.isFinite(instance.x) || !Number.isFinite(instance.z)) {
      dropped.push(`placement ${String(index)}: position is not a finite point`)
      return
    }
    placements.push({
      template,
      /* An entry that would not read reduces the instance to *any* on every
         axis rather than dropping the piece, and it is reported above. The
         filters narrow what an editor offers and decide no geometry, so a room
         that loses them is the sharer's room with a wider editor — where a
         dropped placement would be a hole in it. `migrations.ts#salvageFilters`
         takes the same reading of the same field out of storage. */
      filters: filters.get(instance.filters) ?? [],
      x: instance.x + 0,
      z: instance.z + 0,
      rotation: normalizeRotation(instance.rotation),
      fills: assembleFills(instance.fills, index, { slots, holdNames }, tiles, dropped),
    })
  })
  return placements
}

/**
 * One filter-table entry back into a tag list, or `undefined` when it will not
 * read.
 *
 * Reduced **whole**, which is the same reading `migrations.ts#salvageFilters`
 * takes of the same field: a filter list is one choice across every control axis,
 * so half of `['component|door|arched', 'size|width|2']` is not a narrower filter
 * but a different one nobody made. An entry with an empty segment is therefore
 * refused entirely rather than compacted, and the caller widens the instances
 * naming it to *any*.
 *
 * The empty string is the empty list and is the ordinary case — every instance
 * placed at *any* on every axis interns to it.
 */
function readFilterSet(entry: string): readonly string[] | undefined {
  if (entry === '') return []
  const tags = entry.split('\u0000')
  return tags.some((tag) => tag === '') ? undefined : tags
}

/** What {@link collectFilled} says when it discards an entry. One phrasing per level. */
interface DropReasons<K extends string> {
  /** The name is one no record may be keyed by — see `store/migrations.ts#UNSAFE_KEYS`. */
  readonly unsafe: (name: K) => string
  /** The ordinal names no file this build carries. */
  readonly missing: (name: K, ordinal: number) => string
  /** A second entry names a name already taken. */
  readonly duplicate: (name: K) => string
}

/**
 * Collect wire entries into a map keyed by their names, reporting what it drops.
 *
 * **One helper for both levels, because the hazard is one hazard.** A slot name
 * and a hold name are both `z.string().min(1)` — the loosest key schema in the
 * store, because the authority on what a part is called is the template
 * (`store/schema.ts#SlotName`) — so a payload out of a URL can name a slot
 * `__proto__`, `toString` or `hasOwnProperty`, and every one of those parses.
 *
 * Two things make that safe here, and neither is a check against a list of the
 * names anyone thought of:
 *
 *   1. **The accumulator is a `Map`.** `has` is an own-key test, where
 *      `record[name] !== undefined` reads the *prototype chain* — so on a plain
 *      object `toString` is already "taken" before anything is written and the
 *      **first** hold named `toString` is discarded as a duplicate of a function
 *      nobody put there. That was the real bug: not the exotic key, but every
 *      ordinary member of `Object.prototype` silently costing a fill with a
 *      dropped line that says something untrue about why.
 *   2. **{@link UNSAFE_KEYS} is refused outright**, and named. `Object.fromEntries`
 *      would define `__proto__` as an honest own property rather than invoking the
 *      setter, so the map alone would already be sound — but the result is handed
 *      to `placeTemplate` and thence to code that walks these records with plain
 *      indexing, and a `constructor` key surviving that far is a hazard this
 *      module has no business exporting. The store's salvager refuses the same
 *      three keys reading the same two schemas out of `localStorage`; sharing the
 *      set is what keeps the two readers from drifting apart.
 *
 * `tiles` is the *checksum's* own view — the (ordinal, tile id) pairs
 * `resolveOrdinals` resolved, because §13's failure is two ordinals swapping the
 * files they name — so reading a fill out of it rather than calling `tileOf`
 * again is what keeps the room and the digest describing the same files by
 * construction rather than by two lookups agreeing.
 */
function collectFilled<E extends WireHold, K extends string, V>(
  wire: readonly E[],
  names: ReadonlyMap<number, K>,
  tiles: ReadonlyMap<number, TileId>,
  build: (tile: TileId, entry: E, name: K) => V,
  reasons: DropReasons<K>,
  dropped: string[],
): Map<K, V> {
  const filled = new Map<K, V>()
  for (const entry of wire) {
    const name = names.get(entry.slot)
    // Reported once against the table entry, not once per use.
    if (name === undefined) continue
    if (UNSAFE_KEYS.has(name)) {
      dropped.push(reasons.unsafe(name))
      continue
    }
    const tile = tiles.get(entry.ordinal)
    if (tile === undefined) {
      dropped.push(reasons.missing(name, entry.ordinal))
      continue
    }
    if (filled.has(name)) {
      // Unreachable from any encoder — both levels are maps on both sides — so
      // this is a hand-edited payload contradicting itself. First writer wins,
      // which is deterministic rather than correct, and it is named because
      // silently choosing between two files is the one thing this codec does not
      // do.
      dropped.push(reasons.duplicate(name))
      continue
    }
    filled.set(name, build(tile, entry, name))
  }
  return filled
}

/** The fills of one instance, as the schema's map. */
function assembleFills(
  wire: readonly WireFill[],
  index: number,
  names: { slots: ReadonlyMap<number, SlotName>; holdNames: ReadonlyMap<number, HoldName> },
  tiles: ReadonlyMap<number, TileId>,
  dropped: string[],
): Record<SlotName, SlotFill> {
  const fills = collectFilled(
    wire,
    names.slots,
    tiles,
    (tile, fill, slot): SlotFill => {
      const where = `placement ${String(index)}, slot ${slot}`
      const holds = assembleHolds(fill.holds, where, names.holdNames, tiles, dropped)
      /* **Three states, and the bit is what separates the last two**: the map
         when something survived, `{}` when the sharer had emptied it, and
         absence otherwise — a format 5 link, or a fill whose every hold was
         dropped, both of which the default-hold pass should fill in when the
         room opens. See the module docblock. */
      if (holds !== undefined) return { tile, pinned: fill.pinned, holds }
      return fill.emptied ? { tile, pinned: fill.pinned, holds: {} } : { tile, pinned: fill.pinned }
    },
    {
      unsafe: (slot) => `placement ${String(index)}: slot ${slot} names an unsafe key, dropping the fill`,
      missing: (slot, ordinal) =>
        `placement ${String(index)}, slot ${slot}: tile ordinal ${String(ordinal)} is not in this catalog build`,
      duplicate: (slot) => `placement ${String(index)}: slot ${slot} is filled twice, keeping the first`,
    },
    dropped,
  )
  return Object.fromEntries(fills)
}

/**
 * The holds of one fill, as the schema's map — or `undefined` when none survived.
 *
 * The same failures as {@link assembleFills} through the same collector, named
 * one level down: a name the table cannot read is reported once against the
 * entry, an unsafe key and a file this build does not carry each drop their hold
 * and say which, and two holds naming one mount keep the first.
 *
 * `undefined` rather than `{}` for the empty result, for the reason written into
 * the caller and the module docblock — and returning it from here rather than
 * letting the caller test emptiness keeps the two spellings of *no holds* from
 * being decided in two places. The size is the collector's own key count, so it
 * counts what actually survived rather than what was attempted.
 */
function assembleHolds(
  wire: readonly WireHold[],
  where: string,
  names: ReadonlyMap<number, HoldName>,
  tiles: ReadonlyMap<number, TileId>,
  dropped: string[],
): Record<HoldName, HoldFill> | undefined {
  const holds = collectFilled(
    wire,
    names,
    tiles,
    (tile, hold): HoldFill => ({ tile, pinned: hold.pinned }),
    {
      unsafe: (name) => `${where}: hold ${name} names an unsafe key, dropping the hold`,
      missing: (name, ordinal) =>
        `${where}, hold ${name}: tile ordinal ${String(ordinal)} is not in this catalog build`,
      duplicate: (name) => `${where}: hold ${name} is filled twice, keeping the first`,
    },
    dropped,
  )
  return holds.size === 0 ? undefined : Object.fromEntries(holds)
}

/**
 * Turn the recipe table and the generated columns back into placements.
 *
 * The table is parsed **once per entry, not once per placement**, because a bad
 * document should be reported as one problem rather than as ninety — a room with
 * ninety bases on one unreadable recipe would otherwise produce ninety lines of
 * `dropped` saying the same thing, and `dropped` is meant for a notice beside the
 * opened room.
 *
 * Every failure is a value, per the module docblock: a document that is not JSON,
 * or is JSON that {@link SharedGeneratedBase} refuses — an id that is not in the
 * `gen:` space, an entry point this build's panel does not offer, a parameter
 * value that is not a number, string, boolean or numeric vector — drops the bases
 * that name it and says which and how many. The rest of the room opens.
 *
 * `JSON.parse` is the only throw on this path and it is caught here rather than
 * at the module boundary, because catching it further out would lose the index
 * that makes the message useful.
 */
function assembleGenerated(
  recipes: readonly string[],
  wire: readonly WireGenerated[],
  dropped: string[],
): GeneratedPlacement[] {
  const table = readStringTable(
    recipes,
    useCounts(wire.map((entry) => entry.recipe)),
    readGeneratedDocument,
    (index, count) =>
      `generated recipe ${String(index)}: not a readable base recipe, dropping ${plural(count, 'base')}`,
    dropped,
  )

  const generated: GeneratedPlacement[] = []
  wire.forEach((entry, index) => {
    const document = table.get(entry.recipe)
    if (document === undefined) return
    if (!Number.isFinite(entry.x) || !Number.isFinite(entry.z)) {
      dropped.push(`generated base ${String(index)}: position is not a finite point`)
      return
    }
    generated.push({
      base: document.base,
      recipe: document.recipe,
      x: entry.x + 0,
      z: entry.z + 0,
      rotation: normalizeRotation(entry.rotation),
    })
  })

  return generated
}

/** One table entry, or `undefined` if it is not one. Total; never throws. */
function readGeneratedDocument(document: string): SharedGeneratedBase | undefined {
  let json: unknown
  try {
    json = JSON.parse(document)
  } catch {
    return undefined
  }
  const parsed = SharedGeneratedBase.safeParse(json)
  return parsed.success ? parsed.data : undefined
}

/**
 * Read the lock byte, defaulting rather than failing.
 *
 * A lock index this build does not know means the link came from a version that
 * added a fourth system. Refusing the whole room over it would be the wrong trade:
 * the geometry is intact and readable, and the lock preference is one click to fix
 * — so it degrades to the default and says so, exactly as `salvageLock` does in
 * `src/store/migrations.ts`.
 */
function readLock(index: number, dropped: string[]): LockSystem {
  const lock = LOCK_ORDER[index]
  if (lock !== undefined) return lock
  dropped.push(`lock: index ${String(index)} is not a lock system this build knows, reset to ${DEFAULT_LOCK_SYSTEM}`)
  return DEFAULT_LOCK_SYSTEM
}

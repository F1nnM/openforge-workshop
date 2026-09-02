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
 */
import type { TileId } from '@/catalog'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import type { LockSystem, Placement } from '@/store'
import { DEFAULT_LOCK_SYSTEM, normalizeRotation } from '@/store'
import { parseCompactSearch, stringifyCompactSearch } from '@/search/searchSchema'

import { MalformedPayloadError, TruncatedPayloadError } from './bytes'
import type { ShareManifest } from './manifest'
import { resolveOrdinals } from './manifest'
import type { WireGenerated, WirePlacement } from './payload'
import {
  LOCK_ORDER,
  MAX_SHARE_GENERATED,
  MAX_SHARE_PLACEMENTS,
  SHARE_FORMAT_VERSION,
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
 * at this budget ranges from 243 placements to 29,713 depending only on how
 * repetitive the build is — a two-orders-of-magnitude spread, so any count-based
 * rule is wrong in one direction or the other by a factor of 100. The encoded
 * length is known before the link is shown, and it is the only honest test.
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
       * One entry per datum discarded or repaired, naming its index and the reason
       * — `placement 3: tile ordinal 9001 is not in this catalog build`. Meant for
       * a notice beside the opened room, never for control flow.
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
 * Tolerant in one direction only. A placement whose tile this build does not carry
 * is dropped and named, because encoding is triggered by a user who can be told
 * "two tiles in your room are no longer in the catalog"; there is no sense in
 * refusing to share the other forty. A placement with a non-finite coordinate is
 * dropped for the reason `src/store/migrations.ts` gives: there is no safe default
 * position, and stacking it on the origin reads as a builder bug.
 */
export async function encodeShareFragment(scene: SharedScene, manifest: ShareManifest): Promise<ShareEncodeResult> {
  if (!isShareCodecSupported()) {
    return { ok: false, reason: 'unsupported', message: 'This browser cannot create share links.' }
  }

  const dropped: string[] = []
  const placements: WirePlacement[] = []

  scene.placements.forEach((placement, index) => {
    const ordinal = manifest.ordinalOf(placement.tileId)
    if (ordinal === undefined) {
      dropped.push(`placement ${String(index)}: ${placement.tileId} is not in this catalog build`)
      return
    }
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.z)) {
      dropped.push(`placement ${String(index)}: position is not a finite point`)
      return
    }
    placements.push({
      ordinal,
      x: placement.x + 0,
      z: placement.z + 0,
      rotation: normalizeRotation(placement.rotation),
    })
  })

  if (placements.length > MAX_SHARE_PLACEMENTS) {
    return {
      ok: false,
      reason: 'too-many',
      message:
        `A share link carries at most ${String(MAX_SHARE_PLACEMENTS)} placements; ` +
        `this scene has ${String(placements.length)}.`,
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

  const { digest } = resolveOrdinals(
    placements.map((placement) => placement.ordinal),
    manifest,
  )

  const raw = encodePayload({ manifestVersion: manifest.version, lockIndex, digest, placements, recipes, generated })
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
  if (format !== SHARE_FORMAT_VERSION) {
    return {
      ok: false,
      reason: 'format-version',
      message:
        `This link was made with share format ${String(format ?? 'unknown')}, and this version reads ` +
        `${String(SHARE_FORMAT_VERSION)}. Reload the page to pick up the current build, and if the link still ` +
        'will not open, ask whoever sent it for a fresh one.',
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
function assembleScene(
  decoded: {
    manifestVersion: number
    lockIndex: number
    digest: number
    placements: readonly WirePlacement[]
    recipes: readonly string[]
    generated: readonly WireGenerated[]
  },
  manifest: ShareManifest,
): ShareDecodeResult {
  const resolved = resolveOrdinals(
    decoded.placements.map((placement) => placement.ordinal),
    manifest,
  )

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

  const placements: Placement[] = []
  decoded.placements.forEach((placement, index) => {
    const tileId: TileId | undefined = resolved.tiles.get(placement.ordinal)
    if (tileId === undefined) {
      dropped.push(`placement ${String(index)}: tile ordinal ${String(placement.ordinal)} is not in this catalog build`)
      return
    }
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.z)) {
      dropped.push(`placement ${String(index)}: position is not a finite point`)
      return
    }
    placements.push({
      tileId,
      x: placement.x + 0,
      z: placement.z + 0,
      rotation: normalizeRotation(placement.rotation),
    })
  })

  const generated = assembleGenerated(decoded.recipes, decoded.generated, dropped)

  return { ok: true, scene: { lock: readLock(decoded.lockIndex, dropped), placements, generated }, dropped }
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
  const uses = new Map<number, number>()
  for (const entry of wire) uses.set(entry.recipe, (uses.get(entry.recipe) ?? 0) + 1)

  const table = new Map<number, SharedGeneratedBase>()
  recipes.forEach((document, index) => {
    const count = uses.get(index) ?? 0
    const parsed = readGeneratedDocument(document)
    if (parsed === undefined) {
      // A table entry nothing names is not a loss, so it is not reported. That is
      // reachable: an encoder is free to leave one, and a hand-edited payload does.
      if (count > 0) {
        dropped.push(
          `generated recipe ${String(index)}: not a readable base recipe, ` +
            `dropping ${String(count)} base${count === 1 ? '' : 's'}`,
        )
      }
      return
    }
    table.set(index, parsed)
  })

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

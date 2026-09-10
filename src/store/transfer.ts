/**
 * OpenForge Workshop — JSON export and import.
 *
 * This ships in the first commit, not once someone complains, because §13 makes
 * the reason explicit: **Safari evicts `localStorage` after seven days without a
 * visit**, and a tool opened between game sessions hits that timer as a matter
 * of routine. A user who spent an evening laying out a dungeon and comes back a
 * fortnight later must have had a way to keep it that does not depend on the
 * browser's goodwill. A file is that way. (The other is a share link, which PR
 * 10 encodes from the same state.)
 *
 * The format is a small envelope around the persisted state:
 *
 * ```json
 * {
 *   "kind": "openforge-workshop/scene",
 *   "version": 4,
 *   "exportedAt": "2026-08-29T18:00:00.000Z",
 *   "state": { "library": {}, "placements": {}, "generated": {}, "lock": "openlock", "lockChosen": false }
 * }
 * ```
 *
 * `kind` exists so importing the wrong file says so instead of silently
 * producing an empty room; `version` is the store version, and a file at a
 * version this build does not read is **refused with a message**. It goes
 * through the same reader as a blob out of `localStorage` — the same total
 * functions, the same salvaging, the same version gate, and the refusal asks
 * that gate which versions it reads rather than deciding for itself. There is
 * deliberately no second recovery path, and that is what keeps this paragraph
 * short: whatever `migrations.ts` decides about a foreign version, an imported
 * file gets the same decision.
 *
 * ## Why a foreign version is refused rather than read
 *
 * Row V1 changed `library` from a map of files to a map of designs, and the
 * project owner's decision was that nothing is deployed so nothing has to
 * migrate — see `migrations.ts`. A file is a slightly different case from a
 * `localStorage` blob, though, and it is worth saying why the answer is the
 * same. A blob is *this browser's* state and discarding it costs a session; a
 * file is something a person deliberately kept, and reading it wrongly is worse
 * than refusing it, because a room that comes back with an empty library and no
 * message looks like the file was fine. So the refusal is explicit, names the
 * version it found, and changes nothing — the current state is left exactly as
 * it was, which is the same guarantee the "not our file" path already gave.
 *
 * **This does not close row X10's `GeneratedPlacement` hole**, and the version
 * gate cannot: a `base` that disagrees with the `recipe` beside it is a
 * disagreement *within* one version, so no check on the stamp can see it. It is
 * not widened either — the payload still goes through exactly the one reader —
 * and `migrations.ts`'s `salvageGenerated` docblock records what closing it
 * would cost and why the boundary that prevents it is deliberate.
 */
import { z } from 'zod'

import { READABLE_VERSIONS, STORE_VERSION, readPersistedState, readsStoredVersion } from './migrations'
import { WorkshopState } from './schema'
import { useWorkshopStore } from './workshopStore'

/** Discriminator identifying a file as ours. Never change it; add a version instead. */
export const WORKSHOP_EXPORT_KIND = 'openforge-workshop/scene'

/** The export envelope, as written. */
export const WorkshopExport = z.object({
  kind: z.literal(WORKSHOP_EXPORT_KIND),
  version: z.number().int().nonnegative(),
  exportedAt: z.iso.datetime(),
  state: WorkshopState,
})
export type WorkshopExport = z.infer<typeof WorkshopExport>

/**
 * The envelope as *read* — strict about identity, lenient about everything else.
 *
 * `state` is intentionally not validated here. Rejecting the whole file because
 * one placement has a bad coordinate would throw away thirty good ones, so the
 * payload goes to {@link readPersistedState}, which salvages per entry. Only
 * `kind` is a hard requirement *of the parse*, because it is the one field that
 * distinguishes "this file is not ours" — worth an error message — from "this
 * file is ours and partly damaged" — worth a repair.
 *
 * `version` stays optional here and is checked by {@link importWorkshop} instead,
 * so that a file missing it gets the same "which version did you write this at?"
 * message as a file carrying an old one rather than a parse failure that says
 * the file is not ours. It is ours; it is just not readable by this build.
 */
const ReadableEnvelope = z.looseObject({
  kind: z.literal(WORKSHOP_EXPORT_KIND),
  version: z.number().int().nonnegative().optional(),
})

/**
 * Outcome of an import. A result, never an exception: import is driven by a file
 * the user picked, and "you gave me the wrong file" is a normal thing for a
 * person to do, not an error condition for the app.
 */
export type ImportResult =
  | { readonly ok: true; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Serialise the current state.
 *
 * Pretty-printed on purpose: the file is small (a scene is placements, not
 * meshes) and being diffable and hand-editable is worth more than the bytes.
 */
export function exportWorkshop(): string {
  const payload: WorkshopExport = {
    kind: WORKSHOP_EXPORT_KIND,
    version: STORE_VERSION,
    exportedAt: new Date().toISOString(),
    state: useWorkshopStore.getState(),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Replace the current state with an exported one.
 *
 * **Replace, not merge.** Merging would have to invent placement keys for
 * collisions and would leave the user unable to say what they will get; replace
 * makes export → import an identity, which is the property the round-trip test
 * asserts and the one a person expects from "load my file". A user who wants
 * both scenes exports the first one before importing the second.
 *
 * Three outcomes, and the middle one is new in row V1:
 *
 *   - **Not ours, or not JSON.** Nothing changes at all.
 *   - **Ours, at a version this build does not read.** Nothing changes, and the
 *     message names the version. See the module docblock for why refusing beats
 *     reading it.
 *   - **Ours, at this version.** The readable part is imported and everything
 *     unreadable is named in `dropped`.
 *
 * The store is written **only** on the third outcome, which is what makes the
 * first two safe to retry with a different file.
 */
export function importWorkshop(json: string): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, reason: 'That file is not valid JSON.' }
  }

  const envelope = ReadableEnvelope.safeParse(raw)
  if (!envelope.success) {
    return { ok: false, reason: 'That file is not an OpenForge Workshop export.' }
  }

  const version = envelope.data.version
  /* Asked of the reader rather than compared against {@link STORE_VERSION}, so
     this path cannot be left behind when the readable set moves — which is
     exactly what the 8 -> 9 rung would otherwise have done to a file exported
     the day before. `readsStoredVersion` is the one answer to that question. */
  if (!readsStoredVersion(version)) {
    return {
      ok: false,
      reason:
        `That file was exported at version ${version === undefined ? 'unknown' : String(version)}, ` +
        `and this build reads version ${READABLE_VERSIONS.join(' or ')}. Nothing was changed.`,
    }
  }

  // Through the same reader a `localStorage` blob goes through, version and
  // all. The check above asked the reader whether it accepts this stamp, so the
  // reader's own gate cannot fire here — that redundancy is the point rather
  // than something to tidy away: it is what keeps "there is deliberately no
  // second recovery path" literally true, so a change to the reader's policy
  // cannot leave the import path behind.
  const recovered = readPersistedState(envelope.data.state, version)
  useWorkshopStore.setState(recovered.state, true)
  return { ok: true, dropped: recovered.dropped }
}

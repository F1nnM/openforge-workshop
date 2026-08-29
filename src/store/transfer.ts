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
 *   "version": 1,
 *   "exportedAt": "2026-08-29T18:00:00.000Z",
 *   "state": { "library": {}, "placements": {}, "lock": "openlock" }
 * }
 * ```
 *
 * `kind` exists so importing the wrong file says so instead of silently
 * producing an empty room; `version` is the store version, so a file exported
 * today still opens after a future schema change — it walks the same migration
 * ladder as a blob out of `localStorage`, through the same total functions, with
 * the same salvaging behaviour. There is deliberately no second recovery path.
 */
import { z } from 'zod'

import { STORE_VERSION, migrateWorkshopState } from './migrations'
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
 * payload goes to {@link migrateWorkshopState}, which salvages per entry. Only
 * `kind` is a hard requirement, because it is the one field that distinguishes
 * "this file is not ours" — worth an error message — from "this file is ours and
 * partly damaged" — worth a repair.
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
 * A file whose `state` is partly unreadable imports the readable part and names
 * the rest in `dropped`. A file that is not ours changes nothing at all.
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

  const recovered = migrateWorkshopState(envelope.data.state, envelope.data.version ?? STORE_VERSION)
  useWorkshopStore.setState(recovered.state, true)
  return { ok: true, dropped: recovered.dropped }
}

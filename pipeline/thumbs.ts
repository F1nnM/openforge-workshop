/**
 * Which blobs have a `/thumbs/` object — the one input `CatalogRecord.thumb`
 * comes from.
 *
 * ## Why this is a file and not a probe inside the build
 *
 * The build has to be a pure function of the fixtures. `tools/stamp/lock.ts`
 * digests the emitted `{tags, records}` and asserts a biconditional against
 * `(SCHEMA_VERSION, PIPELINE_VERSION)`; a build that reached the network would
 * make that digest a function of a third party's bucket at the moment CI ran,
 * and the lock would fail for reasons nobody could act on. So the *existence
 * question is answered out of band*, by `tools/thumbnails/inventory.ts`, which
 * HEADs every candidate URL through the public hostname and writes the answer
 * here. The build reads a file.
 *
 * That also means the answer is **measured rather than assumed**, which is the
 * whole point: the alternative — deriving `thumb` from the thumbnail tool's
 * *upload manifest* — would say `true` for the 56 objects a `--sample` run has
 * staged **on somebody's laptop**, and staged is not uploaded. The manifest is
 * an inventory of intent; this is an inventory of fact.
 *
 * ## What it says today
 *
 * Probed 2026-09-08 against `https://bucket-openforge-workshop.mfinn.de/thumbs`,
 * all 8,352 distinct sprite-carrying md5s in the index: **8,352 present, 0
 * absent, 0 failed**. So `thumb` is `true` on 8,701 of 8,702 records — the
 * exception carries no sprite sheet to derive a thumbnail from — and the grid
 * renders the 256 px WebP rather than cropping a sprite sheet.
 *
 * It read the mirror of that until this backfill: 0 present, 8,352 absent,
 * probed 2026-09-02, because B2 wanted R2 write credentials for a bucket this
 * project could not write to. The derivative stores now live on one it owns, so
 * the blocker is closed rather than waited on — see `pipeline/version.ts`'s
 * `ASSET_BASES`.
 *
 * Flipping it over took three commands and no code change, which is the sequence
 * to repeat whenever the objects change:
 *
 *   1. the `aws s3 sync` in `tools/thumbnails/out/upload-manifest.json`;
 *   2. `npm run thumbs -- --inventory`, which rewrites this file;
 *   3. `npm run import:catalog`.
 *
 * The upload manifest's own notes carry steps 2 and 3, because that file is what
 * a human holding credentials is reading at the moment step 1 finishes.
 *
 * ## Keyed on md5, and that is not the same shape as the record
 *
 * A thumbnail is content-addressed on the source mesh — `thumbs/{md5[:6]}/{md5}
 * .webp` — so existence is a property of the **blob**, and 171 md5 values are
 * shared by 520 catalog rows. The index carries the flag per record anyway, to
 * match `sprite` and to keep the consumer's read O(1); the redundancy costs
 * nothing compressed (measured: 121 B brotli for 8,702 `false`s) because brotli
 * collapses the repetition. This file is the blob-shaped original.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

/** Version of *this file's* shape, independent of the index and of the tool. */
export const THUMB_INVENTORY_VERSION = 1

/** Checked in, beside `ordinals/manifest.json`, and read by every build. */
export const THUMB_INVENTORY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'thumbs',
  'inventory.json',
)

export const ThumbInventory = z.object({
  note: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** When the bucket was asked. ISO-8601 with a `Z` offset. */
  probed: z.iso.datetime(),
  /** `assets.thumbs` as it stood at probe time — the base the keys hang off. */
  base: z.url(),
  /** Object extension probed, including the dot. */
  extension: z.string().min(2),
  /**
   * How many URLs were asked about, and what came back.
   *
   * `present + absent + failed === probed`. `failed` is anything that was
   * neither 200 nor 404 — a 5xx, a timeout, a DNS failure — and it is **not**
   * folded into `absent`, because "the bucket said no" and "we could not ask"
   * are different facts and only one of them is safe to emit as `thumb: false`.
   * A probe with any failures refuses to write.
   */
  counted: z.object({
    probed: z.number().int().nonnegative(),
    present: z.number().int().nonnegative(),
    absent: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  /** Every md5 that answered 200, sorted. The payload. */
  present: z.array(z.string().regex(/^[0-9a-f]{32}$/)),
})
export type ThumbInventory = z.infer<typeof ThumbInventory>

/**
 * The inventory on disk, or `undefined` when there is none.
 *
 * Absent is a legitimate state — a fresh clone that has never probed — and it
 * means the same thing a probe finding nothing means: no record gets a
 * thumbnail. It is `undefined` rather than an empty inventory so a caller that
 * wants to *report* the difference can, and `scripts/import-catalog.ts` does.
 *
 * @throws when the file is present but does not parse, or when its own version
 *   is not {@link THUMB_INVENTORY_VERSION}. Silently ignoring either would emit
 *   an all-`false` flag that looks exactly like an un-backfilled bucket.
 */
export function readThumbInventory(path: string = THUMB_INVENTORY_PATH): ThumbInventory | undefined {
  if (!existsSync(path)) return undefined
  const parsed = ThumbInventory.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (parsed.version !== THUMB_INVENTORY_VERSION) {
    throw new Error(
      `${path} declares thumbnail inventory version ${String(parsed.version)}; this pipeline ` +
        `understands ${String(THUMB_INVENTORY_VERSION)}. Re-probe with \`npm run thumbs -- --inventory\` — ` +
        'reading it under the old assumptions would emit a `thumb` flag that looks like an ' +
        'un-backfilled bucket.',
    )
  }
  if (parsed.counted.failed > 0) {
    throw new Error(
      `${path} records ${String(parsed.counted.failed)} probe failures. An inventory that could not ` +
        'ask about every object cannot distinguish "no thumbnail" from "no answer"; re-probe with ' +
        '`npm run thumbs -- --inventory`.',
    )
  }
  return parsed
}

/** The md5 set {@link BuildOptions.thumbs} wants. Empty for an absent inventory. */
export function thumbBlobs(inventory: ThumbInventory | undefined): ReadonlySet<string> {
  return new Set(inventory?.present ?? [])
}

export function serialiseThumbInventory(inventory: ThumbInventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

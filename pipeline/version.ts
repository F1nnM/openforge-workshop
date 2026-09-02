/**
 * The pipeline's own constants: derivation version, asset bases, payload budget
 * and the one piece of non-determinism a build has.
 */
import type { CatalogAssets } from '../src/catalog'

/**
 * Version of the **derivation rules** in this directory — not of the record
 * shape, which is `SCHEMA_VERSION` and belongs to `src/catalog/schema.ts`.
 *
 * Bump it when a field's meaning changes without the schema changing: a
 * different footprint tie-break, a different kind vocabulary, a different way of
 * folding connection variants. The two numbers move independently, which is why
 * `VersionStamp` carries both.
 */
export const PIPELINE_VERSION = 1

/**
 * Payload budget, brotli, for the emitted `catalog.json`.
 *
 * §5: 261 KB is the measured floor **for a slim index that carries neither full
 * tags nor composition configs**, and this pipeline emits both. 500 KB is the
 * plan's budget and the number CI fails on; the actual figure is printed by
 * every import so the headroom is never a guess.
 *
 * **Measured, 8,702 records: 355.8 KB brotli** (5.42 MB raw, 465.7 KB gzip) —
 * 71% of budget. Adding full tags and configs to the slim index cost 24.8 KB
 * between them, not the doubling §5 feared. `assertWithinBudget` in `emit.ts`
 * records why, and what the actual lever is.
 */
export const SIZE_BUDGET_BYTES = 500 * 1024

/**
 * Where derived files live.
 *
 * Verified across all 8,702 live rows with zero exceptions: every
 * `storage_address` is `{models}/{md5[0:6]}/{md5}.stl` and every sprite URL is
 * the same under `{sprites}` with `.png`. Storing those two URLs per record
 * would add roughly 600 KB of raw JSON to say the same thing 8,702 times, so
 * the record carries neither and `shardedPath` rebuilds them. `build.test.ts`
 * asserts the reconstruction against every fixture row, because the whole saving
 * turns into an 8,702-way 404 if the convention ever changes.
 *
 * No trailing slash: consumers join with `/`.
 */
export const ASSET_BASES: CatalogAssets = {
  models: 'https://objects.openforge.tools/models',
  sprites: 'https://objects.openforge.tools/sprites',
  thumbs: 'https://objects.openforge.tools/thumbs',
  lod: 'https://objects.openforge.tools/lod',
}

/**
 * The build timestamp.
 *
 * `SOURCE_DATE_EPOCH` (the reproducible-builds convention, in whole seconds)
 * overrides the clock. Without it a build is not byte-reproducible, because
 * `version.built` is a clock reading — so the determinism test pins it, and a
 * release build that wants a reproducible artefact sets it from the source
 * commit's timestamp.
 */
export function buildTimestamp(now: () => number = Date.now): string {
  const pinned = process.env.SOURCE_DATE_EPOCH
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    return new Date(Number(pinned.trim()) * 1000).toISOString()
  }
  return new Date(now()).toISOString()
}

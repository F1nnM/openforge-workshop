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
 *
 * **Row A1 did not bump it, and row X4 — which owns this stamp across five
 * artefacts — needs the reason.** Aggregation changed no field's derivation and
 * added none: it groups the records the pipeline already emits, by the `design`
 * key `pipeline/design.ts` already computes, and emits nothing of its own. What
 * the build gained is a *check* — `pipeline/aggregate.ts` fails the build when a
 * field the aggregate hoists onto a card is not constant within a group — and a
 * check is not a derivation. `SCHEMA_VERSION` stays 3 for the same reason; its
 * docblock carries the payload measurement behind that decision.
 *
 * **Row C1 did not bump it either, and the reason is the same one twice over.**
 * `constrain` resolution is derived in the browser by `src/composition/`, so no
 * field's derivation changed, no field was added, and **the emitted record shape
 * is byte-identical**: the `config` block is still carried through from the
 * fixture verbatim, unresolved, exactly as `pipeline/fixtures.ts` describes it.
 * What the build gained is again a check — {@link BuildStats.configRefs}'
 * companion `assertConfigRefs` in `build.ts` — plus three stats fields, and
 * neither a check nor a report is a derivation. Note what a bump *would* have
 * meant here: `PIPELINE_VERSION` is what a consumer memoises a derived layer on,
 * and moving it would invalidate every cached aggregate and search index to
 * announce a change no consumer can observe.
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
 *
 * **The reshape and the aggregate, re-measured.** Rows W4 and W5 took it to
 * **365,474 B brotli — 71.4%** (5,739,104 B raw). Row A1 added **0 bytes**: the
 * aggregate layer is derived in the browser, and the reason is arithmetic. Its
 * leanest emittable form — design id, address and the member ordinals, no
 * hoisted facets and no variant detail — measures **40,454 B brotli**, which
 * would take the index to 79.3% to say something a reader recomputes in one pass
 * over data it already holds.
 *
 * **Row C1 added 0 bytes too, and it turned out not to be a budget question.**
 * The plan expected candidate sets of 29 KB to 9.4 MB and named them the real
 * threat to this budget. Measured, all four encodings this row could have
 * shipped fit: the leanest is 513 B brotli and the fattest — a per-tile-slot set
 * of full catalog ids, 15,107,263 B *raw*, which is the 9.4 MB order the plan
 * feared — is **37,542 B brotli** against the 146,597 B free here. So the
 * argument for deriving is not the payload; it is that `constrain` is a join
 * over runtime sibling selections, so any precomputed set is stale after one
 * click. `src/composition/measure.ts` carries the whole table and
 * `src/composition/corpus.test.ts` re-measures every figure in it. **A reading
 * chosen because it fit the budget would have been the wrong reading, and this
 * one was not chosen that way.**
 *
 * One caveat on any before/after comparison, established by W4: `version.built`
 * is a clock reading, and the timestamp alone swings brotli by roughly ±210 B.
 * CI does not pin `SOURCE_DATE_EPOCH`. A trustworthy delta therefore has to
 * re-serialise one built file both ways rather than subtract two build outputs.
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

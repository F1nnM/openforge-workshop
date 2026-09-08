/**
 * The pipeline's own constants: derivation version, asset bases, and the one
 * piece of non-determinism a build has.
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
 *
 * ## Row X4 made that distinction enforceable rather than conventional
 *
 * Three rows in a row have now decided this by argument in a docblock, and a
 * fourth would have inherited nothing but the prose. So the rule is now a test
 * with a failure message, and it is a **biconditional**:
 *
 *   > The emitted `{tags, records}` change if and only if `(SCHEMA_VERSION,
 *   > PIPELINE_VERSION)` change.
 *
 * `tools/stamp/derivation.lock.json` records the sha256 of that pair of fields,
 * built over the pinned fixture corpus with an empty ordinal manifest and
 * {@link PAYLOAD_TIMESTAMP} — so the digest is a function of the derivation
 * code, the schema and the corpus, and of nothing else. `tools/stamp/lock.ts`
 * checks it both ways, and both directions fail with the reason:
 *
 *   - digest moved, versions did not → *a derivation changed and nothing
 *     announced it.* This is the failure W4 and W5 would each have hit had they
 *     forgotten, and the one a future row will hit.
 *   - versions moved, digest did not → *a check is not a derivation.* This is
 *     A1's and C1's claim, and it is now checked rather than asserted in prose.
 *     Adding an `assert*` to `build.ts` cannot trip the first rule, because an
 *     assertion emits nothing; bumping to announce one trips the second.
 *
 * `ASSET_BASES` and `MEASURED_SPRITE_SHEET` are locked separately, under
 * `config`, because they are configuration this module stamps in rather than
 * anything the pipeline derives. Changing a base URL therefore has to be
 * re-locked deliberately, and is attributed as configuration rather than
 * silently demanding a version bump.
 *
 * ## Row B1 is the first row that had to bump it, and it is the easy direction
 *
 * Three rows in a row declined the bump and argued it in prose; this one takes
 * it in one line, because the biconditional above answers it without a
 * judgement call. `pipeline/role.ts` adds a **derivation**, not a check: the
 * emitted `tags` table goes 915 → 930 strings and every record's `tags` array
 * gains two ids, so the locked digest moves. Under rule one, a digest that
 * moves with the versions standing still is *a derivation that changed and
 * nothing announced it* — so the version moves with it.
 *
 * `SCHEMA_VERSION` stays 4, and that is the interesting half. Role and form are
 * emitted as **ordinary interned tags**, so no field was added, no field's type
 * changed, and `CatalogRecord` is byte-for-byte the same shape it was — a
 * consumer that has never heard of `role|wall` reads this index exactly as it
 * read the last one. The record *shape* is `SCHEMA_VERSION`'s subject and the
 * record *content* is this one's, and this row is the cleanest example of the
 * split the two numbers exist to express.
 *
 * ## Row D9 is the second bump, and it is the case this docblock names first
 *
 * *"Bump it when a field's meaning changes without the schema changing: a
 * different footprint tie-break…"* — and this is a different footprint
 * derivation. `resolveFootprint` gives a corner wall tagged `size|width|2` a
 * run of **1.5** rather than 2, on **245 records**, because row D9 fetched 157
 * corner-wall meshes from R2 and measured them: the tag names the cell and the
 * piece is the cell face less the 0.5 column. `pipeline/footprint.ts#cornerWallRun`
 * is the rule and `docs/templates-plan.md` §9 is the measurement.
 *
 * The biconditional decides it with no judgement call, exactly as B1's line
 * says it should: the emitted `{tags, records}` digest moves — 245 records write
 * a different `foot.length` and a different size token — so the version moves
 * with it. The stamp gate caught this row having forgotten, which is the failure
 * mode the rule was written for, and it named the fix.
 *
 * `SCHEMA_VERSION` stays 4 for the third time. No field was added, no field's
 * type changed, and `foot.length` means what it always meant — *the end-to-end
 * run of the wall*. What changed is that on 245 records it is now **true**. A
 * consumer needs no new code to read this index; it needs its caches
 * invalidated, which is precisely what this number is for.
 */
export const PIPELINE_VERSION = 3

/**
 * A fixed clock reading, so two builds of two branches are comparable.
 *
 * Not the build clock and not a substitute for it: {@link buildTimestamp} still
 * records when a build happened, and CI pins `SOURCE_DATE_EPOCH` so that a given
 * tree builds to the same bytes twice. This constant exists for the other
 * problem — that a build on one branch has to be diffable against a build on
 * another, and a real clock reading makes every byte of the artefact move for a
 * reason nobody can act on.
 *
 * The one caller is the derivation lock: `tools/stamp/lock.ts` rebuilds the
 * index at this timestamp so its digest is a fact about the *tree* rather than
 * about when the digest was taken. It used to normalise the payload
 * measurement too; that measurement is gone.
 *
 * `2026-01-01T00:00:00Z`, chosen because `pipeline/catalog.test.ts` was already
 * using that literal as its pinned `builtAt` and two pinned clocks would be one
 * too many.
 */
export const PAYLOAD_EPOCH = 1767225600

/** {@link PAYLOAD_EPOCH} as `version.built` writes it. */
export const PAYLOAD_TIMESTAMP = '2026-01-01T00:00:00.000Z'

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
 * ## Two origins, and which half is ours
 *
 * `models` and `sprites` are upstream OpenForge's bucket, which this project can
 * read and cannot write. `thumbs` and `lod` are **derivatives this project
 * produces**, and both backfills were blocked on one write credential for a
 * bucket somebody else owns (`docs/launch-blockers.md` B2). They are therefore
 * served from `bucket-openforge-workshop.mfinn.de` — our own R2 bucket, same two
 * prefixes, same sharded layout — which is a hostname change and nothing more:
 * `shardedPath` still rebuilds every object URL, and 106.13 GB of source STL
 * stays where it is rather than being mirrored.
 *
 * The split is load-bearing for `tools/lod/catalog.ts`'s `lodBase`, which checks
 * the LOD base against `thumbs` rather than `models` precisely because these two
 * travel together and the other two do not.
 *
 * No trailing slash: consumers join with `/`.
 */
export const ASSET_BASES: CatalogAssets = {
  models: 'https://objects.openforge.tools/models',
  sprites: 'https://objects.openforge.tools/sprites',
  thumbs: 'https://bucket-openforge-workshop.mfinn.de/thumbs',
  lod: 'https://bucket-openforge-workshop.mfinn.de/lod',
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

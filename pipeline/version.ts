/**
 * The pipeline's own constants: derivation version, asset bases, payload budget
 * and the one piece of non-determinism a build has.
 */
import type { CatalogAssets, CatalogFile } from '../src/catalog'

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
 * **Row X4 closed the caveat every figure above had to carry.** W4 established
 * that `version.built` is a clock reading and estimated its brotli swing at
 * ~210 B; W5, A1 and C1 each worked around it by hand, re-serialising one file
 * twice to isolate a delta. Measured properly — the same 8,702-record file
 * serialised at 32 distinct timestamps — the swing is larger than the estimate:
 * **364,934 B to 365,589 B, a spread of 655 B**, median 365,403 B. So the
 * ±110 B those rows quoted was optimistic by a factor of three, and a 1,070 B
 * delta was closer to the noise floor than it read.
 *
 * Two mechanisms replace it, and neither alone is sufficient:
 *
 *   1. **CI pins `SOURCE_DATE_EPOCH`** to the committer timestamp of the commit
 *      being built (`.github/workflows/ci.yml`). That makes one tree's build
 *      byte-reproducible, which is what a rerun, a cache and a diff of two runs
 *      of the same commit need. It does *not* make two branches comparable —
 *      two commits have two timestamps.
 *   2. **Every payload figure is measured at {@link PAYLOAD_EPOCH}**, a fixed
 *      constant, via {@link atPayloadEpoch}. That is what makes a figure
 *      quotable across branches without re-serialising anything by hand, and it
 *      is the same normalisation the derivation lock digests under.
 *
 * At the payload epoch, on the pinned corpus: **365,403 B brotli — 71.4% of
 * budget** (5,739,104 B raw, 478,673 B gzip). Every figure in this docblock
 * above predates the normalisation and carries the old ±328 B; this one does
 * not.
 *
 * **Row P3 took it to 365,603 B — still 71.4%** (5,858,260 B raw), by adding
 * `CatalogRecord.thumb`. Three things about that 200 B are worth recording,
 * because two of them are about the instrument rather than about the field:
 *
 *   1. **The shipped delta is +200 B**, pipeline to pipeline, both normalised
 *      here. `src/generator/panel/corpus.test.ts` asserts the new baseline.
 *   2. **Isolating the key alone gives +337 B**, taking the same built file and
 *      stripping `thumb` back out. The two disagree because `version.schema`
 *      also went 3 to 4 — one byte, in a different place — and brotli is not
 *      additive at this granularity. Neither figure is wrong; the first is the
 *      artefact and the second is the field.
 *   3. **Normalisation is necessary but not sufficient.** Measured across 32
 *      clock readings, that key-only delta runs **−125 B to +752 B** (median
 *      +228). It can be *negative*: 121,828 raw bytes of `"thumb":false,` can
 *      make the compressed artefact smaller. The spread is 877 B — wider than
 *      the 655 B the clock alone swings — so "this field costs N bytes" is a
 *      fact about one artefact at one epoch and never a rate.
 *
 * **What actually threatens the budget is the middle of the backfill, not the
 * end of it.** A uniform boolean compresses away; a half-true one does not.
 * Measured at this epoch, `thumb: true` on the first N of 8,352 blobs:
 *
 *     0 blobs …………… 365,603 B  (71.4%)     4,176 …… 372,979 B  (72.8%)
 *     56 ……………………… 365,918 B  (71.5%)     6,264 …… 371,299 B  (72.5%)
 *     1,000 ………………… 368,796 B  (72.0%)     8,352 …… 365,603 B  (71.4%)
 *     2,088 ………………… 371,266 B  (72.5%)
 *
 * So the worst case is **+7,376 B at 50% coverage**, and it is transient: the
 * backfill is one `aws s3 sync` and the index is only rebuilt after it. 1.4
 * points of a 500 KB budget for a state that lasts as long as one upload is not
 * a reason to encode the flag as an exception list, which is the alternative
 * that was measured (+23 B uniform, but O(33 B) per exception raw and a set
 * lookup at every consumer).
 *
 * **Row B1 took it to 366,173 B — 71.52%** (5,907,324 B raw), by emitting the
 * derived `role|<x>` and `form|<x>` axes as interned tags. Two figures, and P3's
 * distinction between them is now the third time it has mattered:
 *
 *   1. **The shipped delta is +544 B**, artefact to artefact, pipeline 1's
 *      365,629 B against pipeline 2's 366,173 B, both normalised here.
 *   2. **Isolating the axes alone gives +468 B** — the same built file with the
 *      15 derived tag strings stripped, the table rebuilt and the version stamp
 *      left at 2. `pipeline/role.test.ts` asserts this one, because it is
 *      self-contained and does not need a stale version number pinned in a test.
 *   3. The two disagree by **76 B, which is the cost of `version.pipeline` going
 *      from `1` to `2`** — one character, in a different place. That is the same
 *      non-additivity P3 measured at this granularity, and it is why the ±110 B
 *      those early rows quoted was never a rate.
 *
 * **The row was priced at +865 B and that figure does not reproduce.** Two
 * reasons, and the second is the interesting one:
 *
 *   - The research measured the encoding by appending the 15 derived strings to
 *      the *tail* of the existing 915-entry table, so no existing id moved and
 *      each new reference cost three digits. `buildTagTable` orders by
 *      descending frequency instead, so the two commonest derived values take
 *      ids 0 and 1 and every existing id shifts up. Re-measured against the
 *      pipeline-1 baseline, tail-append costs **+776 B** and frequency-ordered
 *      **+1,111 B** — so on that baseline the ordering was the *expensive*
 *      choice, and it is still the right one, because `buildTagTable`'s docblock
 *      makes the table a pure function of the corpus and 335 B does not buy an
 *      exception to that.
 *   - Change one character of the version stamp and the frequency-ordered
 *      artefact drops from 366,740 B to 366,173 B while the plain one *rises*
 *      from 365,629 B to 365,705 B. The delta the same code produces is +1,111 B
 *      at pipeline 1 and +468 B at pipeline 2. There is no single number here to
 *      have got right; there is an artefact size, measured, and this docblock is
 *      where it is written down.
 *
 * One prediction the row also had to correct: **`role|wall` does not take tag id
 * 0.** It was expected to, as the corpus's most frequent tag at 5,381
 * references. `form|straight` is on 5,707, so it takes 0 and `role|wall` takes
 * 1. Both are one digit, which is the property the price rested on, so the
 * argument survives its own premise being wrong.
 *
 * **Row D9 took it to 366,677 B — 71.62%** (5,905,632 B raw), by correcting 245
 * corner walls from a tagged 2-unit run to their measured 1.5. The same three
 * figures, and the split between them is the same one P3 and B1 each recorded:
 *
 *   1. **The shipped delta is +504 B**, artefact to artefact, pipeline 2's
 *      366,173 B against pipeline 3's 366,677 B, both normalised here.
 *   2. **Isolating the footprint change alone gives +493 B** — this corpus at
 *      this epoch with the version stamp held at 2, which measures 366,666 B.
 *      Its counterpart is not an estimate: building from a tree with only
 *      `pipeline/footprint.ts` reverted reproduces row B2's pinned index digest
 *      `cf21ab85ac304a20…` **byte for byte** at 366,173 B, so the isolation is
 *      exact in both directions. `pipeline/templates.test.ts` carries both
 *      digests.
 *   3. The two disagree by **11 B, which is `version.pipeline` going 2 to 3** —
 *      one character, in a different place, and the third time this docblock has
 *      had to record that number for a different row.
 *
 * The raw side is the honest one to reason about and the compressed side is not:
 * 245 records writing `"length":1.5` for `"length":2` and `1.5x` for `2x` is
 * **+980 raw bytes** and +504 compressed, while the counterfactuals two other
 * tests measure against this same artefact moved by −179 B and +223 B on the
 * *same* change. See `pipeline/templates.test.ts`, where the 128-row `layouts`
 * key went +808 → **−71** → +396 B across this row's two halves without one byte
 * of the table itself changing.
 */
export const SIZE_BUDGET_BYTES = 500 * 1024

/**
 * The epoch every payload figure is measured at.
 *
 * Not the build clock and not a substitute for it: {@link buildTimestamp} still
 * records when a build happened, and CI pins `SOURCE_DATE_EPOCH` so that a given
 * tree builds to the same bytes twice. This constant exists for the other
 * problem — that a *quoted* brotli figure has to be comparable to one quoted on
 * another branch, and a clock reading makes it swing 655 B for no reason anyone
 * can act on. Anything that reports or gates on a payload size normalises to
 * this first.
 *
 * `2026-01-01T00:00:00Z`, chosen because `pipeline/catalog.test.ts` was already
 * using that literal as its pinned `builtAt` and two pinned clocks would be one
 * too many.
 */
export const PAYLOAD_EPOCH = 1767225600

/** {@link PAYLOAD_EPOCH} as `version.built` writes it. */
export const PAYLOAD_TIMESTAMP = '2026-01-01T00:00:00.000Z'

/**
 * The same file with its clock reading replaced by {@link PAYLOAD_TIMESTAMP}.
 *
 * A shallow copy: the records array is shared, because nothing here mutates it
 * and cloning 8,702 records to change one string would be the expensive way to
 * measure a size.
 */
export function atPayloadEpoch(file: CatalogFile): CatalogFile {
  return { ...file, version: { ...file.version, built: PAYLOAD_TIMESTAMP } }
}

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

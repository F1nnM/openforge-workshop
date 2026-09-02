/**
 * The platform limits this Worker is designed against, and the budgets derived
 * from them.
 *
 * Everything here is a number with an argument attached. A Worker that streams
 * multi-gigabyte archives is bounded by four different platform limits at once,
 * and the only way to know a design survives is to write the arithmetic down.
 *
 * ## The limits (Workers Paid, the plan this project deploys on)
 *
 * | Limit | Figure | What it forces |
 * | --- | --- | --- |
 * | Memory | **128 MB per isolate** | {@link WORST_CASE_ARCHIVE_BYTES} is 1.6435 GB — **12.8× the whole isolate.** The archive can never be buffered, not in a `Blob`, not in an array of chunks, not in a `Response` body that is awaited. This is the limit that dictates the entire shape of `stream.ts`. And the isolate is *shared* between concurrent invocations, so peak memory has to be O(chunk) rather than O(archive) for a second download to be servable at all. |
 * | CPU time | **30,000 ms default, 300,000 ms configurable maximum** | Measured, not guessed: the vendored `client-zip` writes STORE entries at **488 MB/s of CPU** (256,000,966 bytes of archive in 524 ms of CPU, node 22 / V8), i.e. **2,048 ms of CPU per GB** — almost all of it CRC-32. The 1.6435 GB worst case is therefore **3,366 ms of CPU**, and {@link MAX_ARCHIVE_BYTES} is 16,384 ms. `wrangler.jsonc` raises `limits.cpu_ms` because the *cap*, not the worst case, is what has to fit. |
 * | Subrequests | **1,000 per invocation** (50 on the free plan) | One `fetch` per distinct model object, so this is a hard ceiling on files per archive. See {@link MAX_ARCHIVE_FILES}. |
 * | Simultaneous open connections | **6** | Caps how far ahead bodies may be opened. See {@link PREFETCH_DEPTH}. |
 *
 * Wall-clock time is deliberately absent from that table: a Worker has no
 * duration limit while it is doing I/O, and this one is almost entirely I/O. The
 * 1.6435 GB worst case takes **144–483 seconds** at the bucket throughput row W1
 * measured (11.4 MB/s best, 3.4 MB/s worst single-stream), and that is fine —
 * what would not be fine is 483 seconds of *CPU*.
 *
 * ## Why concurrency is not the answer to those 483 seconds
 *
 * W1 measured 3.4–11.4 MB/s single-stream and 7.2–11.0 MB/s aggregate at
 * concurrency 8. The aggregate range sits *inside* the single-stream range: the
 * ceiling is the bucket's, not the client's, so eight connections move no more
 * bytes than one. Fetching wider would spend connections and memory to buy
 * nothing, and `cf-cache-status: DYNAMIC` (blocker B1 — no cache rule exists
 * yet) means every one of those reads hits R2 origin regardless. So the design
 * opens one body ahead, purely to hide the next object's time-to-first-byte
 * behind the current object's transfer.
 */

/** The stated worst case: 50 placements at the corpus p95 of 32.87 MB. */
export const WORST_CASE_ARCHIVE_BYTES = 1_643_500_000

/**
 * Subrequests a single invocation may issue. Cloudflare's own limit, restated
 * here because every budget below is a fraction of it.
 *
 * 1,000 on Workers Paid; 50 on the free plan, which is below even a median room
 * and is the reason this Worker is not deployable to a free zone.
 */
export const SUBREQUEST_LIMIT = 1_000

/**
 * Subrequests held back from {@link MAX_ARCHIVE_FILES}.
 *
 * Not padding. A followed redirect counts as a further subrequest, and this
 * Worker refuses a redirect that leaves the models path rather than following it
 * blindly — but it still paid for the hop. 100 leaves room for that and for
 * anything the runtime bills that this code did not initiate.
 */
export const SUBREQUEST_RESERVE = 100

/**
 * Distinct model files one archive may hold.
 *
 * `SUBREQUEST_LIMIT - SUBREQUEST_RESERVE`, because the fetch count is exactly
 * the file count: one body per md5, opened once, never retried mid-body (a retry
 * cannot resume a partially written ZIP entry, so there is nothing to retry
 * *into*).
 *
 * Against the worst case the plan actually states, this is not the binding
 * constraint and the arithmetic says so plainly:
 *
 *   - **1.6435 GB / 50 objects → 50 subrequests, 5.0% of the 1,000 limit** and
 *     5.6% of this budget.
 *   - 900 files at the corpus median of 10.36 MB is 9.32 GB; at the p95 of
 *     32.87 MB it is 29.58 GB. Both are past {@link MAX_ARCHIVE_BYTES}, so in
 *     practice the byte cap bites first for large files and this cap bites first
 *     for many small ones.
 *   - The whole live corpus is 8,353 blobs — **9.28× this budget.** "Download
 *     everything" is not a request this Worker can serve, and it fails saying so
 *     rather than by exhausting subrequests two thirds of the way through a
 *     download.
 */
export const MAX_ARCHIVE_FILES = SUBREQUEST_LIMIT - SUBREQUEST_RESERVE

/**
 * Total model bytes one archive may hold: 8 GB.
 *
 * Derived from wall clock rather than from CPU, because CPU has three orders of
 * magnitude of headroom and patience does not. At the throughput W1 measured
 * against this bucket, 8 GB is **11.7 minutes at 11.4 MB/s and 39.2 minutes at
 * 3.4 MB/s** — the outer edge of what a phone on a hotel network will hold open.
 * It is 4.87× the 1.6435 GB the plan calls the worst case, and 16,384 ms of CPU
 * at the measured 2,048 ms/GB, which is 5.5% of the configured 300,000 ms limit.
 *
 * Past it the honest answer is §11's degradation path — the URL list — and the
 * error says so.
 */
export const MAX_ARCHIVE_BYTES = 8_000_000_000

/**
 * Model bodies opened ahead of the one being written: one.
 *
 * At most two connections are open at any moment, against Cloudflare's limit of
 * six. Depth 1 hides the next object's TTFB and nothing more, which is all
 * there is to win — see the module docblock on why concurrency buys no
 * bandwidth here.
 */
export const PREFETCH_DEPTH = 1

/** Bytes between progress log lines. One per 64 MB of a 1.6 GB archive is 26 lines. */
export const LOG_INTERVAL_BYTES = 64_000_000

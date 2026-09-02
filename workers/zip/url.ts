/**
 * The one URL shape this Worker will fetch — the Worker's copy of the rule
 * `src/download/source.ts` states for the browser path.
 *
 * ## Why it is a copy, and how the copy is kept honest
 *
 * The client path's rule lives in `src/download/source.ts`, and this module
 * would import it if it could. It cannot: `source.ts` reads `shardedPath` from
 * `@/catalog`, which is `src/catalog/schema.ts`, which is **zod** — a runtime
 * dependency this Worker has no other use for and no business paying a cold
 * start for.
 *
 * So the regex, the derivative-segment list and the composition are restated
 * here, and `url.test.ts` imports the real `src/download/source.ts` and asserts
 * the two agree: same pattern source, same segment list, and
 * `modelStlUrl(base, md5) === originalStlUrl({ models: base }, md5)` over a
 * table of addresses. A test can afford zod; the Worker bundle cannot. That is
 * the whole of the arrangement, and `workers/zip/README` — there isn't one; see
 * the PR description — records it as a seam rather than pretending it is not
 * duplication.
 *
 * ## Why the Worker composes the URL instead of being handed one
 *
 * The request format carries an md5 and never a URL. Two reasons, and the
 * second is the one that matters:
 *
 *   1. §10, obligation 3, the same reason `source.ts` gives: a path that accepts
 *      a URL is a path that can be pointed at `/thumbs/` or a future decimated
 *      store, and a preview mesh reaching somebody's printer is a trust failure
 *      they discover hours later on the plate.
 *   2. **A public Worker that fetches a caller-supplied URL is an open proxy.**
 *      Anyone could borrow this Worker's egress and its Cloudflare-internal
 *      routing to fetch arbitrary hosts. The bucket base is therefore a Worker
 *      `var` (`MODELS_BASE` in `wrangler.jsonc`), never wire input, and the md5
 *      is validated to 32 hex characters before it goes anywhere near a
 *      template string.
 */

/**
 * The only URL shape this Worker will fetch.
 *
 * Byte-for-byte the pattern `src/download/source.ts` exports as
 * `ORIGINAL_STL_URL`, pinned by `url.test.ts`. Verified there across all 8,702
 * live rows with zero exceptions: every `storage_address` is exactly
 * `https://objects.openforge.tools/models/{md5[0:6]}/{md5}.stl`.
 */
export const MODEL_STL_URL = /^https:\/\/[^/?#]+(?:\/[^/?#]+)*?\/models\/([0-9a-f]{6})\/([0-9a-f]{32})\.stl$/

/**
 * Path segments that mean "this is a derivative, not the original".
 *
 * Kept identical to `src/download/source.ts`'s list, pinned by `url.test.ts`,
 * because a segment added there and missed here is precisely the drift that
 * would let one of the two download paths ship a preview mesh.
 */
export const DERIVATIVE_PATH_SEGMENTS: readonly string[] = ['sprites', 'thumbs', 'thumbnails', 'previews', 'preview', 'lod', 'lods', 'decimated']

/** The bucket base used when `MODELS_BASE` is not bound. Matches the catalog index. */
export const DEFAULT_MODELS_BASE = 'https://objects.openforge.tools/models'

/** A content address, as it appears on the wire and in an entry name. */
export const MD5 = /^[0-9a-f]{32}$/

/**
 * A URL was asked for that is not an original STL.
 *
 * Its own type rather than a plain `Error` for the reason `source.ts` gives: the
 * caller must not offer a retry, because this is a wiring fault and retrying it
 * would eventually succeed at shipping the wrong mesh.
 */
export class ModelUrlError extends Error {
  readonly url: string

  constructor(url: string, reason: string) {
    super(`refusing to fetch ${url}: ${reason}. This Worker serves original STLs only (plan section 10).`)
    this.name = 'ModelUrlError'
    this.url = url
  }
}

/**
 * `{base}/{md5[0:6]}/{md5}.stl`, validated after composition rather than before.
 *
 * Validating the *output* is what makes a misconfigured `MODELS_BASE` — pointed
 * at the sprite bucket, say — a startup error instead of an archive full of
 * PNGs. The two-level shard is the bucket's own layout, not an invention here.
 */
export function modelStlUrl(base: string, md5: string): string {
  if (!MD5.test(md5)) {
    throw new ModelUrlError(`${base}/…/${md5}.stl`, `"${md5}" is not a 32-character lowercase md5`)
  }

  const url = `${base.replace(/\/+$/, '')}/${md5.slice(0, 6)}/${md5}.stl`

  const match = MODEL_STL_URL.exec(url)
  if (match === null) throw new ModelUrlError(url, 'not the verified original-model URL shape')

  const [, shard, address] = match
  if (address !== md5) throw new ModelUrlError(url, `md5 in the path (${String(address)}) is not the requested blob`)
  if (shard !== md5.slice(0, 6)) throw new ModelUrlError(url, `shard ${String(shard)} does not match the md5`)

  const segments = new URL(url).pathname.split('/').slice(1, -2)
  const derivative = segments.find((segment) => DERIVATIVE_PATH_SEGMENTS.includes(segment.toLowerCase()))
  if (derivative !== undefined) throw new ModelUrlError(url, `path segment "${derivative}" names a derivative store`)

  return url
}

/**
 * Whether a URL the bucket redirected us to is still an original-model URL.
 *
 * Split out because `bucket.ts` checks a *response*'s URL, which it did not
 * compose and cannot re-derive from an md5.
 */
export function isModelStlUrl(url: string): boolean {
  return MODEL_STL_URL.test(url)
}

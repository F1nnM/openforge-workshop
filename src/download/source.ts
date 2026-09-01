/**
 * Where the bytes come from — and the guard that they are the **original** mesh.
 *
 * §10, obligation 3: *"Decimated preview meshes are Adapted Material — label
 * them 'preview, not for printing', licence derivatives BY-NC-SA, keep them out
 * of the download path."* Shipping a decimated mesh to somebody's printer is a
 * trust failure that the recipient discovers hours later, on the plate, so this
 * module is built so that the mistake has nowhere to happen:
 *
 *   1. **The download path never accepts a URL.** {@link BlobSource.open} takes a
 *      {@link BlobId} — the branded md5 — and nothing else. There is no argument
 *      a caller could point at `/sprites/`, `/thumbs/`, or a future LOD store,
 *      and `BlobId`'s brand means a preview's own identifier is not even the
 *      right *type*. This is the structural half of the guard, and it is the
 *      half that matters.
 *   2. **The one URL builder validates its own output.**
 *      {@link originalStlUrl} composes `assets.models` with
 *      {@link shardedPath} and then re-parses the result against
 *      {@link ORIGINAL_STL_URL}, which demands a `/models/` segment, the six-hex
 *      shard, the full md5 and a `.stl` extension — and rejects any path segment
 *      naming a derivative store. A misconfigured `assets.models` (pointing at
 *      the sprite bucket, say) throws here instead of filling an archive with
 *      PNGs.
 *   3. **The response is checked too.** A redirect that lands somewhere else,
 *      or a `Content-Type` of `image/*`, is refused. Cheap, and it covers the
 *      case where the bucket, not the code, is wrong.
 *
 * The whole of the network surface is behind {@link BlobSource} so tests need no
 * network and never touch R2.
 */
import type { BlobId, CatalogAssets } from '@/catalog'
import { shardedPath } from '@/catalog'

/**
 * The only URL shape the download path will fetch.
 *
 * Verified across all 8,702 live rows with **zero exceptions**: every
 * `storage_address` is exactly
 * `https://objects.openforge.tools/models/{md5[0:6]}/{md5}.stl`. HTTPS only, and
 * a path that ends in the shard, the md5 and `.stl`. Intermediate path segments
 * are allowed so the bucket can move behind a prefix, but `/models/` must be the
 * segment that introduces the shard.
 */
export const ORIGINAL_STL_URL = /^https:\/\/[^/?#]+(?:\/[^/?#]+)*?\/models\/([0-9a-f]{6})\/([0-9a-f]{32})\.stl$/

/**
 * Path segments that mean "this is a derivative, not the original".
 *
 * `sprites` and `thumbs` exist today ({@link CatalogAssets}); the rest are named
 * ahead of the store that would use them, because the failure this list prevents
 * is somebody adding a decimated-mesh bucket and reaching for the nearest URL
 * builder.
 */
export const DERIVATIVE_PATH_SEGMENTS: readonly string[] = ['sprites', 'thumbs', 'thumbnails', 'previews', 'preview', 'lod', 'lods', 'decimated']

/**
 * The download path was asked for something that is not an original STL.
 *
 * A distinct type rather than a plain `Error` because the UI must not offer a
 * retry: this is a wiring fault, not a transient one, and retrying it would
 * eventually succeed at shipping the wrong mesh.
 */
export class PreviewMeshRefusedError extends Error {
  readonly url: string

  constructor(url: string, reason: string) {
    super(`refusing to download ${url}: ${reason}. The download path serves original STLs only (§10).`)
    this.name = 'PreviewMeshRefusedError'
    this.url = url
  }
}

/** A blob could not be fetched. Carries enough to say which one and why. */
export class BlobFetchError extends Error {
  readonly blob: BlobId
  readonly url: string

  constructor(blob: BlobId, url: string, reason: string, options?: ErrorOptions) {
    super(`could not fetch ${blob} from ${url}: ${reason}`, options)
    this.name = 'BlobFetchError'
    this.blob = blob
    this.url = url
  }
}

/**
 * The URL of the original STL for a content address.
 *
 * The single place a model URL is built anywhere in the download path. It
 * validates what it produced rather than trusting what it was given — see the
 * module note.
 */
export function originalStlUrl(assets: Pick<CatalogAssets, 'models'>, blob: BlobId): string {
  const url = `${assets.models.replace(/\/+$/, '')}/${shardedPath(blob)}.stl`

  const match = ORIGINAL_STL_URL.exec(url)
  if (match === null) {
    throw new PreviewMeshRefusedError(url, 'not the verified original-model URL shape')
  }
  const [, shard, md5] = match
  if (md5 !== blob) {
    throw new PreviewMeshRefusedError(url, `md5 in the path (${String(md5)}) is not the requested blob`)
  }
  if (shard !== blob.slice(0, 6)) {
    throw new PreviewMeshRefusedError(url, `shard ${String(shard)} does not match the md5`)
  }

  const segments = new URL(url).pathname.split('/').slice(1, -2)
  const derivative = segments.find((segment) => DERIVATIVE_PATH_SEGMENTS.includes(segment.toLowerCase()))
  if (derivative !== undefined) {
    throw new PreviewMeshRefusedError(url, `path segment "${derivative}" names a derivative store`)
  }

  return url
}

/**
 * The fetching seam.
 *
 * Takes a content address, returns bytes. Deliberately the narrowest interface
 * that does the job: no URL argument (see the module note), no options, no
 * caching, and no knowledge of ZIP. Tests supply their own and never hit R2.
 */
export interface BlobSource {
  /** The URL this source would use — for the URL-list degradation path and for error messages. */
  urlFor(blob: BlobId): string
  /** Open the original STL's bytes. Rejects with {@link BlobFetchError} on anything but a body. */
  open(blob: BlobId, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>>
}

/** Content types a model response may legitimately carry. R2 serves STLs as one of these. */
const MODEL_CONTENT_TYPES: readonly string[] = [
  'application/octet-stream',
  'application/sla',
  'application/vnd.ms-pki.stl',
  'model/stl',
  'model/x.stl-binary',
  'model/x.stl-ascii',
  'text/plain',
]

/**
 * The real source: R2 over `fetch`, with the guards.
 *
 * `fetchImpl` is injectable for tests, but no test in this package uses it to
 * simulate R2 — they supply a whole {@link BlobSource} instead, because a fake
 * `fetch` would be testing this function's error handling twice over.
 */
export function r2BlobSource(assets: Pick<CatalogAssets, 'models'>, fetchImpl: typeof fetch = fetch): BlobSource {
  return {
    urlFor: (blob) => originalStlUrl(assets, blob),

    open: async (blob, signal) => {
      const url = originalStlUrl(assets, blob)

      let response: Response
      try {
        response = await fetchImpl(url, signal === undefined ? {} : { signal })
      } catch (cause) {
        throw new BlobFetchError(blob, url, 'the request failed', { cause })
      }

      if (!response.ok) {
        throw new BlobFetchError(blob, url, `HTTP ${String(response.status)} ${response.statusText}`)
      }

      // A redirect that left the models bucket would otherwise be invisible.
      if (response.redirected && ORIGINAL_STL_URL.exec(response.url) === null) {
        throw new PreviewMeshRefusedError(response.url, 'the request was redirected off the original-model path')
      }

      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (contentType !== undefined && contentType !== '' && !MODEL_CONTENT_TYPES.includes(contentType)) {
        throw new PreviewMeshRefusedError(url, `served as ${contentType}, which is not a mesh`)
      }

      if (response.body === null) {
        throw new BlobFetchError(blob, url, 'the response carried no body')
      }
      return response.body
    },
  }
}

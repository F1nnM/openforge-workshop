/**
 * The share-link codec's public surface.
 *
 * Import from `@/share`, not from the modules beneath it. The whole surface is a
 * manifest and two async functions over it:
 *
 * ```ts
 * const manifest = buildShareManifest(catalog)          // once per catalog load
 *
 * const link = await encodeShareFragment(sharedSceneFromState(state), manifest)
 * if (link.ok) {
 *   const url = buildShareUrl(location.href, link.fragment)
 *   if (!shareUrlFits(url)) warnThatItIsLong(url.length)
 * }
 *
 * const opened = await decodeShareFragment(location.hash, manifest)
 * if (opened.ok) applyScene(opened.scene, opened.dropped)
 * else showError(opened.message)
 * ```
 *
 * Pure apart from the compression: no React, no fetch, no store writes, no DOM
 * beyond `CompressionStream` and `btoa`. Both entry points return a typed result
 * and neither ever throws — a share link is opened by someone who did not build
 * the room, from a string that may have been truncated by a chat client, and a
 * throw there is a white screen on a cold load.
 *
 * The three things worth reading before changing anything here:
 *
 *   - `manifest.ts` — why a link encodes ordinals, and the two defences against
 *     the manifest moving underneath one. This is the whole risk of the feature.
 *   - `payload.ts` — the columnar layout, the measured reason for it, and the
 *     quantisation escape hatch that keeps it exact.
 *   - `scene.ts` — what a link carries and what it deliberately does not, the
 *     four lines that apply a decoded scene to the store, and the measured reason
 *     generated bases travel in the link rather than being warned about.
 */
export type { ShareManifest, ShareManifestSource, ResolvedOrdinals } from './manifest'
export { buildShareManifest, resolveOrdinals } from './manifest'

export type { SharedGeneratedBase, SharedScene } from './scene'
export { SharedGeneratedBase as SharedGeneratedBaseSchema } from './scene'
export { emptySharedScene, sharedSceneFromState, stringifySharedGeneratedBase } from './scene'

export { LOCK_ORDER, MAX_SHARE_GENERATED, MAX_SHARE_PLACEMENTS, SHARE_FORMAT_VERSION } from './payload'

export { isShareCodecSupported } from './transport'

export type { ShareDecodeFailure, ShareDecodeResult, ShareEncodeFailure, ShareEncodeResult } from './link'
export {
  SHARE_PARAM,
  SHARE_URL_BUDGET,
  buildShareUrl,
  decodeShareFragment,
  encodeShareFragment,
  readShareFragment,
  shareUrlFits,
} from './link'

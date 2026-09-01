/**
 * The material registry's first consumer that owns a renderer.
 *
 * `@/materials` deliberately imports none (§4 withdrew TSL node materials, so
 * `resolveMaterial` is plain data plus a resolver and serves the 2D plan-view
 * fills and this module identically). Everything renderer-shaped therefore lives
 * here, and it is a short list: a `MeshStandardMaterial`, the four scalars the
 * registry already measured, and a refcount.
 *
 * ## Why `MeshStandardMaterial` and not something cleverer
 *
 * §4, in full: `WebGLNodesHandler` lives in `examples/jsm/`, which three.js
 * excludes from semver; its own header documents that *instanced mesh geometry
 * cannot be shared*, which is precisely the builder's v1.1 strategy; and it
 * imports from `three/webgpu`, so picking the classic renderer still ships the
 * WebGPU bundle — **425 KB gz against 129 KB**, more JavaScript than the entire
 * catalog index. Flat per-family colour with tuned roughness is the v1 material,
 * and for tiles whose detail is modelled geometry the silhouette, the flat
 * normals and the AO already carry the information.
 *
 * ## The contour becomes the AO colour
 *
 * §9's measured rule is that silhouette is carried by a contour, not the fill:
 * meeting WCAG 1.4.11's 3:1 against the parchment well with fills alone would
 * force every family below L\* 50 and destroy plaster, sandstone and ice, so each
 * family carries a separate `edge` at `oklch(min(0.36, L×0.72), C×0.70, H)`. In
 * 3D there is no stroke to put it on — so the family's own `edge` is handed to
 * N8AO as the occlusion colour (`Stage.tsx`), which puts the same measured dark
 * chroma into every crease and contact shadow instead of around the outline. One
 * palette decision, two renderings of it.
 *
 * ## Refcounted, not garbage
 *
 * `Resolution.variantKey` is the registry's stated cache key — 8,702 models
 * collapse to a few dozen materials — so materials are shared by key. Sharing
 * plus `dispose()` on unmount is a use-after-free waiting to happen (two open
 * views of the same family, one closes, the other loses its material with no
 * error beyond a black mesh), so acquisition is counted and the GPU program is
 * released only when the last holder lets go.
 *
 * ## Transmission is approximated, and said so
 *
 * Two of the sixteen families are transmissive — water 0.6 and ice 0.75.
 * `MeshStandardMaterial` has no transmission; real transmission means
 * `MeshPhysicalMaterial` and a scene render target per frame. For a preview of a
 * mostly-opaque tile that is a poor trade, so transmission is rendered as
 * partial opacity, which reads correctly at tile scale and costs one blend.
 */
import { Color, DoubleSide, MeshStandardMaterial } from 'three'

import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'

/** How much of a family's `transmission` becomes transparency. */
const TRANSMISSION_TO_ALPHA = 0.55

interface Entry {
  readonly material: MeshStandardMaterial
  holders: number
}

const cache = new Map<string, Entry>()

/**
 * The shared material for a resolution, with the caller counted as a holder.
 *
 * Pair every call with {@link releaseMaterial}.
 */
export function acquireMaterial(resolution: Resolution): MeshStandardMaterial {
  const existing = cache.get(resolution.variantKey)
  if (existing !== undefined) {
    existing.holders += 1
    return existing.material
  }

  const material = buildMaterial(resolution)
  cache.set(resolution.variantKey, { material, holders: 1 })
  return material
}

/** Drop one holder; dispose when the last one goes. Returns true if it disposed. */
export function releaseMaterial(resolution: Resolution): boolean {
  const entry = cache.get(resolution.variantKey)
  if (entry === undefined) return false

  entry.holders -= 1
  if (entry.holders > 0) return false

  entry.material.dispose()
  cache.delete(resolution.variantKey)
  return true
}

/** Resolve tags to a material in one call — the shape a mesh component wants. */
export function materialForTags(tags: readonly string[], filename = ''): Resolution {
  return resolveMaterial(tags, filename)
}

/** Live entries, for tests and for the dev readout. */
export function materialCacheSize(): number {
  return cache.size
}

/**
 * Dispose everything, regardless of holders.
 *
 * For a full teardown — the page unloading, or a test. Not for unmount: unmount
 * releases what it acquired.
 */
export function clearMaterialCache(): void {
  for (const entry of cache.values()) entry.material.dispose()
  cache.clear()
}

function buildMaterial(resolution: Resolution): MeshStandardMaterial {
  const { family, finish } = resolution

  const material = new MeshStandardMaterial({
    // The registry's tints are sRGB albedo values, not rendered pixels; three's
    // colour management needs to be told which, or every material comes out
    // washed out under the default linear workflow.
    color: new Color().setStyle(family.tint, 'srgb'),
    roughness: finish.roughness,
    metalness: finish.metalness,
    // Flat shading is already exact from the non-indexed geometry's recomputed
    // normals (geometry.ts); setting it here as well makes it independent of
    // whoever hands this material a geometry next.
    flatShading: true,
    // A single-model viewer can afford both faces, and a flipped facet in an
    // exported STL then reads as a facet rather than as a hole through the tile.
    side: DoubleSide,
  })

  if (finish.transmission > 0) {
    material.transparent = true
    material.opacity = 1 - finish.transmission * TRANSMISSION_TO_ALPHA
    // Water and ice are the transmissive families and both are thin insets, so
    // writing depth would make the tile behind them disappear at some angles.
    material.depthWrite = false
  }

  material.name = resolution.variantKey
  return material
}

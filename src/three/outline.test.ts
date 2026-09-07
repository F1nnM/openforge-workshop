/**
 * The proxy mesh, asserted without a GL context.
 *
 * Row **D7**'s hover cue is a post pass, and what a post pass looks like is a
 * question for a browser and a pixel diff. What is *not* a question for a
 * browser is the four properties that decide whether the pass sees the right
 * object at all, and every one of them is a silent failure if it is wrong: a
 * proxy that draws pixels z-fights with the tile it outlines, a proxy that is
 * invisible is dropped from the render list before the pass's override material
 * is ever considered, a proxy whose matrix is recomposed lands somewhere else,
 * and a proxy that copies its geometry outlines a mesh that is not the one on
 * screen. So they are asserted here, where they read as one list.
 */
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshBasicMaterial } from 'three'
import { describe, expect, it } from 'vitest'

import type { OutlineSubject } from './outline'
import {
  NO_OUTLINE,
  OUTLINE_EDGE_STRENGTH,
  OUTLINE_MASK,
  OUTLINE_RESOLUTION_SCALE,
  outlineProxies,
} from './outline'

/**
 * A subject at a place, over a geometry of its own.
 *
 * The geometry is built here rather than imported from `markers.ts`: this module
 * takes *any* geometry by design — a store object's or a footprint plate's — and
 * a test that reached into `builder/` for one would be asserting a layering that
 * does not exist.
 */
function subject(key: string, translate: number): OutlineSubject {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3))
  return { key, geometry, matrix: new Matrix4().makeTranslation(translate, 0, 0) }
}

describe('the mask material draws nothing and is still drawn', () => {
  it('writes neither colour nor depth', () => {
    // The proxy is coplanar with the tile it outlines — the same geometry at the
    // same matrix — so anything it wrote would z-fight through two different
    // vertex paths. Both flags off makes it a draw call that touches no buffer.
    expect(OUTLINE_MASK.colorWrite).toBe(false)
    expect(OUTLINE_MASK.depthWrite).toBe(false)
  })

  it('is visible, which is the flag that must **not** be used to hide it', () => {
    /*
      three drops an object whose material is invisible out of the render list in
      `projectObject`, *before* `scene.overrideMaterial` is consulted — and the
      outline pass renders its mask through an override. So `visible = false`
      would empty the mask and the cue would silently never draw. This assertion
      exists to fail if somebody reaches for the obvious flag.
    */
    expect(OUTLINE_MASK.visible).toBe(true)
  })

  it('is one material for every proxy, so a hover allocates none', () => {
    const proxies = outlineProxies([subject('a', 0), subject('b', 10)])
    expect(proxies[0]?.material).toBe(OUTLINE_MASK)
    expect(proxies[1]?.material).toBe(OUTLINE_MASK)
    expect(OUTLINE_MASK).toBeInstanceOf(MeshBasicMaterial)
  })
})

describe('a proxy stands exactly where the thing it outlines stands', () => {
  it('takes the subject’s matrix as its own, without decomposing it', () => {
    // `matrixAutoUpdate` off and the matrix copied in: a world matrix pulled
    // apart into position, quaternion and scale and put back together is an
    // opportunity to land somewhere else, and there is nothing to gain by it.
    const at = subject('floor', 12.5)
    const [proxy] = outlineProxies([at])
    expect(proxy?.matrixAutoUpdate).toBe(false)
    expect(proxy?.matrix.elements).toEqual(at.matrix.elements)
    expect(proxy?.matrixWorldNeedsUpdate).toBe(true)
  })

  it('shares the geometry rather than copying it', () => {
    // The row: the cue outlines the geometry that is on screen. A copy would be
    // a second object that could differ, which is the class of defect D7 fixes.
    const at = subject('wall', 0)
    const [proxy] = outlineProxies([at])
    expect(proxy?.geometry).toBe(at.geometry)
  })

  it('is one mesh per subject, named after it', () => {
    const proxies = outlineProxies([subject('p:floor', 0), subject('p:wall', 5)])
    expect(proxies).toHaveLength(2)
    expect(proxies.every((proxy) => proxy instanceof Mesh)).toBe(true)
    expect(proxies.map((proxy) => proxy.name)).toEqual(['outline:p:floor', 'outline:p:wall'])
  })

  it('builds nothing for an empty request', () => {
    expect(outlineProxies(NO_OUTLINE.subjects)).toEqual([])
    expect(NO_OUTLINE.subjects).toHaveLength(0)
  })
})

describe('the two numbers the pass is tuned with', () => {
  it('puts the edge at full alpha and not half of it', () => {
    // `OutlineEffect` reports the gradient of a 0/1 coverage mask across two
    // texels, so its peak is 0.5; the effect multiplies by `edgeStrength` to get
    // the alpha it blends with. 2 is the value at which the cue is the colour the
    // design chose — below it a fraction, above it an overshoot.
    expect(OUTLINE_EDGE_STRENGTH * 0.5).toBe(1)
  })

  it('runs the edge at half resolution, which is what makes it a glow', () => {
    expect(OUTLINE_RESOLUTION_SCALE).toBe(0.5)
  })
})

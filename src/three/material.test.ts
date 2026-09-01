/**
 * The materials come from the registry, and the refcount actually counts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Color, DoubleSide } from 'three'

import { resolveMaterial } from '@/materials'

import {
  acquireMaterial,
  clearMaterialCache,
  materialCacheSize,
  materialForTags,
  releaseMaterial,
} from './material'

afterEach(() => {
  clearMaterialCache()
})

describe('acquireMaterial', () => {
  it('takes every scalar from the registry rather than inventing one', () => {
    const resolution = resolveMaterial(['texture|dungeon_stone|block'])
    const material = acquireMaterial(resolution)

    expect(material.roughness).toBe(resolution.finish.roughness)
    expect(material.metalness).toBe(resolution.finish.metalness)
    expect(material.color.getHexString()).toBe(
      new Color().setStyle(resolution.family.tint, 'srgb').getHexString(),
    )
  })

  it('carries the family’s measured tint, not a rendered pixel value', () => {
    // dungeon_stone's albedo, straight out of palette.ts.
    const material = acquireMaterial(resolveMaterial(['texture|dungeon_stone']))
    expect(`#${material.color.getHexString('srgb')}`).toBe('#6b7280')
  })

  it('resolves metal to a metallic material', () => {
    const material = acquireMaterial(resolveMaterial(['texture|metal']))
    expect(material.metalness).toBeGreaterThan(0.5)
  })

  it('shades flat and draws both faces', () => {
    const material = acquireMaterial(resolveMaterial(['texture|cut_stone']))
    expect(material.flatShading).toBe(true)
    expect(material.side).toBe(DoubleSide)
  })

  it('names itself with the registry’s cache key', () => {
    const resolution = resolveMaterial(['texture|cave'])
    expect(acquireMaterial(resolution).name).toBe(resolution.variantKey)
  })

  it('renders the two transmissive families as partial opacity', () => {
    for (const tag of ['texture|pool', 'texture|cracked_ice']) {
      const resolution = resolveMaterial([tag])
      expect(resolution.finish.transmission).toBeGreaterThan(0)

      const material = acquireMaterial(resolution)
      expect(material.transparent).toBe(true)
      expect(material.opacity).toBeLessThan(1)
      expect(material.depthWrite).toBe(false)
    }
  })

  it('leaves an opaque family opaque', () => {
    const material = acquireMaterial(resolveMaterial(['texture|brick']))
    expect(material.transparent).toBe(false)
    expect(material.opacity).toBe(1)
  })

  it('gives the unmapped family a material rather than a wrong guess', () => {
    const resolution = resolveMaterial([])
    expect(resolution.material).toBe('unknown')
    expect(acquireMaterial(resolution).color.getHexString()).toBe(
      new Color().setStyle(resolution.family.tint, 'srgb').getHexString(),
    )
  })
})

describe('the refcount', () => {
  it('shares one instance across holders of the same variant key', () => {
    const resolution = resolveMaterial(['texture|sandstone'])
    const first = acquireMaterial(resolution)
    const second = acquireMaterial(resolveMaterial(['texture|sandstone']))

    expect(second).toBe(first)
    expect(materialCacheSize()).toBe(1)
  })

  it('keeps the material alive while a second holder still wants it', () => {
    const resolution = resolveMaterial(['texture|wood'])
    acquireMaterial(resolution)
    acquireMaterial(resolution)

    expect(releaseMaterial(resolution)).toBe(false)
    expect(materialCacheSize()).toBe(1)
  })

  it('disposes when the last holder lets go', () => {
    const resolution = resolveMaterial(['texture|wood'])
    const material = acquireMaterial(resolution)
    let disposed = 0
    material.addEventListener('dispose', () => {
      disposed += 1
    })

    acquireMaterial(resolution)
    releaseMaterial(resolution)
    expect(disposed).toBe(0)

    expect(releaseMaterial(resolution)).toBe(true)
    expect(disposed).toBe(1)
    expect(materialCacheSize()).toBe(0)
  })

  it('separates two different families', () => {
    acquireMaterial(resolveMaterial(['texture|cave']))
    acquireMaterial(resolveMaterial(['texture|sewer']))
    expect(materialCacheSize()).toBe(2)
  })

  it('separates worn from unworn, because wear moves roughness', () => {
    const plain = resolveMaterial(['texture|cut_stone|block'])
    const worn = resolveMaterial(['texture|cut_stone|block', 'texture|cut_stone|ruined'])

    expect(worn.worn).toBe(true)
    expect(worn.variantKey).not.toBe(plain.variantKey)

    acquireMaterial(plain)
    acquireMaterial(worn)
    expect(materialCacheSize()).toBe(2)
    // §9: wear changes roughness and never colour.
    expect(acquireMaterial(worn).color.getHexString()).toBe(
      acquireMaterial(plain).color.getHexString(),
    )
    expect(worn.finish.roughness).not.toBe(plain.finish.roughness)
  })

  it('ignores a release for something never acquired', () => {
    expect(releaseMaterial(resolveMaterial(['texture|necro']))).toBe(false)
  })
})

describe('materialForTags', () => {
  it('is the registry’s resolver, filename hint included', () => {
    // Stage 4 of the cascade: no texture tag, but the filename says torch plate.
    expect(materialForTags([], 'dungeon_stone#wall,torch_plate.stl').material).toBe('metal')
  })
})

describe('clearMaterialCache', () => {
  it('disposes everything regardless of holders', () => {
    acquireMaterial(resolveMaterial(['texture|aztlan']))
    acquireMaterial(resolveMaterial(['texture|plain']))
    clearMaterialCache()
    expect(materialCacheSize()).toBe(0)
  })
})

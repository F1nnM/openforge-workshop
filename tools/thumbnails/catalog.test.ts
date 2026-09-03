/**
 * The work list, and the two things that would silently halve or double it.
 *
 * `sprite: false` on one live tile, and 171 md5 values shared by 520 catalog
 * rows. Filtering the first away quietly loses the frontend's only fallback test
 * case; ignoring the second fetches and encodes 349 sheets twice.
 */
import { describe, expect, it } from 'vitest'

import { BlobId, MEASURED_SPRITE_SHEET } from '../../src/catalog'

import { spriteTargets, thumbKey, thumbPath, thumbPrefix, thumbUrl, spriteUrl } from './catalog'
import { blobOf, testCatalog } from './fixtures/catalog'

const A = blobOf('aaaa1111bbbb2222cccc3333dddd4444')
const B = blobOf('bbbb1111bbbb2222cccc3333dddd4444')
const C = blobOf('cccc1111bbbb2222cccc3333dddd4444')

/** Brand a test md5, so the branded-id types are exercised rather than asserted away. */
const id = (blob: string): BlobId => BlobId.parse(blob)

describe('spriteTargets', () => {
  it('returns one target per sheet, in display order', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/x/third.stl', ord: 7, blob: C, texture: 'cave' },
        { id: 'tiles/x/first.stl', ord: 1, blob: A, texture: 'aztlan' },
        { id: 'tiles/x/second.stl', ord: 4, blob: B, texture: 'tudor' },
      ],
    })
    const { targets } = spriteTargets(file)
    expect(targets.map((target) => target.ord)).toEqual([1, 4, 7])
    expect(targets.map((target) => target.texture)).toEqual(['aztlan', 'tudor', 'cave'])
  })

  it('collapses tiles sharing an md5 into one target, keeping every id', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/x/one.stl', ord: 1, blob: A },
        { id: 'tiles/y/one.stl', ord: 9, blob: A },
        { id: 'tiles/x/two.stl', ord: 2, blob: B },
      ],
    })
    const { targets, deduped } = spriteTargets(file)
    expect(targets).toHaveLength(2)
    expect(deduped).toBe(1)
    const shared = targets.find((target) => target.blob === A)
    expect(shared?.ids).toEqual(['tiles/x/one.stl', 'tiles/y/one.stl'])
    // The lower ordinal wins, so the display-order sort is stable.
    expect(shared?.ord).toBe(1)
  })

  it('reports the spriteless tile instead of dropping it', () => {
    const file = testCatalog({
      records: [
        { id: 'tiles/x/has.stl', ord: 1, blob: A },
        { id: 'tiles/x/has-not.stl', ord: 2, blob: B, sprite: false },
      ],
    })
    const { targets, withoutSprite, records } = spriteTargets(file)
    expect(targets.map((target) => target.blob)).toEqual([A])
    expect(withoutSprite).toEqual(['tiles/x/has-not.stl'])
    expect(records).toBe(2)
  })
})

describe('paths', () => {
  const file = testCatalog({ records: [{ id: 'tiles/x/one.stl', ord: 1, blob: A }] })

  it('shards the key on the first six hex characters', () => {
    expect(thumbKey(file, id(A))).toBe(`thumbs/${A.slice(0, 6)}/${A}.webp`)
  })

  it('mirrors the bucket layout on disk', () => {
    expect(thumbPath(file, id(A), '/stage')).toBe(`/stage/thumbs/${A.slice(0, 6)}/${A}.webp`)
  })

  it('builds the public URL from the index’s asset base', () => {
    expect(thumbUrl(file, id(A))).toBe(`https://objects.example.test/thumbs/${A.slice(0, 6)}/${A}.webp`)
    expect(spriteUrl(file, id(A))).toBe(`https://objects.example.test/sprites/${A.slice(0, 6)}/${A}.png`)
  })

  it('takes the key prefix from assets.thumbs rather than hardcoding it', () => {
    const nested = testCatalog({
      records: [{ id: 'tiles/x/one.stl', ord: 1, blob: A }],
      thumbs: 'https://objects.example.test/derived/thumbs-256/',
    })
    expect(thumbPrefix(nested)).toBe('derived/thumbs-256')
    expect(thumbKey(nested, id(A))).toBe(`derived/thumbs-256/${A.slice(0, 6)}/${A}.webp`)
  })

  it('refuses an asset base with no path to use as a prefix', () => {
    const rootless = testCatalog({
      records: [{ id: 'tiles/x/one.stl', ord: 1, blob: A }],
      thumbs: 'https://thumbs.example.test/',
    })
    expect(() => thumbPrefix(rootless)).toThrow(/no path segment/)
  })

  it('carries the index’s sprite geometry through unchanged', () => {
    expect(file.sprite).toEqual(MEASURED_SPRITE_SHEET)
  })
})

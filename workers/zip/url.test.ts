/**
 * The Worker's URL rule against the browser's.
 *
 * `workers/zip/url.ts` restates the rule `src/download/source.ts` states,
 * because importing that module would drag zod into a Worker bundle for one path
 * helper. This suite is the other half of that arrangement: it imports the real
 * thing — a test can afford zod — and asserts the copy has not drifted.
 *
 * If one of these fails, the fix is to change `workers/zip/url.ts` to match
 * `src/download/source.ts`, never the other way round. The browser path is the
 * primary one.
 */
import { describe, expect, it } from 'vitest'

import { DERIVATIVE_PATH_SEGMENTS as CLIENT_DERIVATIVES, ORIGINAL_STL_URL, PreviewMeshRefusedError, originalStlUrl } from '../../src/download/source'

import { DEFAULT_MODELS_BASE, DERIVATIVE_PATH_SEGMENTS, MODEL_STL_URL, ModelUrlError, isModelStlUrl, modelStlUrl } from './url'
import { md5 } from './testing/fixtures'

describe('the Worker URL rule is the client URL rule', () => {
  it('uses the same pattern, character for character', () => {
    expect(MODEL_STL_URL.source).toBe(ORIGINAL_STL_URL.source)
    expect(MODEL_STL_URL.flags).toBe(ORIGINAL_STL_URL.flags)
  })

  it('refuses the same derivative stores', () => {
    expect([...DERIVATIVE_PATH_SEGMENTS]).toEqual([...CLIENT_DERIVATIVES])
  })

  it('composes the same URL for every address', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const address = md5(seed)
      expect(modelStlUrl(DEFAULT_MODELS_BASE, address)).toBe(
        originalStlUrl({ models: DEFAULT_MODELS_BASE }, address as never),
      )
    }
  })

  it('refuses the same bases, so a misconfigured binding fails on both paths', () => {
    const bad = [
      'https://objects.openforge.tools/thumbs',
      'https://objects.openforge.tools/sprites',
      'https://objects.openforge.tools/lod/models',
      'http://objects.openforge.tools/models',
      'https://objects.openforge.tools',
    ]
    for (const base of bad) {
      expect(() => modelStlUrl(base, md5(1))).toThrow(ModelUrlError)
      expect(() => originalStlUrl({ models: base }, md5(1) as never)).toThrow(PreviewMeshRefusedError)
    }
  })
})

describe('composition', () => {
  it('shards on the first six hex characters, as the bucket does', () => {
    expect(modelStlUrl(DEFAULT_MODELS_BASE, '0abc' + '0123456789abcdef0123456789ab')).toBe(
      'https://objects.openforge.tools/models/0abc01/0abc0123456789abcdef0123456789ab.stl',
    )
  })

  it('tolerates a trailing slash on the binding', () => {
    expect(modelStlUrl(`${DEFAULT_MODELS_BASE}/`, md5(2))).toBe(modelStlUrl(DEFAULT_MODELS_BASE, md5(2)))
  })

  it('refuses anything that is not a 32-character lowercase md5', () => {
    for (const bad of ['', 'abc', md5(1).toUpperCase(), md5(1) + 'a', '../../etc/passwd', 'g'.repeat(32)]) {
      expect(() => modelStlUrl(DEFAULT_MODELS_BASE, bad)).toThrow(ModelUrlError)
    }
  })

  it('recognises a redirect that stayed on the models path and one that did not', () => {
    expect(isModelStlUrl(modelStlUrl(DEFAULT_MODELS_BASE, md5(3)))).toBe(true)
    expect(isModelStlUrl('https://example.invalid/anything.stl')).toBe(false)
    expect(isModelStlUrl('https://objects.openforge.tools/thumbs/0abc01/x.png')).toBe(false)
  })
})

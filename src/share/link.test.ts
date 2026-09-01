// @vitest-environment jsdom
/**
 * The codec end to end: scene → fragment → scene.
 *
 * **jsdom, and `CompressionStream` does exist here** — but not because jsdom
 * implements it. jsdom 30 has no compression streams at all; what the suite gets
 * is Node 22's own global surviving into the jsdom environment, because Vitest
 * layers jsdom's window over the Node globals rather than replacing them. Node's
 * implementation is zlib, the browsers' are their own, and both follow RFC 1951,
 * so a link written by one inflates in the other — DEFLATE is a wire format, not
 * an implementation. The consequence worth naming: this suite proves the codec
 * round-trips and that its failure paths are total; it does not prove Safari's
 * `CompressionStream` produces byte-identical output to Node's, and nothing here
 * depends on that. `isShareCodecSupported()` is what a browser without it hits,
 * and it is asserted below.
 *
 * The load-bearing test in this file is the drift pair. Everything else checks
 * that a damaged link fails politely; those two check that a link which *would*
 * decode, and would decode to a plausible wrong room, is refused instead.
 */
import { describe, expect, it } from 'vitest'

import type { ManifestOrdinal, TileId } from '@/catalog'
import type { LockSystem, Placement } from '@/store'
import { LockSystem as LockSystemSchema } from '@/store'

import {
  SHARE_URL_BUDGET,
  buildShareUrl,
  decodeShareFragment,
  encodeShareFragment,
  readShareFragment,
  shareUrlFits,
} from './link'
import type { ShareManifest, ShareManifestSource } from './manifest'
import { buildShareManifest, resolveOrdinals } from './manifest'
import { encodePayload } from './payload'
import type { SharedScene } from './scene'
import { deflateRaw, isShareCodecSupported, toBase64Url } from './transport'

/* ---------------------------------------------------------------- fixtures */

function tileId(index: number): TileId {
  return `tiles/fixture/family/fixture#tile.${String(index)}x1.openlock.stl` as TileId
}

/** A manifest over `count` tiles, ordinal `i` naming tile `i`. */
function manifestOf(count: number, manifestVersion = 1): ShareManifest {
  const source: ShareManifestSource = {
    version: { manifest: manifestVersion },
    records: Array.from({ length: count }, (_, index) => ({
      id: tileId(index),
      ord: index as ManifestOrdinal,
    })),
  }
  return buildShareManifest(source)
}

/**
 * The same tiles, renumbered by one — the exact failure §13 names.
 *
 * Every ordinal still resolves, every id is still in the catalog, the manifest
 * version is untouched. Nothing about this is detectable by looking at either the
 * manifest or the link alone; only the checksum over the pairs catches it.
 */
function shiftedManifestOf(count: number, manifestVersion = 1): ShareManifest {
  const source: ShareManifestSource = {
    version: { manifest: manifestVersion },
    records: Array.from({ length: count }, (_, index) => ({
      id: tileId(index),
      ord: ((index + 1) % count) as ManifestOrdinal,
    })),
  }
  return buildShareManifest(source)
}

function placement(index: number, x: number, z: number, rotation: number): Placement {
  return { tileId: tileId(index), x, z, rotation }
}

/** Every lock system, in the enum's own order. */
const ALL_LOCKS: readonly LockSystem[] = LockSystemSchema.options

const SCENE: SharedScene = {
  lock: 'dragonlock',
  placements: [
    placement(0, 0, 0, 0),
    placement(1, -12.5, 40.5, 270),
    placement(1, 3.5, -0.5, 11.25),
    placement(63, 0.5, 0.5, 348.75),
  ],
}

async function fragmentOf(scene: SharedScene, manifest: ShareManifest): Promise<string> {
  const encoded = await encodeShareFragment(scene, manifest)
  if (!encoded.ok) throw new Error(`encode failed: ${encoded.message}`)
  return encoded.fragment
}

/* ------------------------------------------------------------------- tests */

describe('runtime support', () => {
  it('has CompressionStream in this environment', () => {
    expect(typeof CompressionStream).toBe('function')
    expect(typeof DecompressionStream).toBe('function')
    expect(isShareCodecSupported()).toBe(true)
  })
})

describe('round trip', () => {
  it('is exact, including rotation and lock', async () => {
    const manifest = manifestOf(64)
    const decoded = await decodeShareFragment(await fragmentOf(SCENE, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(SCENE)
    expect(decoded.dropped).toEqual([])
  })

  it('carries every lock system', async () => {
    const manifest = manifestOf(64)
    for (const lock of ALL_LOCKS) {
      const scene: SharedScene = { ...SCENE, lock }
      const decoded = await decodeShareFragment(await fragmentOf(scene, manifest), manifest)
      expect(decoded.ok).toBe(true)
      if (decoded.ok) expect(decoded.scene.lock).toBe(lock)
    }
  })

  it('round-trips an empty scene', async () => {
    const manifest = manifestOf(64)
    const scene: SharedScene = { lock: 'openlock', placements: [] }
    const encoded = await encodeShareFragment(scene, manifest)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    // Nine payload bytes; the link is short enough to read out loud.
    expect(encoded.rawBytes).toBe(9)
    expect(encoded.fragment.length).toBeLessThan(32)
    const decoded = await decodeShareFragment(encoded.fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(scene)
  })

  it('is exact for a position off the half-unit grid', async () => {
    const manifest = manifestOf(8)
    const scene: SharedScene = { lock: 'openlock', placements: [placement(3, 0.25, 1 / 3, 33.7)] }
    const decoded = await decodeShareFragment(await fragmentOf(scene, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(scene)
  })

  it('survives the whole fragment being handed back as a bare payload', async () => {
    const manifest = manifestOf(64)
    const fragment = await fragmentOf(SCENE, manifest)
    const bare = fragment.replace('#s=', '')
    const decoded = await decodeShareFragment(bare, manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(SCENE)
  })
})

describe('manifest drift', () => {
  it('is detected when the ordinals are renumbered without a version bump', async () => {
    const written = manifestOf(64)
    const fragment = await fragmentOf(SCENE, written)

    const decoded = await decodeShareFragment(fragment, shiftedManifestOf(64))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.reason).toBe('manifest-drift')
    expect(decoded.message).toMatch(/wrong room/i)
  })

  it('is detected for a single swapped pair, not just a wholesale shift', async () => {
    const written = manifestOf(64)
    const fragment = await fragmentOf(SCENE, written)

    // Ordinals 1 and 63 trade tiles. Every other ordinal is untouched, and both
    // of these are referenced by the link.
    const swapped = buildShareManifest({
      version: { manifest: 1 },
      records: Array.from({ length: 64 }, (_, index) => {
        const ord = index === 1 ? 63 : index === 63 ? 1 : index
        return { id: tileId(index), ord: ord as ManifestOrdinal }
      }),
    })

    const decoded = await decodeShareFragment(fragment, swapped)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-drift')
  })

  it('is not raised by appending tiles, which is what append-only is for', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64))
    const decoded = await decodeShareFragment(fragment, manifestOf(9000))
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(SCENE)
  })

  it('refuses a link written against a different manifest version', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64, 1))
    const decoded = await decodeShareFragment(fragment, manifestOf(64, 2))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    expect(decoded.reason).toBe('manifest-version')
    // Actionable: it names both versions and says what to do about it.
    expect(decoded.message).toContain('1')
    expect(decoded.message).toContain('2')
    expect(decoded.message).toMatch(/re-share/i)
  })

  it('prefers the version mismatch to the drift report when both apply', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64, 1))
    const decoded = await decodeShareFragment(fragment, shiftedManifestOf(64, 2))
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-version')
  })
})

describe('salvage', () => {
  it('drops a placement whose tile this build does not carry, and names it', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64))
    // The same manifest version, but tile 63 has been retired: its ordinal stays
    // reserved, its record does not ship. That is legal, so the other three
    // placements must open.
    const decoded = await decodeShareFragment(fragment, manifestOf(63))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toEqual(SCENE.placements.slice(0, 3))
    expect(decoded.dropped.join('\n')).toContain('ordinal 63')
    expect(decoded.dropped.join('\n')).toMatch(/checksum not verified/i)
  })

  it('drops every placement rather than failing when none of the tiles are left', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64))
    const decoded = await decodeShareFragment(fragment, manifestOf(0))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toEqual([])
    expect(decoded.scene.lock).toBe('dragonlock')
    expect(decoded.dropped.length).toBe(5)
  })

  it('drops an unencodable placement at encode time and names it', async () => {
    const manifest = manifestOf(4)
    const scene: SharedScene = {
      lock: 'openlock',
      placements: [
        placement(0, 1, 1, 0),
        placement(99, 2, 2, 0),
        { tileId: tileId(1), x: Number.NaN, z: 0, rotation: 0 },
      ],
    }
    const encoded = await encodeShareFragment(scene, manifest)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.dropped.length).toBe(2)
    expect(encoded.dropped[0]).toContain('is not in this catalog build')
    expect(encoded.dropped[1]).toContain('finite')

    const decoded = await decodeShareFragment(encoded.fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene.placements).toEqual([placement(0, 1, 1, 0)])
  })

  it('resets a lock system this build does not know, keeping the room', async () => {
    // A link from a hypothetical future build that added a fourth lock system.
    // The geometry is intact and the checksum is correct, so the room must open;
    // only the preference degrades.
    const manifest = manifestOf(8)
    const { digest } = resolveOrdinals([2], manifest)
    const raw = encodePayload({
      manifestVersion: 1,
      lockIndex: 7,
      digest,
      placements: [{ ordinal: 2, x: 1, z: 1, rotation: 90 }],
    })
    const compressed = await deflateRaw(raw)
    expect(compressed).toBeDefined()
    if (compressed === undefined) return

    const decoded = await decodeShareFragment(`#s=${toBase64Url(compressed)}`, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.lock).toBe('openlock')
    expect(decoded.scene.placements).toEqual([placement(2, 1, 1, 90)])
    expect(decoded.dropped.join('\n')).toContain('index 7')
  })

  it('rejects a hand-built payload whose checksum does not match', async () => {
    const manifest = manifestOf(8)
    const raw = encodePayload({
      manifestVersion: 1,
      lockIndex: 0,
      digest: 0,
      placements: [{ ordinal: 2, x: 1, z: 1, rotation: 90 }],
    })
    const compressed = await deflateRaw(raw)
    expect(compressed).toBeDefined()
    if (compressed === undefined) return
    const decoded = await decodeShareFragment(`#s=${toBase64Url(compressed)}`, manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-drift')
  })

  it('normalises an out-of-range rotation rather than rejecting the link', async () => {
    const manifest = manifestOf(8)
    const scene: SharedScene = { lock: 'openlock', placements: [{ tileId: tileId(1), x: 0, z: 0, rotation: 450 }] }
    const decoded = await decodeShareFragment(await fragmentOf(scene, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene.placements[0]?.rotation).toBe(90)
  })
})

describe('damaged links never throw', () => {
  it('reports a truncation at every prefix length', async () => {
    const manifest = manifestOf(64)
    const fragment = await fragmentOf(SCENE, manifest)
    const payload = fragment.slice('#s='.length)

    const reasons = new Set<string>()
    for (let length = 0; length < payload.length; length += 1) {
      const decoded = await decodeShareFragment(`#s=${payload.slice(0, length)}`, manifest)
      expect(decoded.ok, `prefix of ${String(length)} chars decoded as a room`).toBe(false)
      if (!decoded.ok) reasons.add(decoded.reason)
    }
    // Every prefix is caught, and by the checks that are meant to catch it: an
    // empty payload is absent, a 4n+1 length is not base64, and the rest are a
    // broken DEFLATE stream. Nothing reaches the payload reader, because DEFLATE
    // carries its own end-of-stream marker.
    expect(reasons.has('not-compressed')).toBe(true)
    const known = ['absent', 'not-base64', 'not-compressed', 'truncated', 'malformed', 'format-version']
    expect([...reasons].filter((reason) => !known.includes(reason))).toEqual([])
  })

  it('reports base64 that is not base64', async () => {
    const manifest = manifestOf(8)
    for (const payload of ['!!!!', 'abc def', 'a+b/c=', 'ЖЖЖЖ', 'aaaa\naaaa']) {
      const decoded = await decodeShareFragment(`#s=${payload}`, manifest)
      expect(decoded.ok).toBe(false)
      if (!decoded.ok) expect(decoded.reason).toBe('not-base64')
    }
  })

  it('reports valid base64 that is not a DEFLATE stream', async () => {
    const manifest = manifestOf(8)
    const decoded = await decodeShareFragment('#s=AAAAAAAAAAAAAAAA', manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('not-compressed')
  })

  it('reports a payload whose bytes inflate but do not parse', async () => {
    const manifest = manifestOf(8)
    // A valid DEFLATE stream carrying bytes that are not a payload of ours.
    const compressed = await deflateRaw(new TextEncoder().encode('this is not a room'))
    expect(compressed).toBeDefined()
    if (compressed === undefined) return
    const decoded = await decodeShareFragment(`#s=${toBase64Url(compressed)}`, manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(['format-version', 'malformed', 'truncated']).toContain(decoded.reason)
  })

  it('reports a payload written in a format version this build does not read', async () => {
    const manifest = manifestOf(8)
    const raw = encodePayload({ manifestVersion: 1, lockIndex: 0, digest: 0, placements: [] })
    raw[0] = 99
    const compressed = await deflateRaw(raw)
    expect(compressed).toBeDefined()
    if (compressed === undefined) return
    const decoded = await decodeShareFragment(`#s=${toBase64Url(compressed)}`, manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) {
      expect(decoded.reason).toBe('format-version')
      expect(decoded.message).toContain('99')
    }
  })

  it('takes garbage of every shape without throwing', async () => {
    const manifest = manifestOf(8)
    const shapes = [
      '',
      '#',
      '#s=',
      '#s=~',
      '#s=a~b',
      '#tile=4',
      '#s',
      '=s',
      '#s=%',
      '#s=%zz',
      '#s==',
      '#&&&',
      '#s=a&s=b',
      '#__proto__=x',
      '#s=' + 'A'.repeat(10_000),
      '{"placements":[]}',
      'https://example.com/#s=nope!',
      ' ',
      '#'.repeat(500),
    ]
    for (const shape of shapes) {
      const decoded = await decodeShareFragment(shape, manifest)
      // Some of these are legitimately empty rooms rather than errors; what
      // matters is that none of them throws and none of them invents placements.
      if (decoded.ok) expect(decoded.scene.placements).toEqual([])
      else expect(decoded.message.length).toBeGreaterThan(0)
    }
  })
})

describe('fragment and URL handling', () => {
  it('reads the three fragment spellings that turn up in the wild', () => {
    expect(readShareFragment('#s=AAAA')).toBe('AAAA')
    expect(readShareFragment('s=AAAA')).toBe('AAAA')
    expect(readShareFragment('AAAA')).toBe('AAAA')
    expect(readShareFragment('')).toBeUndefined()
    expect(readShareFragment('#')).toBeUndefined()
    expect(readShareFragment('#s=')).toBeUndefined()
    expect(readShareFragment('#tile=4')).toBeUndefined()
  })

  it('replaces a fragment the base URL already carries', () => {
    expect(buildShareUrl('https://openforge.tools/builder', '#s=AAAA')).toBe('https://openforge.tools/builder#s=AAAA')
    expect(buildShareUrl('https://openforge.tools/builder#s=OLD', '#s=NEW')).toBe(
      'https://openforge.tools/builder#s=NEW',
    )
    expect(buildShareUrl('https://openforge.tools/builder?q=cave#old', '#s=NEW')).toBe(
      'https://openforge.tools/builder?q=cave#s=NEW',
    )
  })

  it('gates on measured length, not on a placement count', () => {
    expect(shareUrlFits('x'.repeat(SHARE_URL_BUDGET))).toBe(true)
    expect(shareUrlFits('x'.repeat(SHARE_URL_BUDGET + 1))).toBe(false)
  })

  it('emits a fragment made only of characters no URL layer rewrites', async () => {
    const manifest = manifestOf(64)
    const fragment = await fragmentOf(SCENE, manifest)
    expect(fragment).toMatch(/^#s=[A-Za-z0-9_-]+$/)
    expect(encodeURI(fragment)).toBe(fragment)
  })
})

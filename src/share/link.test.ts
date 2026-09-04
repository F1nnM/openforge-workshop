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
 * The load-bearing tests in this file are the drift group and the three levels of
 * salvage. Everything else checks that a damaged link fails politely; those check
 * that a link which *would* decode, and would decode to a plausible wrong room,
 * is refused instead — and that a link which is merely *incomplete* is not
 * refused, because row A1 made "one file is gone" a much smaller loss than it
 * used to be.
 */
import { describe, expect, it } from 'vitest'

import type { DesignId, ManifestOrdinal, TileId } from '@/catalog'
import type { LockSystem, NewTemplateInstance, SlotFill, SlotName, TemplateId } from '@/store'
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
import type { WirePayload } from './payload'
import { encodePayload } from './payload'
import type { SharedScene } from './scene'
import { deflateRaw, isShareCodecSupported, toBase64Url } from './transport'

/* ---------------------------------------------------------------- fixtures */

function tileId(index: number): TileId {
  return `tiles/fixture/family/fixture#tile.${String(index)}x1.openlock.stl` as TileId
}

/**
 * The design of fixture tile `index` — **one file per design here**.
 *
 * `ShareManifestSource` still carries a design per record, because
 * `tools/stamp/run.ts` verifies the design-address round trip; the codec has not
 * read it since row A5 restored file addressing. The one-to-one shape keeps the
 * fixtures readable, and the drift group's multi-variant case is the one place it
 * matters that a file's ordinal and its design's address are different numbers.
 */
function designId(index: number): DesignId {
  return `d-fixture-${String(index)}` as DesignId
}

/** A manifest over `count` tiles, ordinal `i` naming tile `i`. */
function manifestOf(count: number, manifestVersion = 1): ShareManifest {
  const source: ShareManifestSource = {
    version: { manifest: manifestVersion },
    records: Array.from({ length: count }, (_unused, index) => ({
      id: tileId(index),
      ord: index as ManifestOrdinal,
      design: designId(index),
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
    records: Array.from({ length: count }, (_unused, index) => ({
      id: tileId(index),
      ord: ((index + 1) % count) as ManifestOrdinal,
      design: designId(index),
    })),
  }
  return buildShareManifest(source)
}

/** Two real template ids, so the wire carries the lengths the build really ships. */
const FAMILY = 's2w-wall-on-tile-corner-low-single-piece' as TemplateId
const WIDE_FAMILY = 's2w-wall-on-tile-internal-corner-low-modular' as TemplateId

function fillsOf(entries: readonly (readonly [slot: string, ordinal: number, pinned?: boolean])[]) {
  const fills: Record<SlotName, SlotFill> = {}
  for (const [slot, ordinal, pinned = false] of entries) {
    fills[slot as SlotName] = { tile: tileId(ordinal), pinned }
  }
  return fills
}

/** An instance of `template`, its slots filled from the ordinals given. */
function placement(
  template: TemplateId,
  entries: readonly (readonly [slot: string, ordinal: number, pinned?: boolean])[],
  x: number,
  z: number,
  rotation: number,
): NewTemplateInstance {
  return { template, x, z, rotation, fills: fillsOf(entries) }
}

/** Every lock system, in the enum's own order. */
const ALL_LOCKS: readonly LockSystem[] = LockSystemSchema.options

/**
 * A four-instance scene at the corpus's two arities, with a pinned fill, three
 * instances of one family, and three instances sharing a file.
 */
const SCENE: SharedScene = {
  lock: 'dragonlock',
  placements: [
    placement(
      FAMILY,
      [
        ['floor', 0],
        ['wall', 1],
        ['base', 2],
      ],
      0,
      0,
      0,
    ),
    placement(
      WIDE_FAMILY,
      [
        ['floor', 3],
        ['right wall', 4],
        ['left wall', 5, true],
        ['column', 6],
        ['base', 2],
      ],
      -12.5,
      40.5,
      270,
    ),
    placement(
      FAMILY,
      [
        ['floor', 0],
        ['wall', 1],
        ['base', 2],
      ],
      3.5,
      -0.5,
      11.25,
    ),
    placement(
      FAMILY,
      [
        ['floor', 63, true],
        ['wall', 1],
        ['base', 2],
      ],
      0.5,
      0.5,
      348.75,
    ),
  ],
  generated: [],
}

/** The ordinals `SCENE`'s fills reference, which is what its digest is over. */
const SCENE_ORDINALS = [0, 1, 2, 3, 4, 5, 6, 63]

async function fragmentOf(scene: SharedScene, manifest: ShareManifest): Promise<string> {
  const encoded = await encodeShareFragment(scene, manifest)
  if (!encoded.ok) throw new Error(`encode failed: ${encoded.message}`)
  return encoded.fragment
}

/** A hand-built payload: the fields a test cares about over a readable default. */
function wire(overrides: Partial<WirePayload> = {}): WirePayload {
  return {
    manifestVersion: 1,
    lockIndex: 0,
    digest: 0,
    templates: [FAMILY],
    slots: ['floor'],
    instances: [],
    recipes: [],
    generated: [],
    ...overrides,
  }
}

async function fragmentOfPayload(payload: WirePayload): Promise<string> {
  const compressed = await deflateRaw(encodePayload(payload))
  if (compressed === undefined) throw new Error('no CompressionStream')
  return `#s=${toBase64Url(compressed)}`
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
  it('is exact, including every fill, its pinned bit, the rotation and the lock', async () => {
    const manifest = manifestOf(64)
    const decoded = await decodeShareFragment(await fragmentOf(SCENE, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(SCENE)
    expect(decoded.dropped).toEqual([])
  })

  it('carries the pinned bit per fill rather than per instance', async () => {
    // The bit is the difference between "the solver picked this, follow my lock"
    // and "the user chose this file", and it is decided per slot: an instance
    // with one pinned fill and four auto ones is the ordinary state of a room
    // somebody has adjusted.
    const manifest = manifestOf(64)
    const decoded = await decodeShareFragment(await fragmentOf(SCENE, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    const wide = decoded.scene.placements[1]
    expect(wide?.fills['left wall' as SlotName]?.pinned).toBe(true)
    expect(wide?.fills['floor' as SlotName]?.pinned).toBe(false)
    expect(decoded.scene.placements[3]?.fills['floor' as SlotName]?.pinned).toBe(true)
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
    const scene: SharedScene = { lock: 'openlock', placements: [], generated: [] }
    const encoded = await encodeShareFragment(scene, manifest)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    // Thirteen payload bytes — nine of header, and the four zero counts that open
    // the two string tables, the recipe table and the generated column. The link
    // is still short enough to read out loud.
    expect(encoded.rawBytes).toBe(13)
    expect(encoded.fragment.length).toBeLessThan(32)
    const decoded = await decodeShareFragment(encoded.fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(scene)
  })

  it('round-trips an instance with no filled slots', async () => {
    // Contract C-g: a template with no candidate for a part places anyway, so a
    // freshly dropped instance with nothing resolved yet is a room a link has to
    // carry rather than an error to report.
    const manifest = manifestOf(8)
    const scene: SharedScene = { lock: 'openlock', placements: [placement(FAMILY, [], 1, 2, 90)], generated: [] }
    const decoded = await decodeShareFragment(await fragmentOf(scene, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(scene)
    expect(decoded.dropped).toEqual([])
  })

  it('is exact for a position off the half-unit grid', async () => {
    const manifest = manifestOf(8)
    const scene: SharedScene = {
      lock: 'openlock',
      placements: [placement(FAMILY, [['floor', 3]], 0.25, 1 / 3, 33.7)],
      generated: [],
    }
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

  it('produces the same link twice for a scene whose slot order differs', async () => {
    // `fills` is a `z.record`, so its key order is whatever the producer
    // inserted — the solver, the editor, a re-import. Two rooms that are the same
    // room must be the same link, which is what sorting the slot column buys.
    const manifest = manifestOf(8)
    const ordered = placement(
      FAMILY,
      [
        ['base', 2],
        ['floor', 0],
        ['wall', 1],
      ],
      1,
      1,
      0,
    )
    const shuffled = placement(
      FAMILY,
      [
        ['wall', 1],
        ['base', 2],
        ['floor', 0],
      ],
      1,
      1,
      0,
    )
    const one = await fragmentOf({ lock: 'openlock', placements: [ordered], generated: [] }, manifest)
    const two = await fragmentOf({ lock: 'openlock', placements: [shuffled], generated: [] }, manifest)
    expect(one).toBe(two)
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
      records: Array.from({ length: 64 }, (_unused, index) => {
        const ord = index === 1 ? 63 : index === 63 ? 1 : index
        return { id: tileId(index), ord: ord as ManifestOrdinal, design: designId(index) }
      }),
    })

    const decoded = await decodeShareFragment(fragment, swapped)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-drift')
  })

  it('covers the file a fill names even when it is not its design’s address', async () => {
    // **The half of the checksum that is new in row A5.** A design with two
    // files; the room is filled with the *second* one. Under V4 the link would
    // have referenced the design's address — ordinal 20, the lower — so the
    // digest would have been taken over a file the room did not contain, and
    // renumbering the file it *did* contain would have been outside it. A fill
    // names a file, so ordinal 21 is what travels and what is checksummed.
    const records = [
      { id: tileId(20), ord: 20 as ManifestOrdinal, design: designId(20) },
      { id: tileId(21), ord: 21 as ManifestOrdinal, design: designId(20) },
      { id: tileId(22), ord: 22 as ManifestOrdinal, design: designId(22) },
    ]
    const written = buildShareManifest({ version: { manifest: 1 }, records })
    const scene: SharedScene = {
      lock: 'openlock',
      placements: [placement(FAMILY, [['floor', 21]], 0, 0, 0)],
      generated: [],
    }
    const fragment = await fragmentOf(scene, written)

    // 21 and 22 trade tiles. The design's address, 20, is untouched.
    const drifted = buildShareManifest({
      version: { manifest: 1 },
      records: [
        { id: tileId(20), ord: 20 as ManifestOrdinal, design: designId(20) },
        { id: tileId(21), ord: 22 as ManifestOrdinal, design: designId(20) },
        { id: tileId(22), ord: 21 as ManifestOrdinal, design: designId(22) },
      ],
    })
    const decoded = await decodeShareFragment(fragment, drifted)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-drift')

    // And the file's own ordinal is what the encoder wrote, not the address.
    expect(written.ordinalOfTile(tileId(21))).toBe(21)
    expect(written.ordinalOf(designId(20))).toBe(20)
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

  it('rejects a hand-built payload whose checksum does not match', async () => {
    const manifest = manifestOf(8)
    const fragment = await fragmentOfPayload(
      wire({
        instances: [{ template: 0, x: 1, z: 1, rotation: 90, fills: [{ slot: 0, ordinal: 2, pinned: false }] }],
        digest: 0,
      }),
    )
    const decoded = await decodeShareFragment(fragment, manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('manifest-drift')
  })
})

describe('salvage, at the three levels row A1 made different', () => {
  it('empties the slot whose file this build no longer carries and keeps the instance', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64))
    // The same manifest version, but tile 63 has been retired: its ordinal stays
    // reserved, its record does not ship. That is legal, and it costs one fill of
    // one instance — not the instance, and certainly not the room.
    const decoded = await decodeShareFragment(fragment, manifestOf(63))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toHaveLength(4)
    const wounded = decoded.scene.placements[3]
    expect(wounded?.fills['floor' as SlotName]).toBeUndefined()
    expect(wounded?.fills['wall' as SlotName]?.tile).toBe(tileId(1))
    expect(wounded?.fills['base' as SlotName]?.tile).toBe(tileId(2))
    expect(decoded.dropped.join('\n')).toContain('slot floor: tile ordinal 63')
    expect(decoded.dropped.join('\n')).toMatch(/checksum not verified/i)
  })

  it('keeps every instance, unfilled, rather than failing when no tile is left', async () => {
    const fragment = await fragmentOf(SCENE, manifestOf(64))
    const decoded = await decodeShareFragment(fragment, manifestOf(0))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    // Four templates on the grid at the right positions, every part needing a
    // choice. That is a room the editor renders and the user can repair, which is
    // strictly more than the pre-A1 answer of an empty scene.
    expect(decoded.scene.placements).toHaveLength(4)
    expect(decoded.scene.placements.map((instance) => Object.keys(instance.fills))).toEqual([[], [], [], []])
    expect(decoded.scene.placements.map((instance) => instance.template)).toEqual([
      FAMILY,
      WIDE_FAMILY,
      FAMILY,
      FAMILY,
    ])
    expect(decoded.scene.lock).toBe('dragonlock')
    // One line for the unverifiable checksum, and one per lost fill.
    expect(decoded.dropped).toHaveLength(1 + 14)
  })

  it('drops the whole instance when its template id is not readable', async () => {
    // A template that survives no `TemplateId` parse — uppercase and spaces are
    // outside `templateSlug`'s range. Reported once against the table entry with
    // the number of placements it cost, not once per placement.
    const manifest = manifestOf(8)
    const fragment = await fragmentOfPayload(
      wire({
        templates: [FAMILY, 'Not A Template'],
        instances: [
          { template: 1, x: 0, z: 0, rotation: 0, fills: [{ slot: 0, ordinal: 1, pinned: false }] },
          { template: 1, x: 1, z: 0, rotation: 0, fills: [{ slot: 0, ordinal: 1, pinned: false }] },
          { template: 0, x: 2, z: 0, rotation: 0, fills: [{ slot: 0, ordinal: 1, pinned: false }] },
        ],
        digest: resolveOrdinals([1], manifest).digest,
      }),
    )
    const decoded = await decodeShareFragment(fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toHaveLength(1)
    expect(decoded.scene.placements[0]?.template).toBe(FAMILY)
    expect(decoded.dropped).toEqual(['template 1: not a readable template id, dropping 2 placements'])
  })

  it('drops the fills of a slot name it cannot read, keeping their instances', async () => {
    // The empty string is the reachable case: `SlotName` is `min(1)`, and a
    // hand-edited table can carry one.
    const manifest = manifestOf(8)
    const fragment = await fragmentOfPayload(
      wire({
        slots: ['floor', ''],
        instances: [
          {
            template: 0,
            x: 0,
            z: 0,
            rotation: 0,
            fills: [
              { slot: 0, ordinal: 1, pinned: false },
              { slot: 1, ordinal: 2, pinned: false },
            ],
          },
        ],
        digest: resolveOrdinals([1, 2], manifest).digest,
      }),
    )
    const decoded = await decodeShareFragment(fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toHaveLength(1)
    expect(Object.keys(decoded.scene.placements[0]?.fills ?? {})).toEqual(['floor'])
    expect(decoded.dropped).toEqual(['slot 1: not a readable slot name, dropping 1 fill'])
  })

  it('keeps the first of two fills naming one slot, and says so', async () => {
    // Unreachable from any encoder — `fills` is a map on both sides — so this is
    // a hand-edited payload contradicting itself, and choosing silently between
    // two files is the one thing this codec does not do.
    const manifest = manifestOf(8)
    const fragment = await fragmentOfPayload(
      wire({
        instances: [
          {
            template: 0,
            x: 0,
            z: 0,
            rotation: 0,
            fills: [
              { slot: 0, ordinal: 1, pinned: false },
              { slot: 0, ordinal: 2, pinned: true },
            ],
          },
        ],
        digest: resolveOrdinals([1, 2], manifest).digest,
      }),
    )
    const decoded = await decodeShareFragment(fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements[0]?.fills['floor' as SlotName]).toEqual({ tile: tileId(1), pinned: false })
    expect(decoded.dropped).toEqual(['placement 0: slot floor is filled twice, keeping the first'])
  })

  it('drops an unencodable fill and an unplaceable instance at encode time, naming both', async () => {
    const manifest = manifestOf(4)
    const scene: SharedScene = {
      lock: 'openlock',
      placements: [
        placement(
          FAMILY,
          [
            ['floor', 0],
            ['wall', 99],
          ],
          1,
          1,
          0,
        ),
        placement(FAMILY, [['floor', 1]], Number.NaN, 0, 0),
      ],
      generated: [],
    }
    const encoded = await encodeShareFragment(scene, manifest)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.dropped).toHaveLength(2)
    expect(encoded.dropped[0]).toContain('slot wall')
    expect(encoded.dropped[0]).toContain('is not in this catalog build')
    expect(encoded.dropped[1]).toContain('finite')

    // The instance with the missing wall still travels, with its floor intact.
    const decoded = await decodeShareFragment(encoded.fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.placements).toEqual([placement(FAMILY, [['floor', 0]], 1, 1, 0)])
    expect(decoded.dropped).toEqual([])
  })

  it('resets a lock system this build does not know, keeping the room', async () => {
    // A link from a hypothetical future build that added a fourth lock system.
    // The geometry is intact and the checksum is correct, so the room must open;
    // only the preference degrades.
    const manifest = manifestOf(8)
    const fragment = await fragmentOfPayload(
      wire({
        lockIndex: 7,
        instances: [{ template: 0, x: 1, z: 1, rotation: 90, fills: [{ slot: 0, ordinal: 2, pinned: false }] }],
        digest: resolveOrdinals([2], manifest).digest,
      }),
    )
    const decoded = await decodeShareFragment(fragment, manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.lock).toBe('openlock')
    expect(decoded.scene.placements).toEqual([placement(FAMILY, [['floor', 2]], 1, 1, 90)])
    expect(decoded.dropped.join('\n')).toContain('index 7')
  })

  it('normalises an out-of-range rotation rather than rejecting the link', async () => {
    const manifest = manifestOf(8)
    const scene: SharedScene = {
      lock: 'openlock',
      placements: [placement(FAMILY, [['floor', 1]], 0, 0, 450)],
      generated: [],
    }
    const decoded = await decodeShareFragment(await fragmentOf(scene, manifest), manifest)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene.placements[0]?.rotation).toBe(90)
  })

  it('checksums exactly the fills the scene contains', async () => {
    // The digest is over the distinct ordinals the link references, so it is the
    // set of files the download pack would hold — nothing about how many
    // instances share one.
    const manifest = manifestOf(64)
    const encoded = await encodeShareFragment(SCENE, manifest)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const written = resolveOrdinals(SCENE_ORDINALS, manifest)
    expect(written.unresolved).toEqual([])
    expect(written.tiles.size).toBe(SCENE_ORDINALS.length)
    // A digest over a different set must not match, or the assertion above is
    // measuring nothing.
    expect(resolveOrdinals([...SCENE_ORDINALS, 7], manifest).digest).not.toBe(written.digest)
  })
})

/**
 * The generated half's failure paths.
 *
 * The round trip itself is asserted in `capacity.test.ts`, beside the
 * measurement that decided the format carries these at all. What is here is the
 * part that has to be **total**: a recipe table is a stranger's text out of a
 * URL, and every way it can be wrong has to become a `dropped` line and an
 * otherwise-intact room rather than a throw or a silently missing piece.
 */
describe('a link carrying a generated base', () => {
  /** A payload whose recipe table holds exactly the given documents. */
  async function fragmentWithRecipes(documents: readonly string[], count = documents.length): Promise<string> {
    return fragmentOfPayload(
      wire({
        digest: resolveOrdinals([], manifestOf(8)).digest,
        recipes: documents,
        generated: Array.from({ length: count }, (_unused, index) => ({
          recipe: index % Math.max(1, documents.length),
          x: index,
          z: 0,
          rotation: 0,
        })),
      }),
    )
  }

  const GOOD =
    '{"base":"gen:v1 risers_square.scad LOCK=\\"openlock\\" SQUARE_BASIS=\\"inch\\" SUPPORTS=true x=2 y=2 z=4",' +
    '"recipe":{"v":1,"entry":"risers_square.scad","parameters":{"LOCK":"openlock","SQUARE_BASIS":"inch",' +
    '"SUPPORTS":true,"x":2,"y":2,"z":4}}}'

  it('opens a hand-built link whose table this build can read', async () => {
    const manifest = manifestOf(8)
    const decoded = await decodeShareFragment(await fragmentWithRecipes([GOOD]), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.dropped).toEqual([])
    expect(decoded.scene.generated).toHaveLength(1)
    expect(decoded.scene.generated[0]?.recipe.entry).toBe('risers_square.scad')
    expect(decoded.scene.generated[0]?.recipe.parameters.z).toBe(4)
  })

  it.each([
    ['not JSON at all', 'gen:v1 risers_square.scad'],
    ['JSON that is not an object', '"gen:whatever"'],
    ['an id outside the generated space', GOOD.replace('"gen:v1', '"tiles/v1')],
    [
      'an entry point this build does not offer',
      // The `"entry":` occurrence, not the first one — the id carries the entry
      // name too, and rewriting *that* leaves a document this build still reads.
      GOOD.replace('"entry":"risers_square.scad"', '"entry":"bases-curved.scad"'),
    ],
    ['a parameter value of a type no `-D` takes', GOOD.replace('"z":4', '"z":{"nested":1}')],
  ])('drops a table entry that is %s, and says how many bases it cost', async (_label, document) => {
    const manifest = manifestOf(8)
    // Three placements on the one bad recipe, so the message has to aggregate.
    const decoded = await decodeShareFragment(await fragmentWithRecipes([document], 3), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.generated).toEqual([])
    expect(decoded.dropped).toHaveLength(1)
    expect(decoded.dropped[0]).toContain('generated recipe 0')
    expect(decoded.dropped[0]).toContain('dropping 3 bases')
  })

  it('keeps the readable half of a table and reports only the rest', async () => {
    const manifest = manifestOf(8)
    const decoded = await decodeShareFragment(await fragmentWithRecipes([GOOD, 'not json'], 2), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.generated).toHaveLength(1)
    expect(decoded.dropped).toHaveLength(1)
    expect(decoded.dropped[0]).toContain('dropping 1 base')
  })

  it('says nothing about a table entry no placement names', async () => {
    const manifest = manifestOf(8)
    // A payload is free to leave an unreferenced entry, and a discarded one that
    // cost the user nothing must not appear in a notice beside their room.
    const decoded = await decodeShareFragment(await fragmentWithRecipes([GOOD, 'not json'], 1), manifest)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene.generated).toHaveLength(1)
    expect(decoded.dropped).toEqual([])
  })

  it('rejects a payload whose recipe index is off the end of its own table', async () => {
    const manifest = manifestOf(8)
    // Not reachable through `encodePayload`, which throws on it, so the bytes are
    // assembled by hand — an index into a table that is not there is the payload
    // contradicting itself rather than a datum to salvage.
    expect(() => encodePayload(wire({ generated: [{ recipe: 0, x: 0, z: 0, rotation: 0 }] }))).toThrow()

    const raw = encodePayload(
      wire({
        digest: resolveOrdinals([], manifest).digest,
        recipes: [GOOD],
        generated: [{ recipe: 0, x: 0, z: 0, rotation: 0 }],
      }),
    )
    // The recipe column is the byte immediately after the table; point it at
    // entry 1 of a one-entry table.
    const index = raw.lastIndexOf(0, raw.length - 4)
    raw[index] = 1
    const compressed = await deflateRaw(raw)
    expect(compressed).toBeDefined()
    if (compressed === undefined) return
    const decoded = await decodeShareFragment(`#s=${toBase64Url(compressed)}`, manifest)
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) expect(decoded.reason).toBe('malformed')
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
    const raw = encodePayload(wire())
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
      ' ',
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

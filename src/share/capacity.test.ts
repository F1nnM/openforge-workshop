// @vitest-environment jsdom
/**
 * How much room fits in a link — measured, printed, and asserted.
 *
 * architecture-plan.md §13 gives share links no capacity figure, and the brief for
 * this PR carried two guesses: ~2,400 placements for a room-shaped build and ~215
 * for a scattered one. This file is where those become numbers. It measures two
 * build shapes against the {@link SHARE_URL_BUDGET}, prints the table, and asserts
 * loose bounds — loose because the exact figure depends on zlib's parameters, and a
 * test that pinned it would fail on a Node upgrade for no reason. What it must
 * catch is a regression of an order of magnitude.
 *
 * **The two shapes are the two ends of the range, and the range is the finding.**
 *
 *   - A *room* is what people build: a rectangle of one floor tile, a perimeter of
 *     one wall tile, four corners, a prop every few squares. Three or four distinct
 *     ordinals over hundreds of placements, coordinates that advance by one, one or
 *     two rotations. Deflate eats it.
 *   - A *scattered* build is the adversarial case: every placement a different
 *     tile, positions anywhere on a 120×120 plan, rotations drawn from all five
 *     angle families in the corpus. It is essentially incompressible — below about
 *     a hundred placements `deflate-raw` returns *more* bytes than it was given —
 *     so its capacity is set by the raw varint count and nothing else.
 *
 * The spread between them is over 100×, which is why {@link shareUrlFits} takes a
 * URL and not a number of tiles: **any placement-count threshold is wrong by two
 * orders of magnitude at one end or the other.**
 */
import { describe, expect, it } from 'vitest'

import type { ManifestOrdinal, TileId } from '@/catalog'
import type { Placement } from '@/store'

import { ByteWriter } from './bytes'
import { SHARE_URL_BUDGET, buildShareUrl, decodeShareFragment, encodeShareFragment, shareUrlFits } from './link'
import type { ShareManifest } from './manifest'
import { buildShareManifest } from './manifest'
import type { SharedScene } from './scene'
import { deflateRaw, toBase64Url } from './transport'

/** The live corpus size, so ordinals in the fixtures are the width they really are. */
const CORPUS = 8702

/** A plausible deployed URL, since the budget is on the whole thing, not the payload. */
const BASE_URL = 'https://openforge.tools/builder'

function tileId(index: number): TileId {
  return `tiles/fixture/family/fixture#tile.${String(index)}x1.openlock.stl` as TileId
}

const MANIFEST: ShareManifest = buildShareManifest({
  version: { manifest: 1 },
  records: Array.from({ length: CORPUS }, (_, index) => ({ id: tileId(index), ord: index as ManifestOrdinal })),
})

/* ------------------------------------------------------------ build shapes */

/**
 * A room-shaped build of `count` placements.
 *
 * Grown as a square so the shape is the same at every size, and with no duplicate
 * placements: an earlier version of this fixture regrew the floor at every size and
 * so measured its own duplicates, which is a different and much easier problem than
 * compressing a room.
 */
function room(count: number): Placement[] {
  const FLOOR = 1234
  const WALL = 2345
  const CORNER = 2346
  const PROPS = [3456, 4567, 5678, 6789]
  const side = Math.max(1, Math.ceil(Math.sqrt(count)))
  const placements: Placement[] = []

  for (let x = 0; x < side && placements.length < count; x += 1) {
    for (let z = 0; z < side && placements.length < count; z += 1) {
      const prop = x % 7 === 3 && z % 5 === 2
      placements.push({
        tileId: tileId(prop ? (PROPS[(x + z) % PROPS.length] ?? FLOOR) : FLOOR),
        x,
        z,
        rotation: prop ? ((x + z) % 4) * 90 : 0,
      })
    }
  }
  for (let x = 0; x < side && placements.length < count; x += 1) {
    placements.push({ tileId: tileId(WALL), x, z: -0.5, rotation: 0 })
    if (placements.length < count) placements.push({ tileId: tileId(WALL), x, z: side - 0.5, rotation: 180 })
  }
  for (let z = 0; z < side && placements.length < count; z += 1) {
    placements.push({ tileId: tileId(WALL), x: -0.5, z, rotation: 90 })
    if (placements.length < count) placements.push({ tileId: tileId(WALL), x: side - 0.5, z, rotation: 270 })
  }
  const corners: readonly (readonly [number, number])[] = [
    [-0.5, -0.5],
    [side - 0.5, -0.5],
    [-0.5, side - 0.5],
    [side - 0.5, side - 0.5],
  ]
  corners.forEach(([x, z], index) => {
    if (placements.length < count) placements.push({ tileId: tileId(CORNER), x, z, rotation: index * 90 })
  })

  return placements.slice(0, count)
}

/** A deterministic LCG, so a capacity figure is reproducible across runs. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/** The adversarial build: maximum palette diversity, positions anywhere. */
function scattered(count: number): Placement[] {
  const random = lcg(12345)
  const steps = [90, 45, 22.5, 11.25, 60]
  const used = new Set<number>()
  const placements: Placement[] = []

  while (placements.length < count) {
    let ordinal = Math.floor(random() * CORPUS)
    if (used.size < CORPUS) {
      while (used.has(ordinal)) ordinal = (ordinal + 1) % CORPUS
      used.add(ordinal)
    }
    const step = steps[Math.floor(random() * steps.length)] ?? 90
    const turns = Math.floor(random() * (360 / step))
    placements.push({
      tileId: tileId(ordinal),
      // `+ 0` folds `-0` to `+0`, which is what `Placement`'s coordinate transform
      // and the codec both do; without it the fixture would not compare equal to
      // its own round trip.
      x: Math.round(random() * 240 - 120) / 2 + 0,
      z: Math.round(random() * 240 - 120) / 2 + 0,
      rotation: (step * turns) % 360,
    })
  }
  return placements
}

type Shape = (count: number) => Placement[]

function sceneOf(shape: Shape, count: number): SharedScene {
  return { lock: 'openlock', placements: shape(count) }
}

/* ------------------------------------------------------------- the controls */

/**
 * The three encodings this PR did **not** ship, measured on the same fixtures
 * through the same compression and the same base64, so the table in `payload.ts`
 * is a measurement rather than an assertion. Each isolates one variable:
 *
 *   - `naive` — JSON, array of objects. The obvious implementation, and what the
 *     plan's prose implies. Varies both layout and representation.
 *   - `columnar JSON` — same layout as the shipped codec, text representation.
 *     Isolates *layout*: the gap between this and naive is what columnar buys.
 *   - `row-major varint` — same representation as the shipped codec, interleaved.
 *     Isolates *representation*: the gap between this and columnar is what the
 *     column-major order buys, once the bytes are already tight.
 */
async function urlLengthOf(bytes: Uint8Array): Promise<number> {
  const compressed = await deflateRaw(bytes)
  if (compressed === undefined) throw new Error('no CompressionStream')
  return buildShareUrl(BASE_URL, `#s=${toBase64Url(compressed)}`).length
}

interface Row {
  readonly o: number
  readonly x: number
  readonly z: number
  readonly r: number
}

function rows(scene: SharedScene): Row[] {
  return scene.placements.map((placement) => ({
    o: MANIFEST.ordinalOf(placement.tileId) ?? 0,
    x: placement.x,
    z: placement.z,
    r: placement.rotation,
  }))
}

async function naiveUrlLength(scene: SharedScene): Promise<number> {
  const body = JSON.stringify({ v: 1, m: MANIFEST.version, lock: scene.lock, p: rows(scene) })
  return urlLengthOf(new TextEncoder().encode(body))
}

async function columnarJsonUrlLength(scene: SharedScene): Promise<number> {
  const all = rows(scene)
  const body = JSON.stringify({
    v: 1,
    m: MANIFEST.version,
    lock: scene.lock,
    o: all.map((row) => row.o),
    x: all.map((row) => row.x),
    z: all.map((row) => row.z),
    r: all.map((row) => row.r),
  })
  return urlLengthOf(new TextEncoder().encode(body))
}

async function rowMajorUrlLength(scene: SharedScene): Promise<number> {
  const all = rows(scene)
  const writer = new ByteWriter()
  // The shipped header, byte for byte, so only the body layout differs.
  writer.u8(1)
  writer.u8(0)
  writer.uvar(MANIFEST.version)
  writer.u8(0)
  writer.uvar(all.length)
  for (let i = 0; i < 4; i += 1) writer.u8(0)
  for (const row of all) {
    writer.uvar(row.o)
    writer.zigzag(row.x * 2)
    writer.zigzag(row.z * 2)
    writer.uvar(row.r * 4)
  }
  return urlLengthOf(writer.bytes())
}

async function urlLength(scene: SharedScene): Promise<number> {
  const encoded = await encodeShareFragment(scene, MANIFEST)
  if (!encoded.ok) throw new Error(encoded.message)
  return buildShareUrl(BASE_URL, encoded.fragment).length
}

/** Largest placement count whose encoded URL is inside the budget. */
async function capacity(measure: (scene: SharedScene) => Promise<number>, shape: Shape, ceiling: number) {
  let low = 0
  let high = ceiling
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if ((await measure(sceneOf(shape, mid))) <= SHARE_URL_BUDGET) low = mid
    else high = mid - 1
  }
  return low
}

/* ------------------------------------------------------------------- tests */

describe('capacity at the 2,000-character budget', () => {
  it('measures both build shapes against the codec and its three alternatives', async () => {
    const measured: { label: string; room: number; scattered: number }[] = []
    for (const [label, measure] of [
      ['naive JSON', naiveUrlLength],
      ['columnar JSON', columnarJsonUrlLength],
      ['row-major varint', rowMajorUrlLength],
      ['columnar varint', urlLength],
    ] as const) {
      measured.push({
        label,
        room: await capacity(measure, room, 60_000),
        scattered: await capacity(measure, scattered, CORPUS),
      })
    }

    console.log(
      [
        '',
        `share-link capacity, ${String(SHARE_URL_BUDGET)}-character URL budget (base ${String(BASE_URL.length)} chars)`,
        '',
        '  encoding                   room-shaped     scattered',
        ...measured.map(
          (row) =>
            `  ${row.label.padEnd(24)} ${String(row.room).padStart(11)} ${String(row.scattered).padStart(13)}`,
        ),
        '',
      ].join('\n'),
    )

    const naiveRoom = measured[0]?.room ?? 1
    const naiveScattered = measured[0]?.scattered ?? 1
    const columnarRoom = measured[3]?.room ?? 0
    const columnarScattered = measured[3]?.scattered ?? 0

    // The plan guessed ~2,400 for a room build; it is out by more than an order of
    // magnitude, in the app's favour.
    expect(columnarRoom).toBeGreaterThan(10_000)
    // And ~215 for a scattered build, which is close: the real figure is a little
    // above it, and this is the number the UI's warning threshold has to respect.
    expect(columnarScattered).toBeGreaterThan(200)
    expect(columnarScattered).toBeLessThan(400)

    // Columnar is worth an order of magnitude on the shape people build, and a
    // clear margin even on the incompressible one.
    expect(columnarRoom / naiveRoom).toBeGreaterThan(10)
    expect(columnarScattered / naiveScattered).toBeGreaterThan(1.2)
  })

  it('prints the per-size costs both encodings actually produce', async () => {
    const lines: string[] = ['', '  n      room columnar  room naive   scattered columnar  scattered naive', '']
    for (const count of [10, 50, 100, 200, 500, 1000]) {
      const roomScene = sceneOf(room, count)
      const scatteredScene = sceneOf(scattered, count)
      lines.push(
        [
          `  ${String(count).padEnd(6)}`,
          String(await urlLength(roomScene)).padStart(13),
          String(await naiveUrlLength(roomScene)).padStart(12),
          String(await urlLength(scatteredScene)).padStart(19),
          String(await naiveUrlLength(scatteredScene)).padStart(17),
        ].join(''),
      )
    }
    console.log([...lines, ''].join('\n'))

    // A fifty-tile room — a single chamber, the common case — is a link somebody
    // can paste into chat without it wrapping.
    expect(await urlLength(sceneOf(room, 50))).toBeLessThan(200)
  })
})

describe('a scene at the URL limit', () => {
  it('round-trips exactly right at the budget, and reports the tile over it', async () => {
    const limit = await capacity(urlLength, scattered, CORPUS)
    const atLimit = sceneOf(scattered, limit)
    const overLimit = sceneOf(scattered, limit + 1)

    const encoded = await encodeShareFragment(atLimit, MANIFEST)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const url = buildShareUrl(BASE_URL, encoded.fragment)
    expect(shareUrlFits(url)).toBe(true)
    expect(url.length).toBeGreaterThan(SHARE_URL_BUDGET - 8)

    // Exactness is not a property of small scenes: the largest link the app will
    // produce must round-trip as precisely as a three-tile one.
    const decoded = await decodeShareFragment(encoded.fragment, MANIFEST)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(atLimit)
    expect(decoded.dropped).toEqual([])

    // One more placement crosses it, and the codec still produces a working link —
    // the budget is a warning threshold, not a failure.
    const over = await encodeShareFragment(overLimit, MANIFEST)
    expect(over.ok).toBe(true)
    if (!over.ok) return
    expect(shareUrlFits(buildShareUrl(BASE_URL, over.fragment))).toBe(false)
    const decodedOver = await decodeShareFragment(over.fragment, MANIFEST)
    expect(decodedOver.ok).toBe(true)
    if (decodedOver.ok) expect(decodedOver.scene).toEqual(overLimit)
  })

  it('round-trips a room build far past any plausible URL length', async () => {
    const scene = sceneOf(room, 30_000)
    const encoded = await encodeShareFragment(scene, MANIFEST)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeShareFragment(encoded.fragment, MANIFEST)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(scene)
  })
})

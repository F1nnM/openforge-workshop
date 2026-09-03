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

import type { DesignId, ManifestOrdinal, TileId } from '@/catalog'
import { fileDefaults, recipeKey } from '@/generator/panel/recipe'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import { generatedBaseId } from '@/generator/placement/scene'
import type { Placement } from '@/store'

import { ByteWriter } from './bytes'
import { SHARE_URL_BUDGET, buildShareUrl, decodeShareFragment, encodeShareFragment, shareUrlFits } from './link'
import type { ShareManifest } from './manifest'
import { buildShareManifest, resolveOrdinals } from './manifest'
import { encodePayload } from './payload'
import type { SharedScene } from './scene'
import { deflateRaw, toBase64Url } from './transport'

/**
 * Print a measured table so a run reports it.
 *
 * `process.stdout.write` rather than `console.log`, and that is a fix rather
 * than a style: this file is a jsdom suite, jsdom installs its own `console` on
 * the window, and **the tables this file has claimed to print "on every run"
 * have never appeared once.** Verified by running the two `console.log` suites
 * in the tree side by side — `src/composition/corpus.test.ts` and
 * `src/generator/engine/render.test.ts` are node-environment and both print;
 * this one is the only jsdom suite that logs, and it printed nothing at any
 * verbosity, `--silent=false` included. A measurement nobody can read is the
 * same shape of defect as a guard that cannot fail.
 */
function report(lines: readonly string[]): void {
  process.stdout.write(`${lines.join('\n')}\n`)
}

/** The live corpus size, so ordinals in the fixtures are the width they really are. */
const CORPUS = 8702

/** A plausible deployed URL, since the budget is on the whole thing, not the payload. */
const BASE_URL = 'https://openforge.tools/builder'

function tileId(index: number): TileId {
  return `tiles/fixture/family/fixture#tile.${String(index)}x1.openlock.stl` as TileId
}

/**
 * The design of fixture tile `index`.
 *
 * **One file per design**, which is what keeps every figure below comparable
 * with row X10's: a design's address is its own ordinal, so the ordinal column
 * carries the same integers it carried before row V4 and the *only* thing the
 * row changed about a link is what those integers mean. The multi-variant case
 * is measured separately, at the end of this file.
 */
function designId(index: number): DesignId {
  return `d-fixture-${String(index)}` as DesignId
}

const MANIFEST: ShareManifest = buildShareManifest({
  version: { manifest: 1 },
  records: Array.from({ length: CORPUS }, (_, index) => ({
    id: tileId(index),
    ord: index as ManifestOrdinal,
    design: designId(index),
  })),
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
        design: designId(prop ? (PROPS[(x + z) % PROPS.length] ?? FLOOR) : FLOOR),
        x,
        z,
        rotation: prop ? ((x + z) % 4) * 90 : 0,
      })
    }
  }
  for (let x = 0; x < side && placements.length < count; x += 1) {
    placements.push({ design: designId(WALL), x, z: -0.5, rotation: 0 })
    if (placements.length < count) placements.push({ design: designId(WALL), x, z: side - 0.5, rotation: 180 })
  }
  for (let z = 0; z < side && placements.length < count; z += 1) {
    placements.push({ design: designId(WALL), x: -0.5, z, rotation: 90 })
    if (placements.length < count) placements.push({ design: designId(WALL), x: side - 0.5, z, rotation: 270 })
  }
  const corners: readonly (readonly [number, number])[] = [
    [-0.5, -0.5],
    [side - 0.5, -0.5],
    [-0.5, side - 0.5],
    [side - 0.5, side - 0.5],
  ]
  corners.forEach(([x, z], index) => {
    if (placements.length < count) placements.push({ design: designId(CORNER), x, z, rotation: index * 90 })
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
      design: designId(ordinal),
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
  return { lock: 'openlock', placements: shape(count), generated: [] }
}

/* ---------------------------------------------------------- generated bases */

/**
 * `distinct` recipes spread over `count` generated bases, at the widest shape.
 *
 * `bases-square.scad` at file defaults is a 226-character recipe key, and
 * `bases-square-internal_corner.scad` is 242 — the two widest of the five — so
 * varying `HEIGHT` over the square keeps every document near the top of the size
 * range rather than measuring the 85-character riser.
 *
 * The recipes are built through the real `recipeKey`/`generatedBaseId` rather
 * than from a fixture string, so this measures the documents the app will
 * actually put on the wire, including the parameter fill `canonicalise` does.
 */
function generatedBases(count: number, distinct: number): GeneratedPlacement[] {
  const entry = 'bases-square.scad'
  return Array.from({ length: count }, (_, index) => {
    const parameters = { ...fileDefaults(entry), HEIGHT: 6 + (index % distinct) }
    const recipe = { v: 1, entry, parameters } as const
    return {
      base: generatedBaseId(recipeKey(recipe)),
      recipe,
      x: (index % 12) + 0,
      z: Math.floor(index / 12) + 0,
      rotation: (index % 4) * 90,
    }
  })
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
    o: MANIFEST.ordinalOf(placement.design) ?? 0,
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
  return urlLength2(scene, MANIFEST)
}

/** The same, against a manifest other than the corpus-shaped one. */
async function urlLength2(scene: SharedScene, manifest: ShareManifest): Promise<number> {
  const encoded = await encodeShareFragment(scene, manifest)
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

    report(
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
      ],
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
    report([...lines, ''])

    // A fifty-tile room — a single chamber, the common case — is a link somebody
    // can paste into chat without it wrapping.
    expect(await urlLength(sceneOf(room, 50))).toBeLessThan(200)
  })
})

describe('what a generated base costs in a link', () => {
  /**
   * The measurement that decided row X10's first item.
   *
   * X9 reported that a share link silently dropped generated bases, and the
   * honest question was not whether to warn but whether they *fit*: a generated
   * base has no manifest ordinal, so what identifies it is a recipe, and a
   * canonical recipe key is 85–242 characters against a 2,000-character URL.
   *
   * Printed, not just asserted, because the number is the argument. The bounds
   * below are loose for the reason the rest of this file's are — zlib's
   * parameters are not ours — and they are placed to catch the two regressions
   * that would matter: the dedup silently not working (which would make the
   * 90-bases-1-recipe row cost ninety documents), and the whole feature growing
   * past the budget on a scene someone would really build.
   */
  it('prints the cost of the generated half against the budget', async () => {
    const cases: readonly (readonly [label: string, tiles: number, bases: number, distinct: number])[] = [
      ['90 tiles, no bases', 90, 0, 1],
      ['90 tiles, 1 base', 90, 1, 1],
      ['90 tiles, 16 bases, 1 recipe', 90, 16, 1],
      ['90 tiles, 90 bases, 1 recipe', 90, 90, 1],
      ['90 tiles, 90 bases, 3 recipes', 90, 90, 3],
      ['90 tiles, 90 bases, 90 recipes', 90, 90, 90],
      ['400 tiles, 64 bases, 2 recipes', 400, 64, 2],
    ]
    const measured: { label: string; chars: number }[] = []
    for (const [label, tiles, bases, distinct] of cases) {
      const scene: SharedScene = {
        lock: 'openlock',
        placements: room(tiles),
        generated: generatedBases(bases, distinct),
      }
      measured.push({ label, chars: await urlLength(scene) })
    }

    const baseline = measured[0]?.chars ?? 0
    report(
      [
        '',
        `generated bases in a link, ${String(SHARE_URL_BUDGET)}-character budget (base ${String(BASE_URL.length)} chars)`,
        '',
        '  scene                            link chars   over no bases   of budget',
        ...measured.map(
          (row) =>
            `  ${row.label.padEnd(32)} ${String(row.chars).padStart(10)} ${String(row.chars - baseline).padStart(15)} ${`${((row.chars / SHARE_URL_BUDGET) * 100).toFixed(1)}%`.padStart(11)}`,
        ),
        '',
      ],
    )

    const one = measured[1]?.chars ?? 0
    const sixteen = measured[2]?.chars ?? 0
    const ninetyOneRecipe = measured[3]?.chars ?? 0
    const ninetyNinetyRecipes = measured[5]?.chars ?? 0

    // The first base is the whole cost, and it is affordable.
    expect(one - baseline).toBeGreaterThan(100)
    expect(one - baseline).toBeLessThan(600)

    // **The dedup is load-bearing and this is the assertion that can fail without
    // it.** Ninety bases on one recipe must not cost ninety documents: each carries
    // its own 563 bytes, and deflate recovers much but not all of the repetition.
    // Verified capable of failing: keying `collectGenerated` on the placement
    // index rather than on `base` — so every base gets a table entry of its own —
    // takes this delta from 66 characters to 587, and this line is the only one of
    // the six that catches it.
    expect(ninetyOneRecipe - one).toBeLessThan(120)
    expect(ninetyNinetyRecipes).toBeGreaterThan(ninetyOneRecipe * 1.5)

    // A scene of sixteen generated bases on one recipe under a ninety-tile room —
    // a whole chamber floored with generated bases — is inside the budget with
    // room to spare, which is what makes encoding them the right trade.
    expect(sixteen).toBeLessThan(SHARE_URL_BUDGET / 2)
    // Even the adversarial shape fits.
    expect(ninetyNinetyRecipes).toBeLessThan(SHARE_URL_BUDGET)
  })

  it('round-trips generated bases exactly, including a rotation and an off-grid position', async () => {
    const scene: SharedScene = {
      lock: 'magnetic',
      placements: room(12),
      generated: [
        ...generatedBases(3, 2),
        // The exact-column escape hatch has to cover the generated half too: a
        // quarter-unit position and a non-quarter-degree rotation force f64 for
        // those columns, and nothing about the room's own columns changes.
        { ...(generatedBases(1, 1)[0] as GeneratedPlacement), x: 0.25, z: 1 / 3, rotation: 33.7 },
      ],
    }
    const encoded = await encodeShareFragment(scene, MANIFEST)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    expect(encoded.dropped).toEqual([])

    const decoded = await decodeShareFragment(encoded.fragment, MANIFEST)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(scene)
    expect(decoded.dropped).toEqual([])
  })
})

describe('what row V4 did to the length of a link', () => {
  /**
   * The row's own claim, measured from both ends.
   *
   * The brief expected shorter links, on the grounds that a `DesignId` is 13
   * characters against a `TileId`'s 39–183. **The codec has never written
   * either**: it writes a manifest ordinal, one or two varint bytes, so there
   * was nothing to reclaim — and 13 raw characters in that column would have
   * been 6 to 13 times *worse*. Every figure in the two tables above is
   * therefore unchanged, to the character, except two rows that moved by +1;
   * A/B-ing `SHARE_FORMAT_VERSION` between 2 and 3 with nothing else touched
   * reproduces exactly that ±1, so it is the version *byte's value* perturbing
   * deflate and not the ordinal column.
   *
   * Where a link really does get shorter is a scene holding **two variants of
   * one item**, which is a scene only the pre-V4 palette could produce: it armed
   * a concrete file under whatever lock preference was set, so browsing under
   * openlock, switching to dragonlock and placing again put two ordinals of one
   * design on the grid. After V4 that scene is not expressible — the placements
   * are one design — so this compares the ninety-tile room the two builds
   * produce for the same *user actions*.
   */
  it('shortens the one scene it can: two variants of one item collapse to one ordinal', async () => {
    // A design at ordinals 7000 and 7001. Two files, one item.
    const manifest = buildShareManifest({
      version: { manifest: 1 },
      records: [
        { id: tileId(7000), ord: 7000 as ManifestOrdinal, design: designId(7000) },
        { id: tileId(7001), ord: 7001 as ManifestOrdinal, design: designId(7000) },
      ],
    })

    // What V4 writes: ninety placements of the item, one distinct ordinal — the
    // design's address, which is the lower of the two.
    const collapsed: SharedScene = {
      lock: 'openlock',
      placements: Array.from({ length: 90 }, (_unused, index) => ({
        design: designId(7000),
        x: index % 10,
        z: Math.floor(index / 10),
        rotation: 0,
      })),
      generated: [],
    }
    const after = await urlLength2(collapsed, manifest)

    // What the pre-V4 store held for the same room: the two files alternating.
    // Built through `encodePayload` because a `Placement` can no longer name a
    // file at all, which is itself the point.
    const before = await urlLengthOf(
      encodePayload({
        manifestVersion: 1,
        lockIndex: 0,
        digest: resolveOrdinals([7000, 7001], manifest).digest,
        placements: Array.from({ length: 90 }, (_unused, index) => ({
          ordinal: index % 2 === 0 ? 7000 : 7001,
          x: index % 10,
          z: Math.floor(index / 10),
          rotation: 0,
        })),
        recipes: [],
        generated: [],
      }),
    )

    report([
      '',
      'one item placed ninety times, as two variants and as one design',
      '',
      `  two ordinals (pre-V4 palette)   ${String(before).padStart(5)} chars`,
      `  one ordinal  (V4)               ${String(after).padStart(5)} chars`,
      `  saved                           ${String(before - after).padStart(5)} chars`,
      '',
    ])

    // **Two characters of two thousand**, measured. The saving is real and it is
    // as small as it is possible for a saving to be, because the two ordinals
    // alternated in a fixed pattern and deflate had already reduced the second
    // one to almost nothing — the same effect that makes the room-shaped build
    // hold 29,705 placements. Anyone expecting this row to buy capacity should
    // read this number: the ordinal column was never the cost.
    expect(before - after).toBeGreaterThan(0)
    expect(before - after).toBeLessThan(20)
    // Both are trivially inside the budget, which is the honest framing: this
    // row is not a capacity row.
    expect(before).toBeLessThan(SHARE_URL_BUDGET / 4)
  })

  it('encodes the design’s address, so two shares of one scene are one link', () => {
    // The lowest ordinal in the group, and `buildShareManifest` takes a minimum
    // rather than the first writer so this does not rest on the emission order.
    const manifest = buildShareManifest({
      version: { manifest: 1 },
      records: [
        // Deliberately out of ordinal order.
        { id: tileId(7001), ord: 7001 as ManifestOrdinal, design: designId(7000) },
        { id: tileId(7000), ord: 7000 as ManifestOrdinal, design: designId(7000) },
      ],
    })
    expect(manifest.ordinalOf(designId(7000))).toBe(7000)
    expect(manifest.designs).toBe(1)
    expect(manifest.size).toBe(2)
    // Either variant's ordinal resolves back to the item, which is what makes a
    // version 2 link readable in principle — see `payload.ts`.
    expect(manifest.designOf(7000)).toBe(designId(7000))
    expect(manifest.designOf(7001)).toBe(designId(7000))
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

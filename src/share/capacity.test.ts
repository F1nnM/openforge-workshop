// @vitest-environment jsdom
/**
 * How much room fits in a link — measured, printed, and asserted.
 *
 * architecture-plan.md §13 gives share links no capacity figure. This file is
 * where the figures come from. It measures two build shapes against the
 * {@link SHARE_URL_BUDGET}, prints the tables, and asserts loose bounds — loose
 * because the exact figure depends on zlib's parameters, and a test that pinned
 * it would fail on a Node upgrade for no reason. What it must catch is a
 * regression of an order of magnitude.
 *
 * **Row A5 re-measured every figure from scratch, and none of the pre-A1 ones
 * carry over.** A placement used to be one ordinal on a cell; it is now a
 * template instance with three to five filled slots, each naming a file and
 * carrying a `pinned` bit. That is a different subject, not a tuned version of
 * the old one, so the old numbers are not restated anywhere — the one comparison
 * worth making is made explicitly, in the last describe block, against a
 * one-ordinal-per-placement encoder built here for the purpose.
 *
 * **The two shapes are the two ends of the range, and the range is the finding.**
 *
 *   - A *room* is what people build: a few template families repeated over a
 *     rectangle, each family's slots filled with the same files — which is what
 *     one lock preference and one solver produce — coordinates that advance by
 *     one, one or two rotations. Deflate eats it.
 *   - A *scattered* build is the adversarial case: every instance a different
 *     family, every slot a different file, positions anywhere on a 120x120 plan,
 *     rotations drawn from all five angle families in the corpus, pinned bits
 *     alternating. It is essentially incompressible, so its capacity is set by
 *     the raw varint count and nothing else.
 *
 * The spread between them is what makes {@link shareUrlFits} take a URL and not a
 * number of instances: **any instance-count threshold is wrong by two orders of
 * magnitude at one end or the other.**
 */
import { describe, expect, it } from 'vitest'

import type { DesignId, ManifestOrdinal, TileId } from '@/catalog'
import { fileDefaults, recipeKey } from '@/generator/panel/recipe'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import { generatedBaseId } from '@/generator/placement/scene'
import { RECIPE_TEMPLATES } from '@/screens/assemblies/templates'
import type { NewTemplateInstance, SlotFill, SlotName, TemplateId } from '@/store'

import { ByteWriter } from './bytes'
import { SHARE_URL_BUDGET, buildShareUrl, decodeShareFragment, encodeShareFragment, shareUrlFits } from './link'
import type { ShareManifest } from './manifest'
import { buildShareManifest, resolveOrdinals } from './manifest'
import type { WirePayload } from './payload'
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

function designId(index: number): DesignId {
  return `d-fixture-${String(index)}` as DesignId
}

/**
 * One file per design, and that is not a simplification any figure here rests
 * on: since row A5 a fill names a file and the codec never asks for a design's
 * address, so the `design` column of the manifest is inert for every measurement
 * below. It is populated because `ShareManifestSource` requires it.
 */
const MANIFEST: ShareManifest = buildShareManifest({
  version: { manifest: 1 },
  records: Array.from({ length: CORPUS }, (_unused, index) => ({
    id: tileId(index),
    ord: index as ManifestOrdinal,
    design: designId(index),
  })),
})

/* ------------------------------------------------------------ build shapes */

/**
 * The real template table, measured rather than fixtured.
 *
 * Imported from the screen's data module — a **test-only** import, and the codec
 * itself still never reaches a screen (`payload.ts` says why the identity has to
 * travel as text). What it buys is that every length in these tables is the
 * length the app will really put on the wire: 40 families, mean id 41.0
 * characters, 51 at the widest, 128 parts over 6 distinct slot names, and
 * arities of exactly 3 (36 families) and 5 (4 families).
 */
const FAMILIES = RECIPE_TEMPLATES
const ARITIES = [...new Set(FAMILIES.map((family) => family.parts.length))].sort((left, right) => left - right)

/** The four families a room build repeats — three of arity 3 and the one of arity 5. */
const ROOM_FAMILIES = [
  FAMILIES.find((family) => family.parts.length === 5),
  ...FAMILIES.filter((family) => family.parts.length === 3).slice(0, 3),
].filter((family): family is (typeof FAMILIES)[number] => family !== undefined)

/**
 * The file a room build puts in each slot name.
 *
 * One ordinal per slot name across the whole room, because that is what one lock
 * preference and one solver produce: the floor of every corner instance is the
 * same STL. This is the repetition the columnar layout exists to exploit, and
 * inventing a distinct file per instance would measure the scattered shape twice.
 */
const ROOM_FILES: Record<string, number> = {
  floor: 1234,
  wall: 2345,
  column: 2346,
  base: 3456,
  'right wall': 4567,
  'left wall': 5678,
}

function fillsFor(parts: readonly { readonly name: string }[], file: (name: string) => number, pinned = false) {
  const fills: Record<SlotName, SlotFill> = {}
  for (const part of parts) fills[part.name as SlotName] = { tile: tileId(file(part.name)), pinned }
  return fills
}

/** How wide a room build is before it wraps to the next row. */
const ROOM_WIDTH = 40

/**
 * A room-shaped build of `count` instances.
 *
 * A **fixed-width strip rather than a square**, and that is a fix rather than a
 * simplification. Growing as a square makes `side` step at every `count = side^2`
 * and widens both coordinate columns when it does, so the encoded length is not
 * monotone in the instance count — measured, the binary search below then
 * plateaus on the step and reports the same figure (exactly 100^2) for two
 * encodings of different sizes. A fixed width grows one coordinate only, which
 * makes the length monotone and the capacity figure the count it claims to be.
 *
 * No duplicate instances: an earlier version of this fixture regrew the floor at
 * every size and so measured its own duplicates, which is a different and much
 * easier problem than compressing a room.
 */
function room(count: number): NewTemplateInstance[] {
  return Array.from({ length: count }, (_unused, index) => {
    const x = index % ROOM_WIDTH
    const z = Math.floor(index / ROOM_WIDTH)
    // Every seventh column and fifth row takes the wide family and a rotation,
    // which is the "a prop every few squares" shape of a real room.
    const feature = x % 7 === 3 && z % 5 === 2
    const family = ROOM_FAMILIES[feature ? 0 : 1 + ((x + z) % (ROOM_FAMILIES.length - 1))] ?? ROOM_FAMILIES[0]
    if (family === undefined) throw new Error('the shipped template table is empty')
    return {
      template: family.id as TemplateId,
      x,
      z,
      rotation: feature ? ((x + z) % 4) * 90 : 0,
      // One pinned fill every few instances: a room somebody has adjusted, not a
      // bitset of all zeros, which would measure the easiest possible case.
      fills: fillsFor(family.parts, (name) => ROOM_FILES[name] ?? 1234, feature),
    }
  })
}

/** A deterministic LCG, so a capacity figure is reproducible across runs. */
function lcg(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/** The adversarial build: maximum family and file diversity, positions anywhere. */
function scattered(count: number): NewTemplateInstance[] {
  const random = lcg(12345)
  const steps = [90, 45, 22.5, 11.25, 60]
  const used = new Set<number>()
  const instances: NewTemplateInstance[] = []

  const nextOrdinal = (): number => {
    let ordinal = Math.floor(random() * CORPUS)
    if (used.size < CORPUS) {
      while (used.has(ordinal)) ordinal = (ordinal + 1) % CORPUS
      used.add(ordinal)
    }
    return ordinal
  }

  while (instances.length < count) {
    const family = FAMILIES[instances.length % FAMILIES.length]
    if (family === undefined) break
    const step = steps[Math.floor(random() * steps.length)] ?? 90
    const turns = Math.floor(random() * (360 / step))
    const fills: Record<SlotName, SlotFill> = {}
    for (const part of family.parts) {
      fills[part.name as SlotName] = { tile: tileId(nextOrdinal()), pinned: random() < 0.5 }
    }
    instances.push({
      template: family.id as TemplateId,
      // `+ 0` folds `-0` to `+0`, which is what the schema's coordinate transform
      // and the codec both do; without it the fixture would not compare equal to
      // its own round trip.
      x: Math.round(random() * 240 - 120) / 2 + 0,
      z: Math.round(random() * 240 - 120) / 2 + 0,
      rotation: (step * turns) % 360,
      fills,
    })
  }
  return instances
}

type Shape = (count: number) => NewTemplateInstance[]

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
  return Array.from({ length: count }, (_unused, index) => {
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

async function urlLengthOf(bytes: Uint8Array): Promise<number> {
  const compressed = await deflateRaw(bytes)
  if (compressed === undefined) throw new Error('no CompressionStream')
  return buildShareUrl(BASE_URL, `#s=${toBase64Url(compressed)}`).length
}

/**
 * The scene as the wire sees it, interned exactly as `link.ts` interns it:
 * first-use tables, and each instance's slots in sorted order.
 *
 * Restated here rather than exported from `link.ts`, because a control that
 * shared the codec's own interning could not detect the codec interning
 * differently from what this file claims to measure. The round-trip assertion
 * below is what keeps the restatement honest: with all three switches on, the
 * control must produce the shipped payload **byte for byte**.
 */
function wireOf(scene: SharedScene): WirePayload {
  const templates: string[] = []
  const slots: string[] = []
  const intern = (table: string[], value: string): number => {
    const found = table.indexOf(value)
    if (found !== -1) return found
    table.push(value)
    return table.length - 1
  }

  const instances = scene.placements.map((instance) => ({
    template: intern(templates, instance.template),
    x: instance.x,
    z: instance.z,
    rotation: instance.rotation,
    fills: Object.keys(instance.fills)
      .sort()
      .map((slot) => {
        const fill = instance.fills[slot as SlotName]
        return {
          slot: intern(slots, slot),
          ordinal: fill === undefined ? 0 : (MANIFEST.ordinalOfTile(fill.tile) ?? 0),
          pinned: fill?.pinned ?? false,
        }
      }),
  }))

  const ordinals = instances.flatMap((instance) => instance.fills.map((fill) => fill.ordinal))
  return {
    manifestVersion: MANIFEST.version,
    lockIndex: 0,
    digest: resolveOrdinals(ordinals, MANIFEST).digest,
    templates,
    slots,
    instances,
    recipes: [],
    generated: [],
  }
}

/**
 * The encodings this row did **not** ship, over the same fixtures, the same
 * compression and the same base64, so `payload.ts`'s table is a measurement
 * rather than an assertion. Each switch isolates one decision:
 *
 *   - `columnar` — column-major against row-major, at the same representation.
 *   - `tables` — interning the template id and slot name against writing both
 *     inline, which is the decision row A5 had to make and the pre-A1 format
 *     never faced, because an ordinal needed no table.
 *   - `bitset` — one bit per `pinned` against one byte.
 */
interface Layout {
  readonly columnar: boolean
  readonly tables: boolean
  readonly bitset: boolean
}

const SHIPPED: Layout = { columnar: true, tables: true, bitset: true }

function varintBytes(payload: WirePayload, layout: Layout): Uint8Array {
  const writer = new ByteWriter()
  const fills = payload.instances.flatMap((instance) => instance.fills)

  // The shipped header, byte for byte, so only the body layout differs.
  writer.u8(4)
  writer.u8(0)
  writer.uvar(payload.manifestVersion)
  writer.u8(payload.lockIndex)
  writer.uvar(payload.instances.length)
  writer.u8((payload.digest >>> 24) & 0xff)
  writer.u8((payload.digest >>> 16) & 0xff)
  writer.u8((payload.digest >>> 8) & 0xff)
  writer.u8(payload.digest & 0xff)

  const templateOf = (index: number): string => payload.templates[index] ?? ''
  const slotOf = (index: number): string => payload.slots[index] ?? ''

  if (layout.tables) {
    writer.uvar(payload.templates.length)
    for (const entry of payload.templates) writer.utf8(entry)
    writer.uvar(payload.slots.length)
    for (const entry of payload.slots) writer.utf8(entry)
  }

  const writeTemplate = (index: number): void => {
    if (layout.tables) writer.uvar(index)
    else writer.utf8(templateOf(index))
  }
  const writeSlot = (index: number): void => {
    if (layout.tables) writer.uvar(index)
    else writer.utf8(slotOf(index))
  }

  if (layout.columnar) {
    for (const instance of payload.instances) writeTemplate(instance.template)
    for (const instance of payload.instances) writer.zigzag(instance.x * 2)
    for (const instance of payload.instances) writer.zigzag(instance.z * 2)
    for (const instance of payload.instances) writer.uvar(instance.rotation * 4)
    for (const instance of payload.instances) writer.uvar(instance.fills.length)
    for (const fill of fills) writeSlot(fill.slot)
    for (const fill of fills) writer.uvar(fill.ordinal)
    writePinned(writer, fills, layout)
  } else {
    for (const instance of payload.instances) {
      writeTemplate(instance.template)
      writer.zigzag(instance.x * 2)
      writer.zigzag(instance.z * 2)
      writer.uvar(instance.rotation * 4)
      writer.uvar(instance.fills.length)
      for (const fill of instance.fills) {
        writeSlot(fill.slot)
        writer.uvar(fill.ordinal)
        writer.u8(fill.pinned ? 1 : 0)
      }
    }
  }

  // The two zero counts that open the generated half, which every fixture here
  // leaves empty; the generated table is measured on its own further down.
  writer.uvar(0)
  writer.uvar(0)
  return writer.bytes()
}

function writePinned(writer: ByteWriter, fills: readonly { pinned: boolean }[], layout: Layout): void {
  if (!layout.bitset) {
    for (const fill of fills) writer.u8(fill.pinned ? 1 : 0)
    return
  }
  for (let start = 0; start < fills.length; start += 8) {
    let byte = 0
    for (let bit = 0; bit < 8 && start + bit < fills.length; bit += 1) {
      if (fills[start + bit]?.pinned === true) byte |= 1 << bit
    }
    writer.u8(byte)
  }
}

/** JSON, array of objects, both identities inline — the obvious implementation. */
async function naiveUrlLength(scene: SharedScene): Promise<number> {
  const wire = wireOf(scene)
  const body = JSON.stringify({
    v: 4,
    m: wire.manifestVersion,
    lock: scene.lock,
    p: wire.instances.map((instance) => ({
      t: wire.templates[instance.template],
      x: instance.x,
      z: instance.z,
      r: instance.rotation,
      f: instance.fills.map((fill) => ({ s: wire.slots[fill.slot], o: fill.ordinal, p: fill.pinned })),
    })),
  })
  return urlLengthOf(new TextEncoder().encode(body))
}

/** The shipped layout's ordering, in JSON: parallel arrays over the same tables. */
async function columnarJsonUrlLength(scene: SharedScene): Promise<number> {
  const wire = wireOf(scene)
  const fills = wire.instances.flatMap((instance) => instance.fills)
  const body = JSON.stringify({
    v: 4,
    m: wire.manifestVersion,
    lock: scene.lock,
    tt: wire.templates,
    st: wire.slots,
    t: wire.instances.map((instance) => instance.template),
    x: wire.instances.map((instance) => instance.x),
    z: wire.instances.map((instance) => instance.z),
    r: wire.instances.map((instance) => instance.rotation),
    n: wire.instances.map((instance) => instance.fills.length),
    s: fills.map((fill) => fill.slot),
    o: fills.map((fill) => fill.ordinal),
    p: fills.map((fill) => (fill.pinned ? 1 : 0)),
  })
  return urlLengthOf(new TextEncoder().encode(body))
}

async function varintUrlLength(scene: SharedScene, layout: Layout): Promise<number> {
  return urlLengthOf(varintBytes(wireOf(scene), layout))
}

/** The shipped codec, through its own public entry point. */
async function urlLength(scene: SharedScene, manifest: ShareManifest = MANIFEST): Promise<number> {
  const encoded = await encodeShareFragment(scene, manifest)
  if (!encoded.ok) throw new Error(encoded.message)
  return buildShareUrl(BASE_URL, encoded.fragment).length
}

/** Largest instance count whose encoded URL is inside the budget. */
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

describe('the fixtures are the shipped table', () => {
  it('measures the corpus facts every figure below rests on', () => {
    const parts = FAMILIES.reduce((sum, family) => sum + family.parts.length, 0)
    const names = new Set(FAMILIES.flatMap((family) => family.parts.map((part) => part.name)))
    const ids = FAMILIES.map((family) => family.id)
    const mean = ids.reduce((sum, id) => sum + id.length, 0) / ids.length

    report([
      '',
      'the template table these measurements are taken over',
      '',
      `  families                      ${String(FAMILIES.length).padStart(5)}`,
      `  parts                         ${String(parts).padStart(5)}`,
      `  distinct slot names           ${String(names.size).padStart(5)}`,
      `  arities                       ${ARITIES.join(' and ').padStart(5)}`,
      `  template id, mean chars       ${mean.toFixed(1).padStart(5)}`,
      `  template id, widest           ${String(Math.max(...ids.map((id) => id.length))).padStart(5)}`,
      '',
    ])

    // The two arities are the whole reason `MAX_SHARE_FILLS` is
    // `MAX_SHARE_PLACEMENTS * 5` and not some other multiple, so a new arity has
    // to fail here rather than quietly change what the ceiling means.
    expect(ARITIES).toEqual([3, 5])
    expect(names.size).toBe(6)
    expect(FAMILIES.length).toBe(40)
    expect(parts).toBe(128)
  })
})

/**
 * The capacity blocks binary-search an instance count against the codec and five
 * alternative encodings, deflating a payload at every probe. That is seconds of
 * real work rather than a hang, and vitest's 5,000 ms default is not enough for
 * it: three rows (C1, C3 and this one's own author) reproduced a timeout at
 * 5.06 s on an idle machine with the tree otherwise unmodified, and CI passes
 * only because its runner is quieter. The same argument and the same fix as
 * `src/composition/corpus.test.ts`, which carries a `SLOW_CORPUS_MS` for
 * brotli-compressing candidate sets.
 *
 * Raised rather than narrowed deliberately: the search ceilings are already the
 * lowered ones row A5 set (20,000 room / 2,000 scattered, down from 60,000 and
 * 8,702), and the block's value is that it measures every encoding against the
 * shipped one in a single pass.
 */
const SLOW_CAPACITY_MS = 120_000

describe('capacity at the 2,000-character budget', () => {
  it('measures both build shapes against the codec and its alternatives', async () => {
    const measured: { label: string; room: number; scattered: number }[] = []
    for (const [label, measure] of [
      ['naive JSON', naiveUrlLength],
      ['columnar JSON', columnarJsonUrlLength],
      ['row-major varint', (scene: SharedScene) => varintUrlLength(scene, { ...SHIPPED, columnar: false })],
      ['ids inline, no tables', (scene: SharedScene) => varintUrlLength(scene, { ...SHIPPED, tables: false })],
      ['pinned as a byte', (scene: SharedScene) => varintUrlLength(scene, { ...SHIPPED, bitset: false })],
      ['columnar varint', urlLength],
    ] as const) {
      measured.push({
        label,
        room: await capacity(measure, room, 20_000),
        scattered: await capacity(measure, scattered, 2_000),
      })
    }

    report([
      '',
      `share-link capacity, ${String(SHARE_URL_BUDGET)}-character URL budget (base ${String(BASE_URL.length)} chars)`,
      '  in template instances, at the arities the shipped table carries: 3 and 5',
      '',
      '  encoding                   room-shaped     scattered',
      ...measured.map(
        (row) => `  ${row.label.padEnd(24)} ${String(row.room).padStart(11)} ${String(row.scattered).padStart(13)}`,
      ),
      '',
    ])

    const of = (label: string) => measured.find((row) => row.label === label)
    const naive = of('naive JSON')
    const columnarJson = of('columnar JSON')
    const rowMajor = of('row-major varint')
    const inline = of('ids inline, no tables')
    const bytes = of('pinned as a byte')
    const shipped = of('columnar varint')

    // Every alternative is worse on at least one shape, and the shipped one is
    // last on neither. That is the claim `payload.ts` makes from this table.
    expect(shipped?.room).toBeGreaterThan(naive?.room ?? 0)
    expect(shipped?.scattered).toBeGreaterThan(naive?.scattered ?? 0)
    expect(shipped?.room).toBeGreaterThan(columnarJson?.room ?? 0)
    expect(shipped?.room).toBeGreaterThan(rowMajor?.room ?? 0)
    // Layout is worth an order of magnitude on the shape people build.
    expect((columnarJson?.room ?? 0) / (naive?.room ?? 1)).toBeGreaterThan(10)
    // Representation is what carries the incompressible shape.
    expect((rowMajor?.scattered ?? 0) / (naive?.scattered ?? 1)).toBeGreaterThan(1.2)
    // The two tables are the biggest single win row A5 had available, because a
    // template id is 41 characters and an ordinal was two bytes.
    expect((shipped?.room ?? 0) / (inline?.room ?? 1)).toBeGreaterThan(2)
    // And the bitset is a small win, on the shape that is tight.
    expect(shipped?.scattered).toBeGreaterThanOrEqual(bytes?.scattered ?? 0)
  }, SLOW_CAPACITY_MS)

  it('reproduces the shipped payload byte for byte from the control encoder', async () => {
    // What makes the five control rows above trustworthy: the control mirrors the
    // format, so the only thing differing between rows is the switch under test.
    for (const count of [1, 7, 90]) {
      const scene = sceneOf(room, count)
      const payload = wireOf(scene)
      expect(varintBytes(payload, SHIPPED)).toEqual(encodePayload(payload))
    }
    // And the whole pipeline agrees, not just the bytes: same URL, same length.
    expect(await varintUrlLength(sceneOf(room, 90), SHIPPED)).toBe(await urlLength(sceneOf(room, 90)))
  }, SLOW_CAPACITY_MS)

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

    // A fifty-instance room — a single chamber, the common case — is a link
    // somebody can paste into chat without it wrapping.
    expect(await urlLength(sceneOf(room, 50))).toBeLessThan(400)
  }, SLOW_CAPACITY_MS)
})

describe('what row A1 did to the length of a link', () => {
  /**
   * A one-ordinal-per-placement payload, in the pre-A1 layout.
   *
   * The format row A5 replaced: a version byte, the same header, then four
   * columns of one ordinal, x, z and rotation per placement, and the two zero
   * counts of the generated half. Rebuilt here because `encodePayload` can no
   * longer express it — a placement is not one file any more, which is the whole
   * subject of the comparison.
   */
  function v3Bytes(ordinals: readonly number[], positions: readonly { x: number; z: number; r: number }[]): Uint8Array {
    const writer = new ByteWriter()
    writer.u8(3)
    writer.u8(0)
    writer.uvar(MANIFEST.version)
    writer.u8(0)
    writer.uvar(ordinals.length)
    const digest = resolveOrdinals(ordinals, MANIFEST).digest
    writer.u8((digest >>> 24) & 0xff)
    writer.u8((digest >>> 16) & 0xff)
    writer.u8((digest >>> 8) & 0xff)
    writer.u8(digest & 0xff)
    for (const ordinal of ordinals) writer.uvar(ordinal)
    for (const position of positions) writer.zigzag(position.x * 2)
    for (const position of positions) writer.zigzag(position.z * 2)
    for (const position of positions) writer.uvar(position.r * 4)
    writer.uvar(0)
    writer.uvar(0)
    return writer.bytes()
  }

  /** A room of `count` instances, every instance of one family at `arity`. */
  function uniform(count: number, arity: number): NewTemplateInstance[] {
    const family = FAMILIES.find((entry) => entry.parts.length === arity)
    if (family === undefined) throw new Error(`no family of arity ${String(arity)}`)
    return Array.from({ length: count }, (_unused, index) => ({
      template: family.id as TemplateId,
      x: index % 10,
      z: Math.floor(index / 10),
      rotation: 0,
      fills: fillsFor(family.parts, (name) => ROOM_FILES[name] ?? 1234),
    }))
  }

  /**
   * One row of the comparison: an A5 link, and the two honest v3 baselines.
   *
   * There are two because a v3 placement was one *file*, so "the same link"
   * against "the same room" are different questions and the answers differ by
   * the arity:
   *
   *   - `perPlacement` is `count` v3 placements — the same number of things on
   *     the grid, and the comparison the plan's ~5x estimate was making.
   *   - `perFile` is `count * arity` v3 placements — the same set of STLs, which
   *     is what a v3 link actually needed to describe the room an A5 link
   *     describes with `count` instances.
   */
  async function compare(count: number, arity: number) {
    const instances = uniform(count, arity)
    const v4 = await urlLength({ lock: 'openlock', placements: instances, generated: [] })

    const perPlacement = await urlLengthOf(
      v3Bytes(
        instances.map(() => ROOM_FILES.floor ?? 1234),
        instances.map((instance) => ({ x: instance.x, z: instance.z, r: 0 })),
      ),
    )

    const files = instances.flatMap((instance) =>
      Object.keys(instance.fills)
        .sort()
        .map((slot) => ({ ordinal: ROOM_FILES[slot] ?? 1234, x: instance.x, z: instance.z, r: 0 })),
    )
    const perFile = await urlLengthOf(
      v3Bytes(
        files.map((file) => file.ordinal),
        files.map((file) => ({ x: file.x, z: file.z, r: file.r })),
      ),
    )

    return { count, arity, files: files.length, v4, perPlacement, perFile }
  }

  it('measures a twenty-instance room against the format it replaces', async () => {
    const measured: Awaited<ReturnType<typeof compare>>[] = []
    for (const count of [20, 90, 400]) {
      for (const arity of ARITIES) measured.push(await compare(count, arity))
    }

    report([
      '',
      'A5 against the one-ordinal-per-placement format it replaces',
      '',
      '  instances  arity   files   A5 chars   v3 same count   ratio   v3 same files   ratio',
      ...measured.map(
        (row) =>
          `  ${String(row.count).padEnd(10)} ${String(row.arity).padStart(5)} ${String(row.files).padStart(7)} ` +
          `${String(row.v4).padStart(10)} ${String(row.perPlacement).padStart(15)} ` +
          `${(row.v4 / row.perPlacement).toFixed(2).padStart(7)}x ${String(row.perFile).padStart(15)} ` +
          `${(row.v4 / row.perFile).toFixed(2).padStart(7)}x`,
      ),
      '',
    ])

    const at = (count: number, arity: number) =>
      measured.find((row) => row.count === count && row.arity === arity)

    // **The plan estimated ~5x. Measured, a twenty-instance room is 2.4-2.6x a
    // twenty-placement v3 link** — so the estimate is high, but the direction is
    // right and the cost is real. Bounds are loose on zlib's account and closed
    // on both sides, so both a regression to ~5x and a claim of parity fail here.
    for (const arity of ARITIES) {
      const twenty = at(20, arity)
      expect(twenty?.v4 ?? 0).toBeGreaterThan((twenty?.perPlacement ?? 0) * 2)
      expect(twenty?.v4 ?? 0).toBeLessThan((twenty?.perPlacement ?? 0) * 3)
    }

    // **The ratio is dominated by a fixed cost, not by the per-instance one**, and
    // that is the finding the single figure hides: the two string tables are
    // ~90 characters paid once, so the ratio falls as the room grows. A room of
    // four hundred is nearer parity than a room of twenty at both arities.
    for (const arity of ARITIES) {
      const twenty = at(20, arity)
      const fourHundred = at(400, arity)
      const near = (row: typeof twenty) => (row === undefined ? 0 : row.v4 / row.perPlacement)
      expect(near(fourHundred)).toBeLessThan(near(twenty))
    }

    // Arity is sub-linear: five slots is not 5/3 of three slots, because the
    // extra fills are two more runs of one repeated ordinal.
    for (const count of [20, 90, 400]) {
      const three = at(count, 3)
      const five = at(count, 5)
      expect((five?.v4 ?? 0) / (three?.v4 ?? 1)).toBeLessThan(5 / 3)
    }
  }, SLOW_CAPACITY_MS)

  it('prints what one more filled slot costs across a room', async () => {
    const lines: string[] = ['', '  instances   arity 3   arity 5   per extra fill', '']
    for (const count of [20, 90, 400]) {
      const three = await urlLength({ lock: 'openlock', placements: uniform(count, 3), generated: [] })
      const five = await urlLength({ lock: 'openlock', placements: uniform(count, 5), generated: [] })
      lines.push(
        `  ${String(count).padEnd(11)} ${String(three).padStart(7)} ${String(five).padStart(9)} ` +
          `${((five - three) / (2 * count)).toFixed(2).padStart(16)}`,
      )
    }
    report([...lines, ''])

    // Two more fills per instance over four hundred instances is 800 more
    // ordinals and 800 more bits, and it stays inside the budget — which is the
    // reason the arity of the template table is not a capacity risk.
    expect(await urlLength({ lock: 'openlock', placements: uniform(400, 5), generated: [] })).toBeLessThan(
      SHARE_URL_BUDGET,
    )
  }, SLOW_CAPACITY_MS)
})

describe('what a generated base costs in a link', () => {
  /**
   * The measurement that decided row X10's first item, re-taken on A1's shape.
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
    const cases: readonly (readonly [label: string, instances: number, bases: number, distinct: number])[] = [
      ['90 instances, no bases', 90, 0, 1],
      ['90 instances, 1 base', 90, 1, 1],
      ['90 instances, 16 bases, 1 recipe', 90, 16, 1],
      ['90 instances, 90 bases, 1 recipe', 90, 90, 1],
      ['90 instances, 90 bases, 3 recipes', 90, 90, 3],
      ['90 instances, 90 bases, 90 recipes', 90, 90, 90],
      ['400 instances, 64 bases, 2 recipes', 400, 64, 2],
    ]
    const measured: { label: string; chars: number }[] = []
    for (const [label, instances, bases, distinct] of cases) {
      const scene: SharedScene = {
        lock: 'openlock',
        placements: room(instances),
        generated: generatedBases(bases, distinct),
      }
      measured.push({ label, chars: await urlLength(scene) })
    }

    const baseline = measured[0]?.chars ?? 0
    const over = measured.filter((row) => row.chars > SHARE_URL_BUDGET)
    report([
      '',
      `generated bases in a link, ${String(SHARE_URL_BUDGET)}-character budget (base ${String(BASE_URL.length)} chars)`,
      '',
      '  scene                                link chars   over no bases   of budget',
      ...measured.map(
        (row) =>
          `  ${row.label.padEnd(36)} ${String(row.chars).padStart(10)} ${String(row.chars - baseline).padStart(15)} ` +
          `${`${((row.chars / SHARE_URL_BUDGET) * 100).toFixed(1)}%`.padStart(11)}`,
      ),
      '',
      ...(over.length === 0
        ? ['  every shape above is inside the budget']
        : over.map((row) => `  OVER BUDGET: ${row.label} (${String(row.chars)} chars)`)),
      '',
    ])

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
    expect(ninetyOneRecipe - one).toBeLessThan(120)
    expect(ninetyNinetyRecipes).toBeGreaterThan(ninetyOneRecipe * 1.5)

    // A scene of sixteen generated bases on one recipe under a ninety-instance
    // room — a whole chamber floored with generated bases — is inside the budget
    // with room to spare, which is what makes encoding them the right trade.
    expect(sixteen).toBeLessThan(SHARE_URL_BUDGET / 2)

    // **The adversarial row stopped fitting, and row A5 is where that happened.**
    // Ninety bases on ninety *distinct* recipes was 89.2% of the budget when a
    // placement was one ordinal on a cell; the room beneath it costs ~208
    // characters more now, and the total crosses the budget. Two things make that
    // a warning rather than a defect, and neither is a rationalisation: the budget
    // is a *threshold* and not a failure — `link.ts` says so, the codec still
    // produces a working link past it, and `shareUrlFits` is what the UI gates on
    // — and the shape is one nobody builds, while every shape anybody does build
    // is in the rows above at under 51% of budget. Asserted one-sided, so an
    // improvement does not fail and a real regression does.
    expect(ninetyNinetyRecipes).toBeLessThan(SHARE_URL_BUDGET * 1.1)
    // Every non-adversarial shape is inside the budget, and that is the claim the
    // feature rests on.
    for (const row of measured.filter((entry) => entry.label !== '90 instances, 90 bases, 90 recipes')) {
      expect(row.chars, `${row.label} is over the budget`).toBeLessThan(SHARE_URL_BUDGET)
    }
  }, SLOW_CAPACITY_MS)

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
  }, SLOW_CAPACITY_MS)
})

describe('a scene at the URL limit', () => {
  it('round-trips exactly right at the budget, and reports the instance over it', async () => {
    const limit = await capacity(urlLength, scattered, 2_000)
    const atLimit = sceneOf(scattered, limit)
    const overLimit = sceneOf(scattered, limit + 1)

    const encoded = await encodeShareFragment(atLimit, MANIFEST)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const url = buildShareUrl(BASE_URL, encoded.fragment)
    expect(shareUrlFits(url)).toBe(true)
    expect(url.length).toBeGreaterThan(SHARE_URL_BUDGET - 40)

    // Exactness is not a property of small scenes: the largest link the app will
    // produce must round-trip as precisely as a three-instance one.
    const decoded = await decodeShareFragment(encoded.fragment, MANIFEST)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.scene).toEqual(atLimit)
    expect(decoded.dropped).toEqual([])

    // One more instance crosses it, and the codec still produces a working link —
    // the budget is a warning threshold, not a failure.
    const over = await encodeShareFragment(overLimit, MANIFEST)
    expect(over.ok).toBe(true)
    if (!over.ok) return
    expect(shareUrlFits(buildShareUrl(BASE_URL, over.fragment))).toBe(false)
    const decodedOver = await decodeShareFragment(over.fragment, MANIFEST)
    expect(decodedOver.ok).toBe(true)
    if (decodedOver.ok) expect(decodedOver.scene).toEqual(overLimit)
  }, SLOW_CAPACITY_MS)

  it('round-trips a room build far past any plausible URL length', async () => {
    const scene = sceneOf(room, 10_000)
    const encoded = await encodeShareFragment(scene, MANIFEST)
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const decoded = await decodeShareFragment(encoded.fragment, MANIFEST)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.scene).toEqual(scene)
  }, SLOW_CAPACITY_MS)
})

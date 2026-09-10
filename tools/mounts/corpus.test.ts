/**
 * The measured inventory, against the live archive — the conventions 16.34 GB
 * of STL turned out to hold.
 *
 * Everything else in `tools/mounts/` tests the classifier against meshes this
 * repository builds. This file tests the **answer**: `pipeline/mounts/inventory.json`
 * as `npm run mounts -- --inventory` wrote it, joined onto
 * `public/catalog/catalog.json`, asserting the regularities the corpus actually
 * exhibits. It is the only place those regularities are written down as
 * numbers, so a re-measurement that quietly moves one fails here rather than
 * surfacing as a torch hovering off a wall in the builder.
 *
 * Skips — loudly, in the block's own name — when there is no index or when the
 * inventory on disk is `emptyMountInventory`'s shell, which is what a fresh
 * clone that has not fetched the artefact holds. That is the precedent every
 * other corpus block in this repo sets.
 *
 * ## What the run found (fixtures 428289679a0c, measured 2026-09-10)
 *
 * **1,130 objects read**, 16.34 GB, 0 failed — 995 hosts and 135 inserts, plus
 * **4 blobs that are filed both ways** and answer both questions from one parse,
 * which is why 995 + 139 is 1,134 and not the number of objects. The hosts carry
 * **1,301 mounts** (702 opening, 438 socket, 55 pocket, 78 surface, 28 hole) and
 * every one of the **139 inserts** has an anchor (117 leaf, 13 block, 6 plate,
 * 3 peg). Of the 1,230 slots the host blobs declare, **1,183 resolved**; the 47
 * that did not say why: 14 `arc-fit-refused`, 12 `no-socket`, 12 `modelled-in`,
 * 6 `runs-off-end`, 3 `no-opening`.
 *
 * ## The misses are counted, not hidden
 *
 * 12 of the 356 torch hosts yield no socket, and they are one shape: a **round
 * or square full pillar**, whose torch pocket is bored into a curved or a
 * chamfered column face that the 0.5 mm depth map reads as no clean 5.5 × 3 mm
 * mouth. Listing them by filename and asserting the *count* is deliberate — a
 * bare `toBeGreaterThan(0)` over the other 344 would pass just as well after a
 * regression took another family with it.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogRecord } from '../../src/catalog'
import { CatalogFile } from '../../src/catalog'
import type { MountInventory } from '../../pipeline'
import { MOUNT_INVENTORY_PATH, readMountInventory } from '../../pipeline'

import type { HostMeasurement } from './classify'

const CATALOG = 'public/catalog/catalog.json'

/**
 * The inventory, or `undefined` when there is nothing measured to test.
 *
 * `readMountInventory` throws on a *broken* inventory and that must stay a
 * failure, so only the two legitimate "nothing here" states skip: no file at
 * all, and `emptyMountInventory`'s shell.
 */
function measured(): MountInventory | undefined {
  if (!existsSync(MOUNT_INVENTORY_PATH)) return undefined
  const inventory = readMountInventory()
  return inventory === undefined || inventory.counted.hosts === 0 ? undefined : inventory
}

const inventory = measured()
const runnable = existsSync(CATALOG) && inventory !== undefined
const describeCorpus = runnable ? describe : describe.skip

/* ------------------------------------------------------- the measured numbers */

/** What the run wrote, and what the README, the spec and the facts script quote. */
const COUNTED = { hosts: 995, inserts: 139, mounts: 1301, failed: 0 } as const

/**
 * The Dupont socket's entry angle, `acos(dot(axis, −normal))` in degrees.
 *
 * This is `classify.ts`'s own acceptance band, asserted here against the output
 * rather than the input: 438 sockets came back inside it, 59.73–65.50° on flat
 * hosts and 61.91–64.57° on the 78 arc sockets, which is the measurement that
 * justifies `Mount.normal` existing at all — read off `faceVector(face)` instead,
 * the same arc sockets span 62–81°.
 */
const SOCKET_ANGLE_DEG = { min: 58, max: 68 } as const

/**
 * How far below the host's bbox top each `component|torch|{low,mid,high}` band
 * seats its socket, in millimetres, over the 339 sockets on banded hosts.
 *
 * Measured over the whole corpus (113 sockets per band). The 40-host spike that
 * shaped this row read 23.5 / 16.9 / 10.3 from a sample; `low` and `mid` hold to
 * within a millimetre, and **`high` does not** — the full corpus puts it at 6.85
 * mm below the top, 3.4 mm above the sample's figure, because the sample drew
 * disproportionately from the taller `arc` hosts (high/arc 7.72, high/wall 6.52).
 * The corpus is the authority, so these are the corpus's numbers.
 */
const BAND_BELOW_TOP_MM = { low: 24.52, mid: 16.17, high: 6.85 } as const

/** How far a band mean may move before the seating convention has changed. */
const BAND_TOLERANCE_MM = 3

/**
 * A single-leaf doorway's clear width. The schema's docblock quotes a nominal
 * 25 mm opening for a 27–28 mm slab; measured, the 84 openings on hosts whose
 * `door` slot requires `size|single` run 23.00–25.00 mm.
 */
const SINGLE_DOOR_WIDTH_MM = { min: 22, max: 28 } as const

/**
 * How far off the run's centre a straight wall's torch socket may sit.
 *
 * 147 single-socket `wall`-footprint torch hosts, of lengths 1, 1.5, 2 and 3:
 * worst |at[0]| is 0.267 mm. The **30 four-unit walls are excluded and asserted
 * separately** — they are `wall`-footprint too, not `rect`, and they carry *two*
 * sockets at ±25.1–25.6 mm, one over each half of the run.
 */
const CENTRED_TOLERANCE_MM = 0.5

/** The 12 torch hosts with no socket, by the filename shape they all share. */
const SOCKETLESS_PILLARS = [
  { pattern: 'dungeon_stone%block#full_pillar+round', count: 10 },
  { pattern: 'cut-stone#full_pillar+square+torch+', count: 2 },
] as const

/** `torch.stl` — the 7 × 7 × 12 mm peg 354 of the corpus's torch slots take. */
const TORCH_BLOB = 'f08add117e7e3161d69fd73c97211fc7'

/** The one fixture whose doorway is sculpted into the solid rather than cut. */
const MODELLED_IN_DOOR = 'dungeon_stone%eroded#wall,door+rectangular+narrow.A.openforge,side.stl'

/* -------------------------------------------------------------------- vectors */

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0)
}

function length(a: readonly number[]): number {
  return Math.hypot(a[0] ?? 0, a[1] ?? 0, a[2] ?? 0)
}

/** The tilt of a socket's entry axis off the inward surface normal, in degrees. */
function entryAngle(axis: readonly number[], normal: readonly number[]): number {
  const inward = normal.map((component) => -component)
  return (Math.acos(Math.min(1, Math.max(-1, dot(axis, inward)))) * 180) / Math.PI
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length
}

describeCorpus(
  runnable
    ? 'the measured mount inventory against the live archive'
    : `the measured mount inventory — SKIPPED, no ${CATALOG} or no measurement ` +
        '(run `npm run import:catalog`, then `npm run mounts`, then `npm run mounts -- --inventory`)',
  () => {
    /* Non-null by `runnable`; vitest still constructs a skipped block's body. */
    const inv = inventory as MountInventory
    const file = CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))

    /* ------------------------------------------------------------- the join */

    const rowsByBlob = new Map<string, CatalogRecord[]>()
    for (const record of file.records) {
      const rows = rowsByBlob.get(record.blob) ?? []
      rows.push(record)
      rowsByBlob.set(record.blob, rows)
    }
    const rowsOf = (blob: string): readonly CatalogRecord[] => rowsByBlob.get(blob) ?? []

    /** Every non-joinery slot name any row sharing this blob declares. */
    const slotsOf = (blob: string): ReadonlySet<string> =>
      new Set(
        rowsOf(blob).flatMap((record) =>
          (record.config?.parts ?? []).filter((part) => part.name !== 'base').map((part) => part.name),
        ),
      )

    /** Every tag any row sharing this blob carries, spelled out. */
    const tagsOf = (blob: string): ReadonlySet<string> =>
      new Set(rowsOf(blob).flatMap((record) => record.tags.map((id) => file.tags[id] ?? '')))

    /** A blob's filename — the last path segment of its lowest-ordinal row. */
    const nameOf = (blob: string): string => {
      const id = [...rowsOf(blob)].sort((a, b) => a.ord - b.ord)[0]?.id ?? blob
      return id.slice(id.lastIndexOf('/') + 1)
    }

    const hosts: readonly (readonly [string, HostMeasurement])[] = Object.entries(inv.hosts)
    const sockets = hosts.flatMap(([blob, host]) =>
      host.mounts.filter((mount) => mount.kind === 'socket').map((mount) => ({ blob, host, mount })),
    )

    /* ----------------------------------------------------------- the totals */

    it('holds the run the README, the spec and the facts script quote', () => {
      expect(inv.counted).toEqual(COUNTED)
      expect(Object.keys(inv.hosts)).toHaveLength(COUNTED.hosts)
      expect(Object.keys(inv.inserts)).toHaveLength(COUNTED.inserts)
      expect(hosts.reduce((total, [, host]) => total + host.mounts.length, 0)).toBe(COUNTED.mounts)
      expect(inv.catalog.fixtures).toBe(file.version.fixtures)
    })

    /* ------------------------------------------------------------- coverage */

    it('gives every torch host a socket, save the 12 full pillars', () => {
      const torchHosts = hosts.filter(([blob]) => slotsOf(blob).has('torch'))
      expect(torchHosts.length).toBe(356)

      const missing = torchHosts
        .filter(([, host]) => !host.mounts.some((mount) => mount.kind === 'socket'))
        .map(([blob]) => nameOf(blob))

      for (const { pattern, count } of SOCKETLESS_PILLARS) {
        expect(missing.filter((name) => name.includes(pattern)), pattern).toHaveLength(count)
      }
      /* Every miss is one of the two named shapes, and there are no others. */
      expect(missing).toHaveLength(SOCKETLESS_PILLARS.reduce((total, entry) => total + entry.count, 0))
      expect(missing.filter((name) => !SOCKETLESS_PILLARS.some(({ pattern }) => name.includes(pattern)))).toEqual([])
    })

    it('records why a slot resolved to nothing, including the fixture error', () => {
      const [blob] = [...rowsByBlob].find(([, rows]) => rows.some((row) => row.id.endsWith(MODELLED_IN_DOOR))) ?? []
      expect(blob, MODELLED_IN_DOOR).toBeDefined()
      const unresolved = inv.hosts[blob ?? '']?.unresolved ?? []
      expect(unresolved).toContainEqual({ slot: 'door', reason: 'modelled-in' })
    })

    /* -------------------------------------------------------- the socket rule */

    it('enters every socket at the Dupont angle, on flat hosts and on arcs alike', () => {
      expect(sockets).toHaveLength(438)
      for (const { blob, mount } of sockets) {
        if (mount.kind !== 'socket') continue
        const angle = entryAngle(mount.axis, mount.normal)
        expect(angle, `${nameOf(blob)} ${String(mount.face)}`).toBeGreaterThanOrEqual(SOCKET_ANGLE_DEG.min)
        expect(angle, `${nameOf(blob)} ${String(mount.face)}`).toBeLessThanOrEqual(SOCKET_ANGLE_DEG.max)
      }
      /* The arcs are the point: they are re-rolled, and they stay in band.
         Pinned at 78 rather than `> 0`, because a re-roll that silently stopped
         producing arc sockets would leave the band assertion above testing only
         the flat hosts it was never in doubt on. */
      expect(sockets.filter(({ host }) => host.arc !== undefined)).toHaveLength(78)
    })

    it('centres a straight wall’s torch on its run, and halves a four-unit wall', () => {
      const wallTorch = hosts.filter(
        ([blob]) => slotsOf(blob).has('torch') && rowsOf(blob)[0]?.foot.shape === 'wall',
      )
      const single = wallTorch.filter(
        ([, host]) => host.mounts.filter((mount) => mount.kind === 'socket').length === 1,
      )
      const paired = wallTorch.filter(
        ([, host]) => host.mounts.filter((mount) => mount.kind === 'socket').length === 2,
      )
      expect(single).toHaveLength(147)
      expect(paired).toHaveLength(30)
      /* One or two, and nothing else: a wall torch host with zero or three
         sockets would otherwise fall out of both buckets untested. */
      expect(single.length + paired.length).toBe(wallTorch.length)

      for (const [blob, host] of single) {
        for (const mount of host.mounts) {
          if (mount.kind !== 'socket') continue
          expect(Math.abs(mount.at[0]), nameOf(blob)).toBeLessThanOrEqual(CENTRED_TOLERANCE_MM)
        }
      }
      /* The 4-unit walls are the exception and are asserted as one, not skipped:
         two sockets, symmetric about the centre, a quarter of the run out. */
      for (const [blob, host] of paired) {
        const xs = host.mounts.filter((mount) => mount.kind === 'socket').map((mount) => mount.at[0])
        expect(rowsOf(blob)[0]?.foot, nameOf(blob)).toMatchObject({ shape: 'wall', length: 4 })
        for (const x of xs) expect(Math.abs(x), nameOf(blob)).toBeGreaterThan(20)
        expect(Math.abs((xs[0] ?? 0) + (xs[1] ?? 0)), nameOf(blob)).toBeLessThan(1)
      }
    })

    it('seats the three torch bands in order, at the heights they were measured at', () => {
      const bands = { low: [] as number[], mid: [] as number[], high: [] as number[] }
      const heights = { low: [] as number[], mid: [] as number[], high: [] as number[] }
      for (const { blob, host, mount } of sockets) {
        if (mount.kind !== 'socket') continue
        const tags = tagsOf(blob)
        const band = (['low', 'mid', 'high'] as const).find((name) => tags.has(`component|torch|${name}`))
        if (band === undefined) continue
        bands[band].push(host.bbox.max[2] - host.bbox.min[2] - mount.at[2])
        heights[band].push(mount.at[2])
      }
      for (const band of ['low', 'mid', 'high'] as const) {
        expect(bands[band], band).toHaveLength(113)
        expect(Math.abs(mean(bands[band]) - BAND_BELOW_TOP_MM[band]), band).toBeLessThanOrEqual(BAND_TOLERANCE_MM)
      }
      /* The names mean what they say: low sits lowest off the floor. */
      expect(mean(heights.low)).toBeLessThan(mean(heights.mid))
      expect(mean(heights.mid)).toBeLessThan(mean(heights.high))
    })

    /* ------------------------------------------------------------- openings */

    it('cuts a single-leaf doorway to one leaf’s width', () => {
      const widths = hosts.flatMap(([blob, host]) => {
        const single = rowsOf(blob).some((record) =>
          (record.config?.parts ?? []).some(
            (part) =>
              part.name === 'door' && (part.tags.require ?? []).some((ref) => ref.tag === 'size|single'),
          ),
        )
        if (!single) return []
        return host.mounts
          .filter((mount) => mount.kind === 'opening' && mount.slot === 'door')
          .map((mount) => ({ name: nameOf(blob), width: mount.kind === 'opening' ? mount.width : 0 }))
      })
      expect(widths).toHaveLength(84)
      for (const { name, width } of widths) {
        expect(width, name).toBeGreaterThanOrEqual(SINGLE_DOOR_WIDTH_MM.min)
        expect(width, name).toBeLessThanOrEqual(SINGLE_DOOR_WIDTH_MM.max)
      }
    })

    /**
     * An `openTop` opening's `head` is the **host's own top face**, and that is
     * what a lintel is seated against.
     *
     * The measured convention: a rectangular door wall carries a ~33 mm notch
     * that runs up through the silhouette, so `findOpenings` finds no soffit and
     * reports the top line — which is the wall's top. A consumer seating a
     * lintel's *bottom* there puts it a lintel's thickness above the wall, which
     * is `place.ts#openingRise`'s subject and was the visible fault. Asserted
     * against the bbox, which only this file and the inventory can see.
     */
    it('reads an open-topped opening s head as the top of the host', () => {
      const openTops = hosts.flatMap(([blob, host]) =>
        host.mounts
          .filter((mount) => mount.kind === 'opening' && mount.openTop)
          .map((mount) => ({ name: nameOf(blob), host, mount })),
      )
      expect(openTops.length).toBeGreaterThan(0)
      for (const { name, host, mount } of openTops) {
        if (mount.kind !== 'opening') continue
        const top = host.bbox.max[2] - host.bbox.min[2]
        expect(Math.abs(mount.head - top), `${name} ${mount.slot}`).toBeLessThan(0.5)
      }
    })

    /* ------------------------------------------------------ the orientations */

    it('gives every mount a unit outward normal', () => {
      for (const [blob, host] of hosts) {
        for (const mount of host.mounts) {
          expect(length(mount.normal), `${nameOf(blob)} ${mount.slot}`).toBeCloseTo(1, 6)
        }
      }
    })

    /**
     * The four anchor kinds, counted — `plate` before `peg`, minus end caps.
     *
     * `analyseInsert` tries the plate rule first, and `torch_plate.stl` is why:
     * it was a `peg` anchored on the end of its long axis and is now a `plate`
     * on the flat back it presses against the wall. But the plate rule must not
     * take a face **across** a peg's long axis, and `torch.stl` is why: its flat
     * 7 × 7 base is the head of the torch, not a face it lies against anything,
     * and a plate anchored there hung all 354 torch slots upside down. So the
     * three pegs are `torch.stl` — anchored at its 3 mm tip — and the two
     * `brazier+small` blobs, and the six plates are `torch_plate.stl`,
     * `brazier+large,base.stl`, three `cave%sandstone+3#wall,slope` tops and
     * `catacombs#wall,loculus…`, whose flat face is across its longest axis but
     * whose section is far too oblong to be a peg at all.
     */
    it('counts the four anchor kinds the plate-first order produces', () => {
      const kinds = { leaf: 0, block: 0, plate: 0, peg: 0 }
      for (const insert of Object.values(inv.inserts)) kinds[insert.anchor.kind] += 1
      expect(kinds).toEqual({ leaf: 117, block: 13, plate: 6, peg: 3 })
    })

    /**
     * The torch, anchored at the end that fits the mouth.
     *
     * The socket is a 5.5 × 3 mm slot and the torch tapers from a 7 × 7 mm
     * flange at `z = 0` to ~3 mm at `z = 12`, so the tip is the only end of it
     * that goes in — and `at` is in the insert's own bbox frame, whose `z` runs
     * from the box's bottom, which puts the anchor at the top of the box. The
     * axis then runs back down through the body, so the renderer aims that at
     * the direction out of the wall and the flange ends up uppermost, as it does
     * on the printed piece.
     */
    it('anchors the torch peg at its narrow end', () => {
      const torch = inv.inserts[TORCH_BLOB]
      expect(torch?.anchor.kind).toBe('peg')
      expect(torch?.anchor.size).toEqual([7, 7, 12])
      expect(torch?.anchor.at[2]).toBeCloseTo(12, 6)
      expect(torch?.anchor.axis).toEqual([0, 0, -1])
    })

    /**
     * What the *index* carries, which is the number the app actually reads.
     *
     * The inventory is blob-keyed and the catalog is row-keyed, so these are not
     * the 995 and 139 above: 171 md5s are shared by 520 rows. Pinned because the
     * join is the step where a measurement can be silently dropped — an empty
     * inventory, a fixture-hash mismatch, a record whose blob moved — and every
     * one of those failures looks like a smaller number here and like nothing at
     * all anywhere else.
     */
    it('joins the measurement onto every row the archive shares a blob with', () => {
      const withMounts = file.records.filter((record) => record.mounts !== undefined)
      const withAnchor = file.records.filter((record) => record.anchor !== undefined)
      expect(withMounts).toHaveLength(972)
      expect(withAnchor).toHaveLength(285)
      /* Every joined row's measurement is the one the inventory holds for its
         own blob — the join is a lookup and nothing else. */
      for (const record of withAnchor) {
        expect(record.anchor, record.id).toEqual(inv.inserts[record.blob]?.anchor)
      }
      for (const record of withMounts) {
        expect(record.mounts, record.id).toEqual(inv.hosts[record.blob]?.mounts)
      }
    })

    it('anchors every insert on a unit axis, sized to its own box', () => {
      for (const [blob, insert] of Object.entries(inv.inserts)) {
        expect(length(insert.anchor.axis), nameOf(blob)).toBeCloseTo(1, 6)
        /* `size` is the insert's own bounding box, not a nominal or a clamped
           one: all 139 match their `bbox` extent exactly, so the consumer that
           scales a leaf to its opening can read either and get the same mesh. */
        const extent = [0, 1, 2].map((axis) => (insert.bbox.max[axis] ?? 0) - (insert.bbox.min[axis] ?? 0))
        expect(insert.anchor.size, nameOf(blob)).toEqual(extent)
        for (const side of extent) expect(side, nameOf(blob)).toBeGreaterThan(0)
      }
    })
  },
)

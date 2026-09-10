/**
 * The mount inventory reader, the committed shell, and the join into the record.
 *
 * Three kinds of case, and they are the three ways this join can go wrong.
 *
 * The **reader's refusals** come first, and they are `thumbs.ts`'s refusals for
 * the same reason: an inventory this pipeline half-understands emits *no* mount
 * on records whose hosts were measured, and "this wall has no torch socket" and
 * "nobody measured this wall" are the two states the whole tool exists to
 * distinguish. A silent empty read looks exactly like a corpus of unmeasured
 * meshes, which is the state the repository is in today — so it would look
 * correct.
 *
 * The **join** is keyed on the blob, not on the record, and that is the second
 * failure mode: 171 md5 values are shared by 520 catalog rows, so a join keyed
 * on `id` would measure one wall and light up one of the five records that are
 * that wall.
 *
 * The **empty build** is the third. `mounts` and `anchor` are optional, so an
 * empty inventory has to leave the emitted `{tags, records}` byte-identical —
 * otherwise this row moves 8,702 records for a measurement nobody has taken yet,
 * and `tools/stamp/lock.ts` would be right to fail it.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { InsertAnchor, Mount } from '../src/catalog'
import { CatalogRecord, SCHEMA_VERSION } from '../src/catalog'
import type { HostMeasurement, InsertMeasurement } from '../tools/mounts/classify'
import { readLock } from '../tools/stamp/lock'

import { buildCatalog } from './build'
import type { FixtureRow } from './fixtures'
import { fixturesDir, loadFixtureRows } from './fixtures'
import type { MountInventory } from './mounts'
import {
  MOUNT_INVENTORY_PATH,
  MOUNT_INVENTORY_VERSION,
  MountInventory as MountInventorySchema,
  emptyMountInventory,
  readMountInventory,
  serialiseMountInventory,
} from './mounts'
import { emptyManifest } from './ordinals'

/* ------------------------------------------------------- the two schemas agree */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

/**
 * The measurement `tools/mounts/` produces and the one the inventory declares
 * are the **same type**, checked in both directions.
 *
 * `sidecar.ts` writes `classify.ts`'s measurements into a `MountInventory`, so
 * one direction is already a compile error there. This pins the other: a field
 * the Zod schema declares and the tool never writes would parse a file nobody
 * can produce, and the parse would be the only thing that knew.
 */
export type _HostsMatch = Assert<Exact<MountInventory['hosts'][string], HostMeasurement>>
export type _InsertsMatch = Assert<Exact<MountInventory['inserts'][string], InsertMeasurement>>

/* --------------------------------------------------------------------- sample */

const HOST_BLOB = `${'a'.repeat(31)}1`
const INSERT_BLOB = `${'b'.repeat(31)}2`
const PLAIN_BLOB = `${'c'.repeat(31)}3`

/** The measured torch socket: 5.5 × 3 mm, 65° from the face normal, on `-y`. */
const SOCKET: Mount = {
  slot: 'torch',
  kind: 'socket',
  face: '-y',
  at: [0, -6.35, 38.1],
  axis: [0, -0.4226, 0.9063],
  section: [5.5, 3],
  depth: 14,
}

/** The torch's own peg, in the accessory's frame: a 7 × 7 × 12 mm plug. */
const ANCHOR: InsertAnchor = { kind: 'peg', at: [0, 0, 0], axis: [0, 0, 1], size: [7, 7, 12] }

const HOST: HostMeasurement = {
  bbox: { min: [-12.7, -6.35, 0], max: [12.7, 6.35, 50.8] },
  mounts: [SOCKET],
  unresolved: [{ slot: 'lintel', reason: 'no-opening' }],
}

const INSERT: InsertMeasurement = { bbox: { min: [-3.5, -3.5, 0], max: [3.5, 3.5, 12] }, anchor: ANCHOR }

function anInventory(over: Partial<MountInventory> = {}): MountInventory {
  return {
    note: 'test',
    version: MOUNT_INVENTORY_VERSION,
    measured: '2026-09-09T00:00:00.000Z',
    catalog: { fixtures: 'abc123def456' },
    tool: 'openforge-workshop-mounts',
    hosts: { [HOST_BLOB]: HOST },
    inserts: { [INSERT_BLOB]: INSERT },
    counted: { hosts: 1, inserts: 1, failed: 0, mounts: 1 },
    ...over,
  }
}

function written(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'of-mounts-'))
  const path = join(dir, 'inventory.json')
  writeFileSync(path, JSON.stringify(body))
  return path
}

/* ------------------------------------------------------------------- the rows */

function aRow(name: string, md5: string, tags: readonly string[] = []): FixtureRow {
  const id = `tiles/cave/wall/openlock/cave%${name}.A.openlock.stl`
  return {
    tags: ['shape|wall', 'shape|wall|straight', 'texture|cave', 'size|width|1', 'connection|openlock', ...tags],
    file_metadata: { file: `cave%${name}.A.openlock.stl`, full_name: id, md5, size: 1_000 },
    images: [{ image_url: 'https://objects.example.test/sprites/x.png' }],
  }
}

/** Two rows over the *same* mesh, plus one over another — the sharing the join is keyed for. */
const ROWS: readonly FixtureRow[] = [
  aRow('wall+torch', HOST_BLOB),
  aRow('wall+torch,mirrored', HOST_BLOB),
  aRow('torch', INSERT_BLOB),
  aRow('wall+plain', PLAIN_BLOB),
]

function built(mounts: MountInventory, rows: readonly FixtureRow[] = ROWS): ReturnType<typeof buildCatalog> {
  return buildCatalog({
    rows,
    manifest: emptyManifest(),
    fixturesRef: 'test',
    builtAt: '2026-01-01T00:00:00.000Z',
    thumbs: new Set(),
    mounts,
  })
}

/* ------------------------------------------------------------------- the tests */

describe('readMountInventory', () => {
  it('reads a measurement run', () => {
    const inventory = readMountInventory(written(anInventory()))

    expect(inventory?.hosts[HOST_BLOB]?.mounts).toEqual([SOCKET])
    expect(inventory?.inserts[INSERT_BLOB]?.anchor).toEqual(ANCHOR)
    expect(inventory?.counted).toEqual({ hosts: 1, inserts: 1, failed: 0, mounts: 1 })
  })

  it('treats an absent file as "nothing measured", because a fresh clone has not run the tool', () => {
    expect(readMountInventory(join(tmpdir(), 'of-mounts-nothing-here', 'inventory.json'))).toBeUndefined()
  })

  it('refuses a version it does not understand, naming the command that rewrites the file', () => {
    expect(() => readMountInventory(written(anInventory({ version: MOUNT_INVENTORY_VERSION + 1 })))).toThrow(
      /npm run mounts -- --inventory/,
    )
  })

  it('refuses an inventory holding measurement failures, because unmeasured is not unmounted', () => {
    expect(() =>
      readMountInventory(written(anInventory({ counted: { hosts: 1, inserts: 1, failed: 2, mounts: 1 } }))),
    ).toThrow(/2 blobs/)
  })

  it('refuses a key that is not an md5, rather than emitting mounts keyed on nonsense', () => {
    expect(() => readMountInventory(written(anInventory({ hosts: { 'not-an-md5': HOST } })))).toThrow()
  })

  it('refuses a mount whose kind it has no case for', () => {
    const hosts = { [HOST_BLOB]: { ...HOST, mounts: [{ ...SOCKET, kind: 'wormhole' }] } }
    expect(() => readMountInventory(written(anInventory({ hosts: hosts as never })))).toThrow()
  })
})

describe('emptyMountInventory', () => {
  it('parses as an inventory, so the "nothing measured" case travels the same path', () => {
    expect(() => MountInventorySchema.parse(emptyMountInventory())).not.toThrow()
    expect(emptyMountInventory().counted).toEqual({ hosts: 0, inserts: 0, failed: 0, mounts: 0 })
  })
})

describe('the committed inventory', () => {
  it('is on disk, parses, and is still the empty shell', () => {
    expect(existsSync(MOUNT_INVENTORY_PATH)).toBe(true)
    const inventory = readMountInventory()
    expect(inventory).toEqual(emptyMountInventory())
  })

  it('holds exactly the bytes the serialiser writes, so a run diffs and nothing else does', () => {
    expect(readFileSync(MOUNT_INVENTORY_PATH, 'utf8')).toBe(serialiseMountInventory(emptyMountInventory()))
  })
})

describe('serialiseMountInventory', () => {
  it('indents the header by two and keeps one host and one insert per line', () => {
    const text = serialiseMountInventory(anInventory())

    expect(text).toContain('\n  "version": 1,')
    expect(text).toContain(`\n    ${JSON.stringify(HOST_BLOB)}: {"bbox"`)
    expect(text).toContain(`\n    ${JSON.stringify(INSERT_BLOB)}: {"bbox"`)
    // One line per entry is the whole point: a 1,000-host inventory has to stay
    // a diff a reviewer can read, and pretty-printing every `at` triple makes it
    // twenty thousand lines of numbers.
    expect(text.split('\n').filter((line) => /^ {4}"[0-9a-f]{32}"/.test(line))).toHaveLength(2)
    expect(text.endsWith('}\n')).toBe(true)
  })

  it('round-trips, so the artefact the tool writes is the artefact the build reads', () => {
    expect(MountInventorySchema.parse(JSON.parse(serialiseMountInventory(anInventory())))).toEqual(anInventory())
  })

  it('writes the empty inventory without collapsing its keys', () => {
    const text = serialiseMountInventory(emptyMountInventory())

    expect(text).toContain('"hosts": {},')
    expect(text).toContain('"inserts": {},')
  })
})

describe('the join into the record', () => {
  it('is 5, because the record gained two optional fields', () => {
    expect(SCHEMA_VERSION).toBe(5)
  })

  it('gives every record over a measured host the same mounts, and nothing to the rest', () => {
    const { file } = built(anInventory())
    const byId = new Map(file.records.map((record) => [record.file, record]))

    expect(byId.get('cave%wall+torch.A.openlock.stl')?.mounts).toEqual([SOCKET])
    expect(byId.get('cave%wall+torch,mirrored.A.openlock.stl')?.mounts).toEqual([SOCKET])
    expect(byId.get('cave%wall+plain.A.openlock.stl')?.mounts).toBeUndefined()
  })

  it('gives an insert its anchor, and gives a host none', () => {
    const { file } = built(anInventory())
    const byId = new Map(file.records.map((record) => [record.file, record]))

    expect(byId.get('cave%torch.A.openlock.stl')?.anchor).toEqual(ANCHOR)
    expect(byId.get('cave%wall+torch.A.openlock.stl')?.anchor).toBeUndefined()
  })

  it('emits records that parse, mounts and all', () => {
    const { file } = built(anInventory())
    const mounted = file.records.find((record) => record.mounts !== undefined)

    expect(mounted).toBeDefined()
    expect(() => CatalogRecord.parse(mounted)).not.toThrow()
  })

  it('counts what it joined, because a stale inventory is only visible as a number', () => {
    const { stats } = built(anInventory())

    expect(stats.withMounts).toBe(2)
    expect(stats.withAnchor).toBe(1)
  })

  it('lints a live host once per unresolved slot, naming the file and the reason', () => {
    // Once per *blob*, not once per row: the two rows share the mesh, and two
    // identical lines would read as two defects.
    expect(built(anInventory()).stats.mountLint).toEqual([
      // `full_name` order, and `,` sorts before `.`, so the mirror is first.
      'mounts: cave%wall+torch,mirrored.A.openlock.stl — slot lintel no-opening',
    ])
  })

  it('says nothing about a host no live row carries', () => {
    const hosts = { [`${'d'.repeat(31)}4`]: HOST }
    expect(built(anInventory({ hosts, counted: { hosts: 1, inserts: 0, failed: 0, mounts: 1 } })).stats.mountLint)
      .toEqual([])
  })

  it('emits neither key for an empty inventory', () => {
    const { file, stats } = built(emptyMountInventory())

    expect(JSON.stringify(file.records)).not.toContain('"mounts"')
    expect(JSON.stringify(file.records)).not.toContain('"anchor"')
    expect([stats.withMounts, stats.withAnchor]).toEqual([0, 0])
  })
})

/* ------------------------------------------------- the payload has not moved */

const FIXTURES_DIR = fixturesDir()
const hasFixtures = existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))
const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'the empty inventory over the real corpus'
  : `the empty inventory over the real corpus — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

describeCorpus(title, () => {
  it(
    'leaves the emitted {tags, records} byte-identical to the locked derivation',
    () => {
      // `PIPELINE_VERSION` stays 3 through this row, and this is the claim that
      // entitles it to: `mounts` and `anchor` are optional, so a build that has
      // measured nothing emits the same bytes it emitted before the fields
      // existed. `tools/stamp/lock.ts` states the same biconditional; this
      // asserts the half that belongs to this file.
      const rows: FixtureRow[] = loadFixtureRows(FIXTURES_DIR)
      const { file } = buildCatalog({
        rows,
        manifest: emptyManifest(),
        fixturesRef: 'derivation-lock',
        builtAt: '2026-01-01T00:00:00.000Z',
        thumbs: new Set(),
        mounts: emptyMountInventory(),
      })
      const content = createHash('sha256')
        .update(JSON.stringify({ tags: file.tags, records: file.records }))
        .digest('hex')

      expect(content).toBe(readLock().content)
    },
    120_000,
  )
})

/**
 * The log's contract, and the inventory built from it.
 *
 * The log *is* the resume state, so the tests that matter are the ones about
 * what happens to it when a run is killed: a half-written final line must cost
 * one re-read and nothing else, and a retried failure must be superseded by the
 * success that follows it rather than shadowing it for ever.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BlobId, TileId } from '../../src/catalog'

import type { MountTarget } from './catalog'
import type { HostMeasurement, InsertMeasurement } from './classify'
import type { LogEntry, MeasuredEntry } from './sidecar'
import { appendEntry, buildInventory, readLog, serialise, stratifiedSample } from './sidecar'

function temp(): string {
  return mkdtempSync(join(tmpdir(), 'openforge-mounts-'))
}

const HOST: HostMeasurement = {
  bbox: { min: [0, 0, 0], max: [50.8, 6.35, 50.8] },
  mounts: [{ slot: 'door', kind: 'surface', face: '+z', at: [0.5, 0.5, 1] }],
  unresolved: [{ slot: 'window', reason: 'no-opening' }],
}

const INSERT: InsertMeasurement = {
  bbox: { min: [0, 0, 0], max: [25.4, 3, 38.1] },
  anchor: { kind: 'leaf', at: [0.5, 0, 0], axis: [0, 1, 0], size: [25.4, 3, 38.1] },
}

const READ = { bytes: 6_000_000, triangles: 12_000, seconds: 1.5 } as const

function hostEntry(blob: string): MeasuredEntry {
  return { blob, kind: 'host', status: 'measured', ...READ, host: HOST }
}

function insertEntry(blob: string): MeasuredEntry {
  return { blob, kind: 'insert', status: 'measured', ...READ, insert: INSERT }
}

/** A blob that is both — one read, both measurements. See `catalog.ts`. */
function bothEntry(blob: string): MeasuredEntry {
  return { blob, kind: 'host', status: 'measured', ...READ, host: HOST, insert: INSERT }
}

describe('appendEntry and readLog', () => {
  it('round-trips an entry through the log, keyed by md5', () => {
    const path = join(temp(), 'mounts.jsonl')
    const entry = hostEntry('a'.repeat(32))
    appendEntry(path, entry)

    expect([...readLog(path).entries()]).toEqual([['a'.repeat(32), entry]])
  })

  it('is an empty map when the log does not exist yet', () => {
    expect(readLog(join(temp(), 'absent.jsonl')).size).toBe(0)
  })

  it('drops a truncated final line instead of throwing, so the mesh is re-read', () => {
    const path = join(temp(), 'mounts.jsonl')
    const good = hostEntry('b'.repeat(32))
    appendEntry(path, good)
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"blob":"cccc","kind":"host","stat`, 'utf8')

    expect([...readLog(path).keys()]).toEqual(['b'.repeat(32)])
  })

  it('lets a later line for the same blob win, so a retried failure is superseded', () => {
    const path = join(temp(), 'mounts.jsonl')
    const blob = 'd'.repeat(32)
    appendEntry(path, { blob, kind: 'host', status: 'failed', reason: 'HTTP 503' })
    appendEntry(path, hostEntry(blob))

    expect(readLog(path).get(blob)?.status).toBe('measured')
  })
})

describe('buildInventory', () => {
  const entries: readonly LogEntry[] = [
    hostEntry('b'.repeat(32)),
    insertEntry('a'.repeat(32)),
    bothEntry('c'.repeat(32)),
    { blob: 'e'.repeat(32), kind: 'host', status: 'failed', reason: 'HTTP 404' },
  ]
  const stamp = { fixtures: 'abc123def456', measured: '2026-09-09T00:00:00.000Z' }

  it('files each measurement under its md5 and counts what it holds', () => {
    const inventory = buildInventory(entries, stamp)

    expect(Object.keys(inventory.hosts)).toEqual(['b'.repeat(32), 'c'.repeat(32)])
    expect(Object.keys(inventory.inserts)).toEqual(['a'.repeat(32), 'c'.repeat(32)])
    expect(inventory.counted).toEqual({ hosts: 2, inserts: 2, failed: 1, mounts: 2 })
    expect(inventory.hosts['b'.repeat(32)]).toEqual(HOST)
    expect(inventory.inserts['a'.repeat(32)]).toEqual(INSERT)
  })

  it('stamps the index it was measured against and names the tool', () => {
    const inventory = buildInventory(entries, stamp)

    expect(inventory.version).toBe(1)
    expect(inventory.tool).toBe('openforge-workshop-mounts')
    expect(inventory.catalog).toEqual({ fixtures: 'abc123def456' })
    expect(inventory.measured).toBe('2026-09-09T00:00:00.000Z')
    expect(inventory.note).toMatch(/\S/)
  })

  it('serialises to 2-space JSON with a trailing newline', () => {
    const text = serialise(buildInventory(entries, stamp))

    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "version": 1,')
    expect(JSON.parse(text)).toEqual(buildInventory(entries, stamp))
  })
})

describe('stratifiedSample', () => {
  function target(ord: number, family: string, slot: string, w: number): MountTarget {
    const seed = String(ord).padStart(32, '0')
    return {
      kind: 'host',
      blob: BlobId.parse(seed),
      ord,
      bytes: 1000,
      ids: [TileId.parse(`tiles/${family}/${seed}.stl`)],
      family,
      foot: { shape: 'rect', w, d: 2 },
      slots: [{ name: slot, require: [] }],
    }
  }

  /** Four strata: the door/walls/2x2 bucket holds three, the others one each. */
  const targets: readonly MountTarget[] = [
    target(1, 'walls', 'door', 2),
    target(2, 'walls', 'door', 2),
    target(3, 'walls', 'door', 2),
    target(4, 'walls', 'window', 2),
    target(5, 'floors', 'door', 2),
    target(6, 'walls', 'door', 4),
  ]

  it('takes one target from every bucket before it takes a second from any', () => {
    expect(stratifiedSample(targets, 4).map((t) => t.ord)).toEqual([1, 4, 5, 6])
  })

  it('fills the remainder in manifest order once every bucket is covered', () => {
    expect(stratifiedSample(targets, 5).map((t) => t.ord)).toEqual([1, 4, 5, 6, 2])
  })

  it('returns everything when the sample is at least the population', () => {
    expect(stratifiedSample(targets, 9)).toHaveLength(targets.length)
  })
})

/**
 * Trap 1, guarded.
 *
 * The swap between `connections()` and `curved_connections()` is an upstream slip
 * that cannot be inferred from a filename, so the only thing standing between a
 * future reader and a wrong mapping is this table — and the only thing standing
 * between the table and a well-meaning "simplification" is this file.
 */
import { describe, expect, it } from 'vitest'

import { LOCK_TABLE, LOCK_VALUES, labelsFor, lockRow, swappedLabels } from './locks'

describe('the lock table', () => {
  it('maps the square "openlock" label to -D LOCK="triplex"', () => {
    expect(lockRow('openlock', 'square').lock).toBe('triplex')
  })

  it('maps the curved "openlock" label to -D LOCK="openlock"', () => {
    expect(lockRow('openlock', 'curved').lock).toBe('openlock')
  })

  it('mirrors "openlock+unsupported" between the two families', () => {
    expect(lockRow('openlock+unsupported', 'square').lock).toBe('openlock')
    expect(lockRow('openlock+unsupported', 'curved').lock).toBe('triplex')
  })

  it('is a swap, not a rename: the two labels exchange values across families', () => {
    const square = [lockRow('openlock', 'square').lock, lockRow('openlock+unsupported', 'square').lock]
    const curved = [lockRow('openlock', 'curved').lock, lockRow('openlock+unsupported', 'curved').lock]
    expect(curved).toEqual([square[1], square[0]])
  })

  it('carries SUPPORTS="false" on both unsupported rows', () => {
    expect(lockRow('openlock+unsupported', 'square').supports).toBe('false')
    expect(lockRow('openlock+unsupported', 'curved').supports).toBe('false')
  })

  it('never lets a label fall through to itself as a -D value', () => {
    expect(() => lockRow('openlock+flex', 'square')).toThrow(/no lock row/)
    expect(() => lockRow('openlock', 'hex' as 'square')).toThrow(/no lock row/)
  })

  it('names PROVENANCE trap 1 in the refusal, so the reason survives the stack trace', () => {
    expect(() => lockRow('nope', 'square')).toThrow(/not the -D LOCK value/)
  })

  it('only uses the five values the customizer enum offers', () => {
    for (const row of LOCK_TABLE) expect(LOCK_VALUES).toContain(row.lock)
  })

  it('has no duplicate family+label pairs, so lockRow is deterministic', () => {
    const keys = LOCK_TABLE.map((row) => `${row.family}:${row.label}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('marks the two swapped labels as documented rather than inferred', () => {
    const documented = LOCK_TABLE.filter((row) => row.confidence === 'documented').map((row) => row.label)
    expect(new Set(documented)).toEqual(new Set(['openlock', 'openlock+unsupported']))
  })
})

describe('reading the table backwards', () => {
  it('reports both labels that mean -D LOCK="triplex"', () => {
    expect(labelsFor('triplex')).toContain('square:openlock')
    expect(labelsFor('triplex')).toContain('curved:openlock+unsupported')
  })

  it('summarises the ambiguity for the report header', () => {
    expect(swappedLabels()).toEqual([
      { label: 'openlock', square: 'triplex', curved: 'openlock' },
      { label: 'openlock+unsupported', square: 'openlock', curved: 'triplex' },
    ])
  })
})

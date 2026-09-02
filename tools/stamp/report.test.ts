/**
 * The severity policy, which is the part of this row a reviewer should argue
 * with.
 *
 * The naive gate fails on this tree: the committed sidecar carries `schema: 1`
 * against an index at `schema: 3`, because W4 and W5 both reshaped the record
 * after W1 measured — and every one of the 1,163 md5 keys in it still resolves.
 * So the tests below pin the distinction that lets that pass while a single
 * orphaned md5 does not.
 */
import { describe, expect, it } from 'vitest'

import type { ArtefactStamp } from './artefacts'
import type { CorpusDrift } from './corpus'
import type { ArtefactReport, JoinedArtefact, LockReport, ShareReport, StampReport } from './report'
import {
  failuresOf,
  formatReport,
  isBadStatus,
  markdownSummary,
  reportFor,
  serialiseStamp,
  serialiseWorklist,
  statusFor,
  titleOf,
} from './report'

const INDEX_STAMP: ArtefactStamp = { schema: 3, pipeline: 1, fixtures: 'abcdef0123456789', manifest: 1 }

function drift(overrides: Partial<CorpusDrift> = {}): CorpusDrift {
  return { expected: 10, covered: 10, missing: [], orphaned: [], stale: [], ...overrides }
}

function joined(overrides: Partial<JoinedArtefact> = {}): JoinedArtefact {
  return { id: 'sidecar', required: true, path: '/tmp/sidecar.json', present: true, stamp: INDEX_STAMP, drift: drift(), ...overrides }
}

describe('statusFor', () => {
  it('calls a clean join with an agreeing stamp current', () => {
    expect(statusFor(drift(), [])).toBe('current')
  })

  it('calls a clean join with a differing stamp restamped, not stale', () => {
    // The sidecar today. Fails if a stamp difference is treated as invalidation,
    // which would fail this branch on a tree where nothing is wrong.
    expect(statusFor(drift(), ['schema 1 to 3'])).toBe('restamped')
  })

  it('lets an orphan beat a stamp that agrees', () => {
    // Fails if the join is only consulted when the stamp differs — the exact
    // hole md5 churn goes through, since a re-export inside one fixtures commit
    // moves no stamp field at all.
    expect(statusFor(drift({ orphaned: ['x'] }), [])).toBe('drifted')
  })

  it('lets drift beat incompleteness', () => {
    expect(statusFor(drift({ missing: ['a'], orphaned: ['b'] }), [])).toBe('drifted')
    expect(statusFor(drift({ missing: ['a'] }), [])).toBe('incomplete')
  })

  it('treats a no-longer-needed blob as drift, not as cleanliness', () => {
    expect(statusFor(drift({ stale: ['x'] }), [])).toBe('drifted')
  })
})

describe('isBadStatus', () => {
  it('passes the two statuses that mean the artefact is fine', () => {
    expect(isBadStatus('current')).toBe(false)
    expect(isBadStatus('restamped')).toBe(false)
    expect(isBadStatus('regenerated')).toBe(false)
  })

  it('fails the three that mean work is outstanding', () => {
    expect(isBadStatus('drifted')).toBe(true)
    expect(isBadStatus('incomplete')).toBe(true)
    expect(isBadStatus('absent')).toBe(true)
  })
})

describe('reportFor', () => {
  it('explains a restamped artefact in terms of what still resolves', () => {
    const report = reportFor(joined({ stamp: { ...INDEX_STAMP, schema: 1 } }), INDEX_STAMP)
    expect(report.status).toBe('restamped')
    expect(report.stampDrift).toEqual(['schema 1 to 3'])
    expect(report.reason).toContain('the values stand')
  })

  it('names the blockers on an absent artefact rather than calling it broken', () => {
    const report = reportFor(
      { id: 'lod', required: false, blockers: ['B2'], path: '/tmp/lod.json', present: false },
      INDEX_STAMP,
    )
    expect(report.status).toBe('absent')
    expect(report.reason).toContain('B2')
    expect(report.title).toBe(titleOf('lod'))
  })

  it('states the orphan count separately from the work count', () => {
    const report = reportFor(joined({ drift: drift({ missing: ['a'], orphaned: ['b', 'c'] }) }), INDEX_STAMP)
    expect(report.reason).toContain('2 orphaned')
    expect(report.reason).toContain('1 to derive')
  })

  it('carries the pending count a half-finished measurement run leaves', () => {
    const report = reportFor(joined({ drift: drift({ missing: ['a'] }), pending: 7 }), INDEX_STAMP)
    expect(report.reason).toContain('7 pending')
  })
})

/* ---------------------------------------------------------- whole reports */

function artefact(overrides: Partial<ArtefactReport>): ArtefactReport {
  return { id: 'sidecar', title: titleOf('sidecar'), status: 'current', required: true, stampDrift: [], reason: 'fine', ...overrides }
}

const LOCK: LockReport = { ok: true, schema: 3, pipeline: 1, content: 'c'.repeat(64), config: 'f'.repeat(64), violations: [] }

const SHARE: ShareReport = { version: 1, live: 3, reserved: 3, retired: 0, pairs: 'p'.repeat(64), roundTrip: 3, violations: [] }

function report(overrides: Partial<StampReport> = {}): StampReport {
  const partial = {
    version: 1,
    index: { ...INDEX_STAMP, built: '2026-01-01T00:00:00.000Z' },
    corpus: { blobs: 3, digest: 'd'.repeat(64) },
    records: 3,
    payload: { raw: 100, gzip: 50, brotli: 40, budget: 512_000, withinBudget: true },
    lock: LOCK,
    share: SHARE,
    artefacts: [artefact({ id: 'index', title: titleOf('index'), status: 'regenerated' }), artefact({})],
    ...overrides,
  }
  return { ...partial, failures: overrides.failures ?? failuresOf(partial) }
}

describe('failuresOf', () => {
  it('is empty when every required artefact is fine', () => {
    expect(report().failures).toEqual([])
  })

  it('fails on a required artefact and only reports an advisory one', () => {
    // The whole B1/B2 accommodation. Fails if `required` is ignored, which would
    // make the gate red on every branch until X1 runs — and a gate that is
    // always red is a gate nobody reads.
    const failures = report({
      artefacts: [
        artefact({ id: 'sidecar', status: 'drifted', required: true, reason: 'one orphan' }),
        artefact({ id: 'thumbs', title: titleOf('thumbs'), status: 'incomplete', required: false, reason: '56 of 8352' }),
      ],
    }).failures
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('measurement sidecar')
    expect(failures[0]).toContain('one orphan')
  })

  it('puts the lock and the share violations ahead of the artefacts', () => {
    const failures = report({
      lock: { ...LOCK, ok: false, violations: ['lock broke'] },
      share: { ...SHARE, violations: ['share broke'] },
      artefacts: [artefact({ status: 'absent', reason: 'gone' })],
    }).failures
    expect(failures).toEqual(['lock broke', 'share broke', expect.stringContaining('gone') as unknown as string])
  })
})

describe('renderings', () => {
  it('marks a failing required artefact FAIL and an advisory one warn', () => {
    const text = formatReport(
      report({
        artefacts: [
          artefact({ id: 'sidecar', status: 'drifted', required: true, reason: 'orphan' }),
          artefact({ id: 'thumbs', title: titleOf('thumbs'), status: 'incomplete', required: false, reason: 'partial' }),
        ],
      }),
    )
    expect(text).toContain('FAIL sidecar')
    expect(text).toContain('warn thumbs')
  })

  it('escapes a pipe so one artefact cannot break the summary table', () => {
    const markdown = markdownSummary(report({ artefacts: [artefact({ reason: 'a | b' })] }))
    expect(markdown).toContain(String.raw`a \| b`)
    // Header plus separator plus one row.
    expect(markdown.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(3)
  })

  it('keeps the md5 lists out of stamp.json and in the worklist', () => {
    // stamp.json rides next to the index; 8,296 md5s is 300 KB of it. Fails if a
    // drift list is ever spread into the shipped file.
    const full = report({
      artefacts: [artefact({ status: 'drifted', drift: { expected: 2, covered: 1, missing: ['a'.repeat(32)], orphaned: ['b'.repeat(32)], stale: [] } })],
    })
    const stamp = serialiseStamp(full)
    expect(stamp).not.toContain('a'.repeat(32))
    expect(JSON.parse(stamp)).toMatchObject({
      artefacts: [{ coverage: { missing: 1, orphaned: 1, stale: 0 } }],
    })

    const worklist = serialiseWorklist(full, full.corpus)
    expect(worklist).toContain('a'.repeat(32))
    expect(JSON.parse(worklist)).toMatchObject({ lists: [{ id: 'sidecar', missing: ['a'.repeat(32)] }] })
  })

  it('lists nothing in the worklist when every join is clean', () => {
    expect(JSON.parse(serialiseWorklist(report(), report().corpus))).toMatchObject({ lists: [] })
  })
})

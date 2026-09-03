/**
 * One report over five artefacts: the statuses, the severity policy, and the
 * three renderings of it.
 *
 * ## The severity policy is the substance of this file
 *
 * The naive gate — "fail when an artefact's stamp differs from the index's" —
 * fails on this tree today and should not. The committed sidecar carries
 * `schema: 1`; the index is at `schema: 3`, because W4 reshaped the record and
 * W5 reshaped `arc` after W1 measured. Measured against the current index, the
 * sidecar covers **1,163 of the 1,163 blobs it must, with 0 orphaned** — every
 * dimension in it is still a dimension of a mesh the index still names, keyed by
 * an md5 that still resolves. Nothing about it is stale.
 *
 * That is the same distinction `PIPELINE_VERSION` draws, one level up: a version
 * that moved without changing what the artefact has to cover has not invalidated
 * it. So the stamp is **provenance** and the md5 join is **validity**, and only
 * the second one fails a build:
 *
 *   - `current` — the stamp agrees and the join is clean.
 *   - `restamped` — the stamp differs, the join is clean. Reported, not failed,
 *     with the fields that moved. This is the sidecar today.
 *   - `incomplete` — blobs it must cover are absent. Real work outstanding.
 *   - `drifted` — it covers an md5 the index no longer has (`orphaned`: the
 *     churn signature) or one it no longer needs (`stale`).
 *   - `absent` — no file. The thumbnail set and the LOD store in CI, because
 *     both are gitignored local staging directories.
 *   - `regenerated` — rebuilt from the fixtures by this very step: the index and
 *     the share manifest.
 *
 * ## And which artefacts a bad status is allowed to fail
 *
 * `index`, `share` and `sidecar` are **required**: all three are either
 * regenerated here or committed, so a bad status is a defect on this branch. The
 * thumbnail set and the LOD store are **advisory** until blockers **B1** (the
 * Cloudflare zone rules) and **B2** (R2 write credentials) clear, because until
 * then no complete copy of either can exist anywhere — X1 has not run. `--require
 * thumbs,lod` promotes them, and that flag is the whole of what X1 and X6 have to
 * do here once the blockers lift.
 */
import type { CatalogFile, VersionStamp } from '../../src/catalog'
import type { SizeReport } from '../../pipeline'
import { formatBytes } from '../../pipeline'

import type { ArtefactStamp } from './artefacts'
import { formatStamp, stampDifference } from './artefacts'
import type { CorpusDigest, CorpusDrift } from './corpus'
import { isClean } from './corpus'

/** Version of `stamp.json`'s own shape. */
export const STAMP_VERSION = 1

export type ArtefactId = 'index' | 'share' | 'sidecar' | 'thumbs' | 'lod'

export type ArtefactStatus = 'regenerated' | 'current' | 'restamped' | 'incomplete' | 'drifted' | 'absent'

export interface ArtefactReport {
  id: ArtefactId
  /** What it is, in the words the series table uses. */
  title: string
  status: ArtefactStatus
  /** Whether a bad status fails the build. */
  required: boolean
  path?: string
  /** The index stamp the artefact carries, when it has one. */
  stamp?: ArtefactStamp
  /** Which stamp fields differ from the index's. Empty when they agree. */
  stampDrift: string[]
  /** The md5 join. Absent for the share manifest, which is not md5-addressed. */
  drift?: CorpusDrift
  corpus?: CorpusDigest
  /** Blocker ids holding this artefact's execution, when any. */
  blockers?: string[]
  /** One line a human reads. */
  reason: string
}

/** The share manifest, which has no file and no md5s. */
export interface ShareReport {
  /** `CatalogFile.version.manifest`, which travels in every payload. */
  version: number
  /** Ordinals a link can resolve today. */
  live: number
  /** Slots issued in `pipeline/ordinals/manifest.json`. */
  reserved: number
  /** Reserved slots with no live record: links containing one drop that placement. */
  retired: number
  /** sha256 over the `(ordinal, id)` pairs. A renumbering moves it. */
  pairs: string
  /** Records whose ordinal round-trips through the rebuilt manifest. */
  roundTrip: number
  violations: string[]
}

export interface LockReport {
  ok: boolean
  schema: number
  pipeline: number
  content: string
  config: string
  violations: string[]
}

export interface StampReport {
  version: number
  /** The stamp all five artefacts are compared against. */
  index: VersionStamp
  /** Every distinct md5 the index names. */
  corpus: CorpusDigest
  records: number
  /** Measured at `PAYLOAD_EPOCH`, so it is comparable across branches. */
  payload: SizeReport
  lock: LockReport
  share: ShareReport
  artefacts: ArtefactReport[]
  /** Empty when the gate passes. */
  failures: string[]
}

const TITLES: Record<ArtefactId, string> = {
  index: 'catalog index',
  share: 'share manifest',
  sidecar: 'measurement sidecar',
  thumbs: 'thumbnail set',
  lod: 'LOD store',
}

export function titleOf(id: ArtefactId): string {
  return TITLES[id]
}

/**
 * Status from the join, in the order that makes the worst finding win.
 *
 * `orphaned` and `stale` beat `missing`: an artefact that covers a mesh the index
 * has forgotten is describing a corpus that no longer exists, which is a
 * stronger statement than having work left to do.
 */
export function statusFor(drift: CorpusDrift, stampDrift: readonly string[]): ArtefactStatus {
  if (drift.orphaned.length > 0 || drift.stale.length > 0) return 'drifted'
  if (drift.missing.length > 0) return 'incomplete'
  if (stampDrift.length > 0) return 'restamped'
  return 'current'
}

/** Statuses that fail a required artefact. */
export function isBadStatus(status: ArtefactStatus): boolean {
  return status === 'drifted' || status === 'incomplete' || status === 'absent'
}

export interface JoinedArtefact {
  id: ArtefactId
  required: boolean
  blockers?: string[]
  path: string
  stamp?: ArtefactStamp
  drift?: CorpusDrift
  present: boolean
  /** Sidecar only: targets attempted and unfinished. */
  pending?: number
}

/** One artefact's report line, from the join. */
export function reportFor(joined: JoinedArtefact, indexStamp: ArtefactStamp): ArtefactReport {
  const blockers = joined.blockers === undefined ? {} : { blockers: joined.blockers }

  if (!joined.present || joined.drift === undefined || joined.stamp === undefined) {
    return {
      id: joined.id,
      title: TITLES[joined.id],
      status: 'absent',
      required: joined.required,
      path: joined.path,
      stampDrift: [],
      ...blockers,
      reason: joined.required
        ? `no artefact at ${joined.path}`
        : `not staged locally — ${joined.path} does not exist${
            joined.blockers === undefined ? '' : ` (blocked on ${joined.blockers.join(', ')})`
          }`,
    }
  }

  const stampDrift = stampDifference(joined.stamp, indexStamp)
  const status = statusFor(joined.drift, stampDrift)

  return {
    id: joined.id,
    title: TITLES[joined.id],
    status,
    required: joined.required,
    path: joined.path,
    stamp: joined.stamp,
    stampDrift,
    drift: joined.drift,
    ...blockers,
    reason: reasonFor(status, joined, stampDrift),
  }
}

function reasonFor(status: ArtefactStatus, joined: JoinedArtefact, stampDrift: readonly string[]): string {
  const drift = joined.drift
  if (drift === undefined) return 'no join'
  const coverage = `${String(drift.covered)} of ${String(drift.expected)} blobs`
  const pending = joined.pending === undefined || joined.pending === 0 ? '' : `, ${String(joined.pending)} pending`

  switch (status) {
    case 'drifted':
      return (
        `${coverage}; ${String(drift.orphaned.length)} orphaned (md5 no longer in the index — the ` +
        `re-export signature) and ${String(drift.stale.length)} no longer needed. ` +
        `${String(drift.missing.length)} to derive.`
      )
    case 'incomplete':
      return `${coverage}${pending}; ${String(drift.missing.length)} to derive.`
    case 'restamped':
      return (
        `${coverage}, complete. Derived from a different index (${stampDrift.join(', ')}), and every ` +
        'md5 it covers is still one the index names — so the values stand.'
      )
    default:
      return `${coverage}, complete, and the stamp agrees.`
  }
}

/** Every failure the gate reports, in artefact order with the lock first. */
export function failuresOf(report: Omit<StampReport, 'failures'>): string[] {
  const failures: string[] = [...report.lock.violations, ...report.share.violations]
  for (const artefact of report.artefacts) {
    if (!artefact.required || !isBadStatus(artefact.status)) continue
    failures.push(`${artefact.title} (${artefact.id}) is ${artefact.status}: ${artefact.reason}`)
  }
  return failures
}

/* --------------------------------------------------------------- renderings */

/** The stdout rendering: one block, one line per artefact. */
export function formatReport(report: StampReport): string {
  const lines = [
    `index         ${formatStamp(report.index)} · built ${report.index.built}`,
    `corpus        ${String(report.corpus.blobs)} distinct md5 over ${String(report.records)} records · ${report.corpus.digest.slice(0, 16)}`,
    `payload       ${formatBytes(report.payload.brotli)} brotli at the payload epoch (${formatBytes(report.payload.raw)} raw, ${formatBytes(report.payload.gzip)} gzip) of ${formatBytes(report.payload.budget)}`,
    `derivation    ${report.lock.ok ? 'locked' : 'VIOLATED'} · content ${report.lock.content.slice(0, 16)} · config ${report.lock.config.slice(0, 16)}`,
    '',
  ]

  const width = Math.max(...report.artefacts.map((artefact) => artefact.id.length))
  for (const artefact of report.artefacts) {
    const mark = isBadStatus(artefact.status) ? (artefact.required ? 'FAIL' : 'warn') : '    '
    lines.push(`${mark} ${artefact.id.padEnd(width)}  ${artefact.status.padEnd(12)} ${artefact.reason}`)
  }

  lines.push('')
  if (report.failures.length === 0) {
    lines.push('stamp         all five artefacts agree with this index')
  } else {
    lines.push(`stamp         ${String(report.failures.length)} failure(s):`)
    for (const failure of report.failures) lines.push(`  - ${failure}`)
  }

  return `${lines.join('\n')}\n`
}

/** The `$GITHUB_STEP_SUMMARY` rendering. */
export function markdownSummary(report: StampReport): string {
  const rows = report.artefacts.map((artefact) => {
    const cells = [
      artefact.id,
      artefact.title,
      artefact.status,
      artefact.required ? 'required' : 'advisory',
      artefact.reason.replace(/\|/g, String.raw`\|`),
    ]
    return `| ${cells.join(' | ')} |`
  })

  return [
    '### Version stamp',
    '',
    `- index: \`${formatStamp(report.index)}\``,
    `- corpus: ${String(report.corpus.blobs)} distinct md5, digest \`${report.corpus.digest.slice(0, 16)}\``,
    `- payload at the payload epoch: ${formatBytes(report.payload.brotli)} brotli of ${formatBytes(report.payload.budget)}`,
    `- derivation lock: ${report.lock.ok ? 'held' : '**violated**'}`,
    '',
    '| artefact | what | status | gate | detail |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    report.failures.length === 0
      ? 'All five artefacts agree with this index.'
      : `**${String(report.failures.length)} failure(s):**\n\n${report.failures.map((failure) => `- ${failure}`).join('\n')}`,
    '',
  ].join('\n')
}

/**
 * `stamp.json`, the shipped form.
 *
 * The md5 lists are **not** in it. `--worklist PATH` writes those, because
 * 8,296 md5s is 300 KB of work list and this file rides next to the index. The
 * counts and the digests are what a reader needs to know whether to go looking.
 */
export function serialiseStamp(report: StampReport): string {
  const artefacts = report.artefacts.map((artefact) => ({
    id: artefact.id,
    title: artefact.title,
    status: artefact.status,
    required: artefact.required,
    ...(artefact.blockers === undefined ? {} : { blockers: artefact.blockers }),
    ...(artefact.stamp === undefined ? {} : { stamp: artefact.stamp }),
    stampDrift: artefact.stampDrift,
    ...(artefact.corpus === undefined ? {} : { corpus: artefact.corpus }),
    ...(artefact.drift === undefined
      ? {}
      : {
          coverage: {
            expected: artefact.drift.expected,
            covered: artefact.drift.covered,
            missing: artefact.drift.missing.length,
            orphaned: artefact.drift.orphaned.length,
            stale: artefact.drift.stale.length,
          },
        }),
    reason: artefact.reason,
  }))

  return `${JSON.stringify(
    {
      tool: 'tools/stamp',
      version: report.version,
      index: report.index,
      corpus: report.corpus,
      records: report.records,
      payload: report.payload,
      lock: report.lock,
      share: report.share,
      artefacts,
      failures: report.failures,
    },
    null,
    2,
  )}\n`
}

/** The full md5 work lists, for X1 and X6. */
export function serialiseWorklist(report: StampReport, corpus: CorpusDigest): string {
  const lists = report.artefacts
    .filter((artefact) => artefact.drift !== undefined && !isClean(artefact.drift))
    .map((artefact) => ({
      id: artefact.id,
      status: artefact.status,
      missing: artefact.drift?.missing ?? [],
      orphaned: artefact.drift?.orphaned ?? [],
      stale: artefact.drift?.stale ?? [],
    }))

  return `${JSON.stringify({ tool: 'tools/stamp', version: report.version, corpus, index: report.index, lists }, null, 2)}\n`
}

/** Every md5 the index names, for the joins. */
export function indexCorpus(file: CatalogFile): Set<string> {
  return new Set(file.records.map((record) => record.blob as string))
}

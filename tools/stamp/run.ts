/**
 * The one step.
 *
 * Regenerates the two artefacts that can be regenerated without the network —
 * the catalog index and the share manifest — joins the three that cannot to the
 * index it just built, checks the derivation lock, and returns one report. Every
 * decision about *what* is checked lives in `corpus.ts`, `lock.ts` and
 * `report.ts`; this file is the order they run in and the paths they run over.
 *
 * ## Why the index is rebuilt here rather than trusted from disk
 *
 * `public/catalog/catalog.json` is gitignored and rebuilt in CI, so on any given
 * machine it may be minutes or weeks old. A gate that read it would be comparing
 * four artefacts against a fifth of unknown age — and would pass, for a while,
 * on exactly the tree where the derivation had just changed. So the index is
 * built from the fixtures in this process and everything is compared against
 * that.
 *
 * This is also what replaces `npm run import:catalog` in CI: the same
 * `buildCatalog`, the same budget assertion, the same two output files, plus the
 * checks. One step. `import:catalog` stays as the human entry point, because it
 * is also the writer of `pipeline/ordinals/manifest.json` and this step
 * deliberately is not — see {@link shareReport} on why an unwritten ordinal is a
 * failure here rather than a silent append.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CatalogFile } from '../../src/catalog'
import { buildShareManifest } from '../../src/share/manifest'
import type { BuildResult } from '../../pipeline'
import {
  buildCatalog,
  buildTimestamp,
  compressCatalog,
  fixturesDir,
  loadFixtureRows,
  loadManifest,
  resolveFixturesRef,
  serialiseCatalog,
} from '../../pipeline'
import { meshTargets } from '../lod/catalog'
import { measureTargets } from '../measure/catalog'
import { spriteTargets } from '../thumbnails/catalog'

import type { ArtefactStamp } from './artefacts'
import { ARTEFACT_PATHS, liveBlobs, readMeasureSidecar, readUploadManifest, stampOf } from './artefacts'
import { corpusDigest, corpusDrift } from './corpus'
import { checkLock, derivationDigests, lockedBuild, pinnedFixturesRef, readLock } from './lock'
import type { ArtefactId, ArtefactReport, ShareReport, StampReport } from './report'
import { STAMP_VERSION, failuresOf, reportFor, titleOf } from './report'

/** Blockers holding each artefact's execution, from the series' blockers table. */
export const ARTEFACT_BLOCKERS: Partial<Record<ArtefactId, string[]>> = {
  thumbs: ['B1', 'B2'],
  lod: ['B2'],
}

/** Artefacts required unless `--require` says otherwise. */
export const DEFAULT_REQUIRED: ArtefactId[] = ['index', 'share', 'sidecar']

export interface StampOptions {
  /** Fixtures directory. Defaults to `fixturesDir()`. */
  fixtures?: string
  /** Where `catalog.json` and `stamp.json` are written. */
  outDir?: string
  /** `false` writes nothing — a check on a branch cannot have side effects. */
  write?: boolean
  sidecar?: string
  thumbs?: string
  lod?: string
  /** Artefacts a bad status fails on, added to {@link DEFAULT_REQUIRED}. */
  require?: readonly ArtefactId[]
  /** `version.built`. Defaults to {@link buildTimestamp}, which CI pins. */
  builtAt?: string
}

export interface StampRun {
  report: StampReport
  file: CatalogFile
  json: string
  /** Absolute paths written, in order. Empty when `write` is false. */
  written: string[]
}

export function runStamp(options: StampOptions = {}): StampRun {
  const dir = fixturesDir(options.fixtures)
  const rows = loadFixtureRows(dir)
  const fixturesRef = resolveFixturesRef(dir)
  const previous = loadManifest()

  const built: BuildResult = buildCatalog({
    rows,
    manifest: previous,
    fixturesRef,
    builtAt: options.builtAt ?? buildTimestamp(),
  })
  const file = built.file
  const json = serialiseCatalog(file)

  const written: string[] = []
  if (options.write !== false) {
    const outDir = options.outDir ?? join(process.cwd(), 'public', 'catalog')
    mkdirSync(outDir, { recursive: true })
    const jsonPath = join(outDir, 'catalog.json')
    const brPath = join(outDir, 'catalog.json.br')
    writeFileSync(jsonPath, json)
    writeFileSync(brPath, compressCatalog(json))
    written.push(jsonPath, brPath)
  }

  const lock = readLock()
  const lockCheck = checkLock(lock, lockedBuild(rows), fixturesRef)

  const share = shareReport(file, previous, built)
  const indexStamp = stampOf(file.version)
  const live = liveBlobs(file)
  const required = new Set<ArtefactId>([...DEFAULT_REQUIRED, ...(options.require ?? [])])

  const artefacts: ArtefactReport[] = [
    {
      id: 'index',
      title: titleOf('index'),
      status: 'regenerated',
      required: true,
      path: written[0] ?? join(options.outDir ?? 'public/catalog', 'catalog.json'),
      stamp: indexStamp,
      stampDrift: [],
      corpus: corpusDigest(live),
      reason:
        `${String(file.records.length)} records over ${String(live.size)} distinct md5, rebuilt from ` +
        `${dir} at ${fixturesRef.slice(0, 12)}.`,
    },
    {
      id: 'share',
      title: titleOf('share'),
      status: 'regenerated',
      required: true,
      stamp: indexStamp,
      stampDrift: [],
      reason:
        `manifest ${String(share.version)} · ${String(share.live)} resolvable ordinals of ` +
        `${String(share.reserved)} reserved (${String(share.retired)} retired) · ` +
        `${String(share.roundTrip)} of ${String(file.records.length)} records round-trip · ` +
        `pairs ${share.pairs.slice(0, 16)}`,
    },
    joinArtefact('sidecar', options.sidecar ?? ARTEFACT_PATHS.sidecar, measureBlobs(file), live, required, indexStamp),
    joinArtefact('thumbs', options.thumbs ?? ARTEFACT_PATHS.thumbs, spriteBlobs(file), live, required, indexStamp),
    joinArtefact('lod', options.lod ?? ARTEFACT_PATHS.lod, meshBlobs(file), live, required, indexStamp),
  ]

  const partial = {
    version: STAMP_VERSION,
    index: file.version,
    corpus: corpusDigest(live),
    records: file.records.length,
    lock: {
      ok: lockCheck.ok,
      schema: lockCheck.schema,
      pipeline: lockCheck.pipeline,
      content: lockCheck.digests.content,
      config: lockCheck.digests.config,
      violations: lockCheck.violations,
    },
    share,
    artefacts,
  }

  const report: StampReport = { ...partial, failures: failuresOf(partial) }

  return { report, file, json, written }
}

/* --------------------------------------------------------- the three joins */

function measureBlobs(file: CatalogFile): string[] {
  return measureTargets(file).targets.map((target) => target.blob as string)
}

function spriteBlobs(file: CatalogFile): string[] {
  return spriteTargets(file).targets.map((target) => target.blob as string)
}

function meshBlobs(file: CatalogFile): string[] {
  return meshTargets(file).targets.map((target) => target.blob as string)
}

function joinArtefact(
  id: 'sidecar' | 'thumbs' | 'lod',
  path: string,
  expected: readonly string[],
  live: ReadonlySet<string>,
  required: ReadonlySet<ArtefactId>,
  indexStamp: ArtefactStamp,
): ArtefactReport {
  const found = id === 'sidecar' ? readMeasureSidecar(path) : readUploadManifest(id, path)
  const blockers = ARTEFACT_BLOCKERS[id]

  const report = reportFor(
    {
      id,
      required: required.has(id),
      ...(blockers === undefined ? {} : { blockers }),
      path,
      present: found !== undefined,
      ...(found === undefined
        ? {}
        : {
            stamp: found.stamp,
            drift: corpusDrift(expected, found.blobs, live),
            pending: found.pending,
          }),
    },
    indexStamp,
  )

  return found === undefined ? report : { ...report, corpus: corpusDigest(found.blobs) }
}

/* --------------------------------------------------------- the share manifest */

/**
 * Regenerate the share manifest from the index and check the three things that
 * are only checkable here.
 *
 * 1. **Every live record round-trips.** `src/share/capacity.test.ts` builds a
 *    manifest from a handful of synthetic records; nothing asserts the full
 *    8,702-way round trip against the real index, and that is the mapping every
 *    share link is written against.
 * 2. **The manifest version the index publishes is the one the ordinal file
 *    holds.** A link refuses outright on a mismatch (§13), so a divergence would
 *    invalidate every link in circulation.
 * 3. **No ordinal was issued by this build.** `assignOrdinals` appends in memory
 *    and `import:catalog` writes the file; this step does not write it, so an
 *    append here means the corpus grew and the append-only record of it was
 *    never committed. Failing is the point: `pipeline/ordinals/manifest.json` is
 *    the one file in `pipeline/` that is data, and issuing an ordinal should be a
 *    reviewed act rather than a build artefact.
 */
export function shareReport(
  file: CatalogFile,
  previous: ReturnType<typeof loadManifest>,
  assignment: Pick<BuildResult, 'added' | 'retired'>,
): ShareReport {
  const manifest = buildShareManifest(file)
  const violations: string[] = []

  // **Two round trips since row V4, because the manifest carries two mappings.**
  // The ordinal → tile direction is the one every share link's checksum is taken
  // over and is asserted per record. The design → ordinal direction is what a
  // link now *encodes*, and it is asserted differently on purpose: the address is
  // the lowest ordinal in the group, so `ordinalOf(record.design) === record.ord`
  // is false for every non-lowest variant by design. What must hold is that the
  // address is an ordinal of this record's own item, which `designOf` closes.
  let roundTrip = 0
  const mismatched: string[] = []
  for (const record of file.records) {
    const address = manifest.ordinalOf(record.design)
    const tileTrip = manifest.tileOf(record.ord) === record.id && manifest.designOf(record.ord) === record.design
    const designTrip = address !== undefined && address <= record.ord && manifest.designOf(address) === record.design
    if (tileTrip && designTrip) {
      roundTrip += 1
    } else if (mismatched.length < 4) {
      mismatched.push(`${record.id} at ordinal ${String(record.ord)}`)
    }
  }

  if (roundTrip !== file.records.length) {
    violations.push(
      `the share manifest does not round-trip ${String(file.records.length - roundTrip)} of ` +
        `${String(file.records.length)} records: ${mismatched.join(', ')}. Every share link is written ` +
        'against this mapping, so a link containing one of those ordinals decodes to a different item.',
    )
  }

  if (manifest.version !== previous.manifest) {
    violations.push(
      `the index publishes manifest version ${String(manifest.version)} and ` +
        `pipeline/ordinals/manifest.json holds ${String(previous.manifest)}. Every payload carries the ` +
        'published number and a decode refuses on a mismatch, so this invalidates every link in circulation.',
    )
  }

  if (assignment.added.length > 0) {
    violations.push(
      `${String(assignment.added.length)} ordinal(s) were issued by this build and are not in ` +
        'pipeline/ordinals/manifest.json: ' +
        `${assignment.added.slice(0, 3).join(', ')}${assignment.added.length > 3 ? ', …' : ''}. ` +
        'Run `npm run import:catalog` and commit the manifest — issuing an ordinal is an append-only, ' +
        'reviewed act, not a build side effect.',
    )
  }

  const pairs = createHash('sha256').update('openforge-ordinals-1')
  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    pairs.update(`\n${String(record.ord)} ${record.id}`)
  }

  return {
    version: manifest.version,
    live: manifest.size,
    reserved: previous.ids.length,
    retired: assignment.retired.length,
    pairs: pairs.digest('hex'),
    roundTrip,
    violations,
  }
}

/** Re-exported so the CLI and the tests agree on where the pin lives. */
export { pinnedFixturesRef, derivationDigests, readLock }

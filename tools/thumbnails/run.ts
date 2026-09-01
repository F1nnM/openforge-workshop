/**
 * The run: fetch, crop, encode, stage, measure.
 *
 * ## Incremental and idempotent, keyed on md5
 *
 * The output path *is* the state. A thumbnail lives at
 * `{out}/thumbs/{md5[0:6]}/{md5}.webp`, the md5 is the source mesh's content
 * address, and a changed mesh is a new md5 under a new path — so a file that
 * exists is a file that is correct, and the only thing a rerun after a catalog
 * scan has to do is the new blobs. No timestamps, no state file, nothing to get
 * out of sync. `--force` is there for the one case existence cannot cover: a
 * deliberate change to the crop, the size, the quality or the tone, where the
 * key is unchanged and the bytes should not be.
 *
 * The sheet cache is keyed the same way and for the same reason, so the second
 * run of a sample re-fetches nothing at all.
 *
 * ## Failure is per object and loud at the end
 *
 * One 404 must not lose the other 8,701 thumbnails, so a failure is recorded
 * against its blob and the run continues; the CLI then exits non-zero if
 * anything failed. What is *not* tolerated is a sheet whose dimensions disagree
 * with the index's declared geometry — that means the layout changed or the
 * wrong object was fetched, and quietly cropping a rectangle out of it would
 * produce a plausible thumbnail of the wrong thing.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { CatalogFile } from '../../src/catalog'

import { thumbKey, thumbPath, spriteUrl } from './catalog'
import type { Neutrality } from './colour'
import { neutrality, poolNeutrality } from './colour'
import { DEFAULT_CONCURRENCY, DEFAULT_MIN_INTERVAL_MS, cachePath, fetchSheet, mapLimit } from './fetch'
import type { FetchOptions } from './fetch'
import type { ThumbStat } from './measure'
import type { Tone } from './render'
import { THUMB_QUALITY, THUMB_SIZE, cropFrame, renderThumbnail } from './render'
import type { SamplePick } from './sample'

export interface RunOptions {
  catalog: CatalogFile
  picks: readonly SamplePick[]
  outDir: string
  cacheDir?: string
  /** Defaults to the index's `sprite.defaultFrame`. */
  frame?: number
  size?: number
  quality?: number
  tone?: Tone
  /** Re-encode objects that already exist. */
  force?: boolean
  concurrency?: number
  minIntervalMs?: number
  /** Decode frame 0 a second time to measure its chroma. Off for a full run. */
  measureColour?: boolean
  fetch?: Pick<FetchOptions, 'fetchImpl' | 'sleep' | 'timeoutMs' | 'retries'>
  onProgress?: (event: ProgressEvent) => void
  /** Injected in tests. Defaults to `Date.now`. */
  now?: () => number
}

export interface ProgressEvent {
  index: number
  total: number
  blob: string
  outcome: 'written' | 'skipped' | 'failed'
  reason?: string
}

/** One object that could not be produced. */
export interface RunFailure {
  blob: string
  key: string
  url: string
  reason: string
}

/** A staged object, ready for the manifest. */
export interface StagedFile {
  key: string
  blob: string
  bytes: number
  contents: Buffer
  tiles: number
}

export interface RunReport {
  attempted: number
  written: number
  skipped: number
  failed: RunFailure[]
  /** Sheets pulled from the bucket this run. */
  fetched: number
  /** Sheets served from the on-disk cache. */
  fromCache: number
  /** Objects whose sheet *and* thumbnail sizes are both known — what `measure` uses. */
  stats: ThumbStat[]
  files: StagedFile[]
  /** Pooled chroma over the frames decoded this run; `opaque === 0` when not measured. */
  neutrality: Neutrality
  elapsedMs: number
  frame: number
  size: number
  quality: number
  tone: Tone
}

type Outcome =
  | { kind: 'written'; stat: ThumbStat; file: StagedFile; fromCache: boolean; chroma?: Neutrality }
  | { kind: 'skipped'; file: StagedFile; stat?: ThumbStat }
  | { kind: 'failed'; failure: RunFailure }

export async function runThumbnails(options: RunOptions): Promise<RunReport> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const frame = options.frame ?? options.catalog.sprite.defaultFrame
  const size = options.size ?? THUMB_SIZE
  const quality = options.quality ?? THUMB_QUALITY
  const tone = options.tone ?? 'blue'
  const total = options.picks.length

  const outcomes = await mapLimit(
    options.picks,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (pick, index) => {
      const outcome = await one(pick, { ...options, frame, size, quality, tone })
      options.onProgress?.({
        index,
        total,
        blob: pick.target.blob,
        outcome: outcome.kind,
        ...(outcome.kind === 'failed' ? { reason: outcome.failure.reason } : {}),
      })
      return outcome
    },
    { minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, sleep: options.fetch?.sleep },
  )

  const stats: ThumbStat[] = []
  const files: StagedFile[] = []
  const failed: RunFailure[] = []
  const chromas: Neutrality[] = []
  let written = 0
  let skipped = 0
  let fetched = 0
  let fromCache = 0

  for (const outcome of outcomes) {
    if (outcome.kind === 'failed') {
      failed.push(outcome.failure)
      continue
    }
    files.push(outcome.file)
    if (outcome.kind === 'written') {
      written += 1
      stats.push(outcome.stat)
      if (outcome.fromCache) fromCache += 1
      else fetched += 1
      if (outcome.chroma) chromas.push(outcome.chroma)
    } else {
      skipped += 1
      if (outcome.stat) stats.push(outcome.stat)
    }
  }

  return {
    attempted: total,
    written,
    skipped,
    failed,
    fetched,
    fromCache,
    stats,
    files,
    neutrality: poolNeutrality(chromas),
    elapsedMs: now() - startedAt,
    frame,
    size,
    quality,
    tone,
  }
}

interface OneOptions extends RunOptions {
  frame: number
  size: number
  quality: number
  tone: Tone
}

async function one(pick: SamplePick, options: OneOptions): Promise<Outcome> {
  const { target } = pick
  const key = thumbKey(options.catalog, target.blob)
  const path = thumbPath(options.catalog, target.blob, options.outDir)
  const url = spriteUrl(options.catalog, target.blob)

  if (!options.force && existsSync(path)) {
    const contents = readFileSync(path)
    const file: StagedFile = {
      key,
      blob: target.blob,
      bytes: contents.byteLength,
      contents,
      tiles: target.ids.length,
    }
    const sheetBytes = cachedSheetBytes(options.cacheDir, target.blob)
    return {
      kind: 'skipped',
      file,
      ...(sheetBytes === undefined
        ? {}
        : { stat: { blob: target.blob, reason: pick.reason, sheetBytes, thumbBytes: contents.byteLength } }),
    }
  }

  try {
    const sheet = await fetchSheet(url, target.blob, {
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      ...options.fetch,
    })
    const label = `${target.blob} (${url})`
    const contents = await renderThumbnail(sheet.bytes, {
      sheet: options.catalog.sprite,
      frame: options.frame,
      size: options.size,
      quality: options.quality,
      tone: options.tone,
      label,
    })

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)

    let chroma: Neutrality | undefined
    if (options.measureColour ?? true) {
      const raw = await cropFrame(sheet.bytes, {
        sheet: options.catalog.sprite,
        frame: options.frame,
        label,
      })
      chroma = neutrality(raw.data)
    }

    return {
      kind: 'written',
      fromCache: sheet.fromCache,
      stat: {
        blob: target.blob,
        reason: pick.reason,
        sheetBytes: sheet.bytes.byteLength,
        thumbBytes: contents.byteLength,
      },
      file: { key, blob: target.blob, bytes: contents.byteLength, contents, tiles: target.ids.length },
      ...(chroma === undefined ? {} : { chroma }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      failure: { blob: target.blob, key, url, reason: error instanceof Error ? error.message : String(error) },
    }
  }
}

/** The cached sheet's size, when a skipped object's sheet is still on disk. */
function cachedSheetBytes(cacheDir: string | undefined, blob: string): number | undefined {
  if (cacheDir === undefined) return undefined
  const path = cachePath(cacheDir, blob)
  if (!existsSync(path)) return undefined
  return statSync(path).size
}

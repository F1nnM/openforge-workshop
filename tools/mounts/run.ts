/**
 * The run: fetch each mesh once, measure it in a thread, append the line, move on.
 *
 * ## Resumability is the log, not a checkpoint
 *
 * Every finished blob is appended before the next dispatch and a run skips what
 * the log already holds, so an interrupted run costs the objects it had not
 * reached and nothing else. `sidecar.ts` states the rest of that argument.
 *
 * ## Two bounds, not one, because the two costs are different
 *
 * Fetching is somebody else's bucket: bounded by {@link MAX_CONCURRENCY} = 8,
 * defaulting to 4, with a minimum interval between starts, exactly as
 * `tools/measure` does and for the same reason — the link saturates around
 * 4–5.5 MB/s whatever the number, so more requests buy nothing and cost the
 * bucket owner goodwill.
 *
 * Measuring is this machine: bounded by the worker pool. The pool is sized at
 * `min(availableParallelism, concurrency)` because `mapLimit` only ever has
 * `concurrency` meshes in hand — a ninth worker would have nothing to measure —
 * and workers are spawned lazily, so `--limit 1` starts exactly one thread and
 * pays one `tsx` startup.
 *
 * ## A dead worker is replaced, not fatal
 *
 * A 109 MB mesh can take a thread's heap out, and the pool must survive it: the
 * job becomes a `failed` line naming the reason, the corpse is terminated and a
 * fresh thread takes its slot. Losing a worker permanently would silently halve
 * the pool for the rest of a 1,100-object run.
 */
import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'

import type { CatalogFile } from '../../src/catalog'

import type { FetchOptions } from '../measure/fetch'
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MIN_INTERVAL_MS,
  MAX_CONCURRENCY,
  fetchObject,
  mapLimit,
} from '../measure/fetch'

import type { MountTarget, TargetKind } from './catalog'
import { modelUrl } from './catalog'
import type { FailedEntry, LogEntry, MeasuredEntry } from './sidecar'
import { appendEntry, readLog } from './sidecar'
import type { MeasureRequest, MeasureResponse } from './worker'

/** The worker module, resolved beside this file so `tsx` and `node` agree on it. */
const WORKER_URL = new URL('./worker.ts', import.meta.url)

export interface MountRunOptions {
  readonly catalog: CatalogFile
  readonly targets: readonly MountTarget[]
  /** JSON-lines log. Read for resume, appended to as work completes. */
  readonly logPath: string
  /** Requests in flight. Capped at {@link MAX_CONCURRENCY}. */
  readonly concurrency?: number
  readonly minIntervalMs?: number
  /** Re-read blobs whose previous attempt failed. */
  readonly retryFailed?: boolean
  /** Re-read everything, ignoring the log. */
  readonly force?: boolean
  readonly fetch?: FetchOptions
  readonly onProgress?: (event: MountProgress) => void
}

export interface MountProgress {
  readonly index: number
  readonly total: number
  readonly blob: string
  readonly kind: TargetKind
  readonly outcome: 'measured' | 'failed' | 'skipped'
  readonly bytesRead: number
  readonly seconds: number
  /** Mounts found, for a measured host. */
  readonly mounts: number
  readonly reason?: string
}

export interface MountRunReport {
  readonly measured: number
  readonly failed: number
  readonly skipped: number
  readonly bytesRead: number
  /** Mounts found by this run — resumed entries are not recounted. */
  readonly mounts: number
  readonly elapsedMs: number
  /** Every entry now known, resumed ones included. Keyed by md5. */
  readonly entries: Map<string, LogEntry>
  readonly failures: readonly FailedEntry[]
}

/** Fetch, measure and log every target the log does not already answer. */
export async function runMounts(options: MountRunOptions): Promise<MountRunReport> {
  const existing = options.force === true ? new Map<string, LogEntry>() : readLog(options.logPath)
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY))
  const pool = new MeasurePool(Math.min(availableParallelism(), concurrency))
  const started = Date.now()

  let measured = 0
  let failed = 0
  let skipped = 0
  let bytesRead = 0
  let mounts = 0
  const failures: FailedEntry[] = []

  try {
    await mapLimit(
      options.targets,
      concurrency,
      async (target, index) => {
        const report = (event: Omit<MountProgress, 'index' | 'total' | 'blob' | 'kind'>): void => {
          options.onProgress?.({ index, total: options.targets.length, blob: target.blob, kind: target.kind, ...event })
        }

        const done = existing.get(target.blob)
        if (done !== undefined && (done.status === 'measured' || options.retryFailed !== true)) {
          skipped += 1
          report({ outcome: 'skipped', bytesRead: 0, seconds: 0, mounts: 0 })
          return
        }

        const at = Date.now()
        const entry = await measureTarget(target, options, pool)
        existing.set(target.blob, entry)
        appendEntry(options.logPath, entry)

        if (entry.status === 'measured') {
          measured += 1
          bytesRead += target.bytes
          mounts += entry.host?.mounts.length ?? 0
          report({
            outcome: 'measured',
            bytesRead: target.bytes,
            seconds: entry.seconds,
            mounts: entry.host?.mounts.length ?? 0,
          })
        } else {
          failed += 1
          failures.push(entry)
          report({
            outcome: 'failed',
            bytesRead: 0,
            seconds: (Date.now() - at) / 1000,
            mounts: 0,
            reason: entry.reason,
          })
        }
      },
      {
        minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
        ...(options.fetch?.sleep === undefined ? {} : { sleep: options.fetch.sleep }),
      },
    )
  } finally {
    await pool.close()
  }

  return {
    measured,
    failed,
    skipped,
    bytesRead,
    mounts,
    elapsedMs: Date.now() - started,
    entries: existing,
    failures,
  }
}

/**
 * One blob, from URL to log entry. Never throws — a failure becomes a
 * {@link FailedEntry}, because one unreadable object must not lose the rest.
 */
export async function measureTarget(
  target: MountTarget,
  options: Pick<MountRunOptions, 'catalog' | 'fetch'>,
  pool: MeasurePool,
): Promise<LogEntry> {
  const url = modelUrl(options.catalog, target.blob)
  const at = Date.now()
  try {
    const object = await fetchObject(url, target.blob, undefined, options.fetch)
    const answer = await pool.measure({
      kind: target.kind,
      bytes: detach(object.bytes),
      foot: target.foot,
      slots: target.slots,
      alsoInsert: target.alsoInsert === true,
    })
    if (answer.error !== undefined) throw new Error(answer.error)

    const entry: MeasuredEntry = {
      blob: target.blob,
      kind: target.kind,
      status: 'measured',
      bytes: target.bytes,
      triangles: answer.triangles ?? 0,
      seconds: round((Date.now() - at) / 1000),
      ...(answer.host === undefined ? {} : { host: answer.host }),
      ...(answer.insert === undefined ? {} : { insert: answer.insert }),
    }
    return entry
  } catch (error) {
    return {
      blob: target.blob,
      kind: target.kind,
      status: 'failed',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * The fetched bytes as a buffer that can be transferred.
 *
 * `fetchObject` returns a view over a buffer it owns exclusively, so the common
 * case hands that buffer straight over and copies nothing — which for a 109 MB
 * mesh is the difference between one allocation and two. A view that does not
 * span its buffer is copied, because transferring the buffer would hand over
 * bytes outside the view.
 */
function detach(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer
  if (buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) {
    return buffer
  }
  return bytes.slice().buffer
}

/** Two decimals — the log is read by people as well as by `buildInventory`. */
function round(seconds: number): number {
  return Math.round(seconds * 100) / 100
}

/* -------------------------------------------------------------- the pool */

/**
 * A fixed set of measuring threads, handed out one job at a time.
 *
 * Threads are spawned on demand and never exceed `size`; a job that arrives
 * with every thread busy waits in FIFO order. `close()` terminates all of them,
 * which the run must do or the process never exits — an idle `Worker` keeps the
 * event loop alive. It is called once every job has settled, which is why it
 * does not have to unblock queued jobs: `measureTarget` never throws, so
 * `mapLimit` cannot finish with one still waiting.
 */
export class MeasurePool {
  readonly #size: number
  readonly #idle: Worker[] = []
  readonly #live = new Set<Worker>()
  readonly #dead = new Set<Worker>()
  readonly #waiting: ((worker: Worker) => void)[] = []
  #nextId = 1
  #closed = false

  constructor(size: number) {
    this.#size = Math.max(1, size)
  }

  /** Measure one mesh. The buffer is transferred, so the caller loses it. */
  async measure(job: Omit<MeasureRequest, 'id'>): Promise<MeasureResponse> {
    if (this.#closed) throw new Error('the measuring pool is closed')
    const worker = await this.#acquire()
    const request: MeasureRequest = { id: this.#nextId, ...job }
    this.#nextId += 1
    try {
      return await this.#dispatch(worker, request)
    } finally {
      this.#release(worker)
    }
  }

  /** Terminate every thread. Safe to call twice. */
  async close(): Promise<void> {
    this.#closed = true
    const all = [...this.#live]
    this.#live.clear()
    this.#dead.clear()
    this.#idle.length = 0
    await Promise.all(all.map((worker) => worker.terminate()))
  }

  async #acquire(): Promise<Worker> {
    const free = this.#idle.pop()
    // A thread can die while it is idle, and posting to a terminated thread is
    // silently dropped — which would hang the job for ever. So deadness is
    // checked on the way out as well as on the way back in.
    if (free !== undefined) return this.#dead.has(free) ? this.#replace(free) : free
    if (this.#live.size < this.#size) return this.#spawn()
    return new Promise<Worker>((resolve) => this.#waiting.push(resolve))
  }

  /** Hand the thread on, or replace it first if the last job killed it. */
  #release(worker: Worker): void {
    const usable = this.#dead.has(worker) ? this.#replace(worker) : worker
    if (this.#closed) {
      void usable.terminate()
      return
    }
    const next = this.#waiting.shift()
    if (next !== undefined) next(usable)
    else this.#idle.push(usable)
  }

  #replace(corpse: Worker): Worker {
    this.#dead.delete(corpse)
    this.#live.delete(corpse)
    void corpse.terminate()
    return this.#spawn()
  }

  #spawn(): Worker {
    const worker = new Worker(WORKER_URL, { execArgv: ['--import', 'tsx'] })
    // Standing listeners, not per job: a thread can die between jobs, and an
    // `error` with no listener at all is an uncaught exception that would take
    // the run down instead of costing one blob. The per-job listeners below
    // reject the job in flight; these record that the thread is not reusable.
    const bury = (): void => {
      this.#dead.add(worker)
    }
    worker.on('error', bury)
    worker.on('exit', bury)
    this.#live.add(worker)
    return worker
  }

  /** One request, one answer. Rejects if the thread dies holding the job. */
  #dispatch(worker: Worker, request: MeasureRequest): Promise<MeasureResponse> {
    return new Promise<MeasureResponse>((resolve, reject) => {
      const settle = (finish: () => void): void => {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        finish()
      }
      const onMessage = (answer: MeasureResponse): void => {
        if (answer.id !== request.id) return
        settle(() => {
          resolve(answer)
        })
      }
      const onError = (error: Error): void => {
        this.#dead.add(worker)
        settle(() => {
          reject(new Error(`the measuring thread failed: ${error.message}`))
        })
      }
      const onExit = (code: number): void => {
        this.#dead.add(worker)
        settle(() => {
          reject(new Error(`the measuring thread exited with code ${String(code)} mid-measurement`))
        })
      }
      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      worker.postMessage(request, [request.bytes])
    })
  }
}

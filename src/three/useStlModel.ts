/**
 * The load: fetch → worker parse → `BufferGeometry`, as one hook with a status.
 *
 * Everything expensive is here rather than in the component tree, because the
 * component tree is inside a `<Canvas>` and a `<Canvas>` is the wrong place to
 * be doing network I/O — a thrown promise there suspends the renderer, not the
 * drawer, and the progress readout belongs in the DOM above the canvas anyway.
 *
 * ## Six states, because five of them are real
 *
 * `loading` and `parsing` are separate because they fail differently and take
 * different amounts of time (measured on the live archive: 1.5 s fetch against
 * 15 ms parse at the median, 3.6 s against 38 ms at p95 — the network is the
 * whole wait, and a bar that sits at 100% through the parse is more honest than
 * one that pretends the parse is the work). `empty` is the corpus's 84-byte
 * zero-triangle file, which is a *successful* load of nothing and must not read
 * as a failure. `refused` is the stream cap firing — a stale `bytes` in the
 * index, which the caller should treat exactly like the gate refusing.
 *
 * ## Everything it creates, it releases
 *
 * The abort controller cancels the fetch, the parser terminates the worker, the
 * geometry is disposed and the material is released by refcount — all in the one
 * effect cleanup, so a drawer closed mid-download leaves nothing running and
 * nothing resident. `index.ts` states what that does and does not cover.
 */
import { useEffect, useMemo, useState } from 'react'

import type { CatalogAssets, CatalogRecord } from '@/catalog'
import { r2BlobSource } from '@/download'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { MeshStandardMaterial } from 'three'

import { STL_GATE_BYTES } from './gate'
import type { ModelGeometry } from './geometry'
import { buildModelGeometry, disposeGeometry } from './geometry'
import { acquireMaterial, releaseMaterial } from './material'
import { StlTooLargeError, loadModel } from './loadModel'
import type { ReadProgress } from './loadModel'
import { createStlParser } from './stl/client'
import { spawnStlWorker } from './stl/spawn'

export type ModelStatus = 'loading' | 'parsing' | 'ready' | 'empty' | 'refused' | 'failed'

export interface ModelTiming {
  readonly fetchMs: number
  readonly parseMs: number
  /** Geometry construction, normalisation and normal recomputation, in ms. */
  readonly buildMs: number
  readonly triangles: number
  readonly format: 'binary' | 'ascii'
}

export interface ModelState {
  readonly status: ModelStatus
  readonly progress: ReadProgress | null
  readonly model: ModelGeometry | null
  readonly material: MeshStandardMaterial | null
  readonly resolution: Resolution
  readonly timing: ModelTiming | null
  /** Human-readable, already safe to render. `null` unless `failed`/`refused`. */
  readonly error: string | null
}

export interface UseStlModelOptions {
  readonly record: Pick<CatalogRecord, 'blob' | 'bytes' | 'file'>
  readonly tags: readonly string[]
  readonly assets: Pick<CatalogAssets, 'models'>
  /** The same limit the gate applied. Enforced again against the real stream. */
  readonly limit?: number
}

export function useStlModel({
  record,
  tags,
  assets,
  limit = STL_GATE_BYTES,
}: UseStlModelOptions): ModelState {
  /*
     Keyed on the tag *contents*, not the array's identity.

     A caller that computes `resolveTags(catalog, record)` inline hands a new
     array on every render, and keying the memo on it would re-resolve, re-acquire
     the material and set state every render — an infinite update loop that only
     shows up in a browser. The drawer happens to memoise its tags; this hook does
     not need it to.
  */
  const tagKey = tags.join('\u0000')
  const resolution = useMemo(() => resolveMaterial(tags, record.file), [tagKey, record.file])

  const [status, setStatus] = useState<ModelStatus>('loading')
  const [progress, setProgress] = useState<ReadProgress | null>(null)
  const [model, setModel] = useState<ModelGeometry | null>(null)
  const [timing, setTiming] = useState<ModelTiming | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Acquired and released on its own schedule: the material outlives any one
  // load (a variant swap in the drawer keeps the family) and is shared by key.
  const [material, setMaterial] = useState<MeshStandardMaterial | null>(null)
  useEffect(() => {
    setMaterial(acquireMaterial(resolution))
    return () => {
      setMaterial(null)
      releaseMaterial(resolution)
    }
  }, [resolution])

  // Same reasoning as `tagKey`: the load is keyed on the archive host as a
  // string, so an inline `{ models: … }` object literal cannot restart it.
  const models = assets.models

  useEffect(() => {
    const controller = new AbortController()
    const parser = createStlParser(spawnStlWorker)
    let built: ModelGeometry | null = null
    let alive = true

    setStatus('loading')
    setProgress({ loaded: 0, total: record.bytes })
    setModel(null)
    setTiming(null)
    setError(null)

    const run = async () => {
      const loaded = await loadModel(record.blob, {
        source: r2BlobSource({ models }),
        parser,
        limit,
        expected: record.bytes,
        signal: controller.signal,
        onProgress: (next) => {
          if (!alive) return
          setProgress(next)
          if (next.loaded >= next.total) setStatus('parsing')
        },
      })

      const started = performance.now()
      const geometry = buildModelGeometry(loaded)
      const buildMs = performance.now() - started

      if (!alive) {
        disposeGeometry(geometry.geometry)
        return
      }

      built = geometry
      setModel(geometry)
      setTiming({
        fetchMs: loaded.fetchMs,
        parseMs: loaded.parseMs,
        buildMs,
        triangles: geometry.triangles,
        format: loaded.format,
      })
      setStatus(geometry.empty ? 'empty' : 'ready')
    }

    void run().catch((cause: unknown) => {
      if (!alive) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      if (cause instanceof StlTooLargeError) {
        setStatus('refused')
        setError(cause.message)
        return
      }
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : 'the mesh could not be loaded')
    })

    return () => {
      alive = false
      controller.abort()
      parser.terminate()
      disposeGeometry(built?.geometry)
    }
  }, [record.blob, record.bytes, models, limit])

  return { status, progress, model, material, resolution, timing, error }
}

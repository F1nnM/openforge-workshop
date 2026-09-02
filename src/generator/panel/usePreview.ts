/**
 * Auto-preview: what runs, when, and what never runs at all.
 *
 * **There is no Generate button, and that is a measurement rather than a taste.**
 * The plan reserved the right to demand one: *"If a 4x4 base exceeds ~3 s, S4
 * needs an explicit Generate button."* S2 measured a 4x4 square at **437 ms
 * median and 481 ms p95** on the shipped WASM build with `--backend=manifold`,
 * seven times under that threshold, and S3 measured the same render at **102 ms
 * median** through the worker because one compiled module serves many renders.
 * So the preview follows the form.
 *
 * **It is debounced rather than live**, and that is the same measurement read
 * the other way: S2 found **15 of 46 configurations exceed a 250 ms
 * live-interaction budget on geometry alone**. A number field that re-rendered
 * per keystroke would be janky a third of the time, so §3.3's dispatch policy
 * applies — discrete controls (a select, a checkbox, a shape chip) dispatch on
 * change, continuous ones after {@link IDLE_MS} of quiet **or** on release,
 * whichever comes first. Pure debounce makes a fast machine feel artificially
 * slow; commit-on-release matches the gesture.
 *
 * ## The cheapest render is the one that does not happen
 *
 * Before anything is dispatched, the recipe is resolved against the archive. On
 * a hit the engine is never touched: no 10.5 MB fetch, no compile, no render,
 * and the panel shows the published file with its exact byte count. Of the 442
 * archived bases from the five entry points this panel offers, **265 are
 * reachable by setting these controls** — the other 177 need an `x` or `y` of 1
 * or a `LOCK` of `openlock_topless`, neither of which the file's own dropdowns
 * offer — and each shape opens on one of them, so the first paint costs nothing
 * at all. `panel.test.tsx` asserts the engine is not loaded on a hit, because
 * that is the claim and it would otherwise be invisible.
 *
 * ## One engine, one render at a time, and abandonment rather than abort
 *
 * The engine is loaded once per open panel and terminated on unmount, because
 * S2's 281 ms compile is paid per worker and S3 keeps the compiled module for
 * the worker's life. A render already inside `callMain` cannot be interrupted —
 * it is synchronous WebAssembly — so a superseded render is **abandoned**: its
 * promise rejects, the worker finishes unwatched, and the reply is dropped. That
 * is S3's documented behaviour and the right trade at ~100 ms a render;
 * terminating the worker would discard the compile and charge the next render
 * 281 ms.
 *
 * ## Two failures the exit code will not tell you about
 *
 * There is not one `assert()` in the vendored geometry: an invalid combination
 * `echo`es to stderr and emits **empty geometry with status 0**. So the
 * triangle count in the STL header is checked, and zero triangles is a failure
 * whatever the engine returned. And the two combinations the geometry refuses
 * outright — `dragonlock` or `infinitylock` on a non-inch basis, which
 * `bases-square.scad` guards with `echo("ERROR: dragonlock is only compatible
 * with inch basis")` — are preflighted here, with the file's own words, so the
 * render never starts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { EngineLicence, GeneratorEngine, Verification } from '../engine'
import { loadEngineLicence, loadGeneratorEngine, loadVerificationDescriber } from '../engine'

import type { BaseRecipe, RecipeValue } from './recipe'

/** Idle before a continuous control dispatches. §3.3, and S2's 250 ms finding. */
export const IDLE_MS = 350

/** The refusals in the geometry's own words, keyed by the `LOCK` they name. */
export const BASIS_REFUSALS: Readonly<Record<string, string>> = {
  dragonlock: 'ERROR: dragonlock is only compatible with inch basis',
  infinitylock: 'ERROR: infinitylock is only compatible with inch basis',
}

/** Triangle count from a binary STL header. Zero means the geometry refused. */
export function triangleCount(mesh: Uint8Array): number {
  if (mesh.byteLength < 84) return 0
  return new DataView(mesh.buffer, mesh.byteOffset, mesh.byteLength).getUint32(80, true)
}

/**
 * The preflight, which is the only cross-parameter rule this panel needs.
 *
 * The customizer annotations cannot express it — it lives in an `if`/`echo` at
 * the bottom of each `.scad` — so it is hand-written, and deliberately narrow:
 * two locks, one basis. Guessing at more of them would be inventing constraints
 * the geometry does not have.
 */
export function preflight(values: Readonly<Record<string, RecipeValue>>): string | null {
  const lock = values.LOCK
  const basis = values.SQUARE_BASIS
  if (typeof lock !== 'string' || typeof basis !== 'string' || basis === 'inch') return null
  return BASIS_REFUSALS[lock] ?? null
}

export type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'archived' }
  | { readonly status: 'refused'; readonly message: string }
  | { readonly status: 'loading' }
  | { readonly status: 'rendering' }
  | {
      readonly status: 'ready'
      readonly bytes: number
      readonly triangles: number
      readonly renderMs: number
      readonly bootMs: number
      readonly runs: number
      readonly md5: string
      readonly verification: string
      readonly mesh: Uint8Array
    }
  | { readonly status: 'failed'; readonly message: string; readonly output: readonly string[] }

export interface PreviewOptions {
  /** The recipe to render. `null` while nothing is selected. */
  readonly recipe: BaseRecipe | null
  /** True when the archive already publishes this recipe, so nothing renders. */
  readonly archived: boolean
  /** Injected by tests. Defaults to S3's lazy loader. */
  readonly load?: () => Promise<GeneratorEngine>
  readonly loadLicence?: () => Promise<EngineLicence>
  readonly loadDescriber?: () => Promise<(verification: Verification) => string>
}

export interface Preview {
  readonly state: PreviewState
  /**
   * The engine's licence, or `null` until it loads.
   *
   * Held here rather than fetched by the drawer because the engine refuses to
   * run without its notice present — `assertNoticePresent` throws at boot — so
   * the thing that displays the notice and the thing that runs the engine have
   * to be on the same clock.
   */
  readonly licence: EngineLicence | null
  /** Dispatch now, skipping the idle wait. For a discrete control. */
  readonly commit: () => void
}

export function usePreview(options: PreviewOptions): Preview {
  const { recipe, archived } = options
  const load = options.load ?? loadGeneratorEngine
  const licenceLoader = options.loadLicence ?? loadEngineLicence
  const describerLoader = options.loadDescriber ?? loadVerificationDescriber

  const [state, setState] = useState<PreviewState>({ status: 'idle' })
  const [licence, setLicence] = useState<EngineLicence | null>(null)
  const engine = useRef<Promise<GeneratorEngine> | null>(null)
  const inflight = useRef<AbortController | null>(null)
  const [tick, setTick] = useState(0)

  const key = recipe === null ? '' : `${recipe.entry} ${JSON.stringify(recipe.parameters)}`

  // Terminated on unmount, and only then: the compiled module is the expensive
  // thing and it lives in the worker.
  useEffect(() => {
    return () => {
      inflight.current?.abort()
      void engine.current?.then((instance) => {
        instance.terminate()
      })
      engine.current = null
    }
  }, [])

  const run = useCallback(
    async (target: BaseRecipe) => {
      const refusal = preflight(target.parameters)
      if (refusal !== null) {
        setState({ status: 'refused', message: refusal })
        return
      }

      inflight.current?.abort()
      const controller = new AbortController()
      inflight.current = controller

      setState((previous) => (previous.status === 'ready' ? { status: 'rendering' } : { status: 'loading' }))
      try {
        // The licence first, every time the engine is first needed. If it did
        // not ship, the engine would throw at boot anyway; loading it here means
        // the notice is on screen before a single byte of geometry is.
        if (licence === null) setLicence(await licenceLoader())
        engine.current ??= load()
        const [instance, describe] = await Promise.all([engine.current, describerLoader()])
        const mesh = await instance.render({
          entry: target.entry,
          parameters: target.parameters,
          signal: controller.signal,
        })
        if (controller.signal.aborted) return
        const triangles = triangleCount(mesh.bytes)
        if (triangles === 0) {
          setState({
            status: 'failed',
            message: 'the geometry produced an empty mesh, which OpenSCAD reports as success',
            output: mesh.diagnostics.notable.map((line) => line.text),
          })
          return
        }
        setState({
          status: 'ready',
          bytes: mesh.bytes.byteLength,
          triangles,
          renderMs: mesh.renderMs,
          bootMs: mesh.bootMs,
          runs: mesh.runs,
          md5: mesh.md5,
          // The wording is S3's, not this panel's. `self-addressed` is the
          // honest case here and its own sentence says why: the digest
          // "identifies these bytes rather than vouching for them".
          verification: describe(mesh.verification),
          mesh: mesh.bytes,
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          output: [],
        })
      }
    },
    [describerLoader, licence, licenceLoader, load],
  )

  useEffect(() => {
    if (recipe === null) {
      setState({ status: 'idle' })
      return
    }
    if (archived) {
      inflight.current?.abort()
      setState({ status: 'archived' })
      return
    }
    const timer = setTimeout(() => {
      void run(recipe)
    }, IDLE_MS)
    return () => {
      clearTimeout(timer)
    }
    // Three dependencies on purpose, and `run` is not one of them. `key` stands
    // in for the recipe's identity so an unchanged parameter set does not
    // re-dispatch on every render, `archived` is what turns the engine off
    // entirely, and `tick` is what `commit` bumps to skip the idle wait. `run`
    // closes over the loaders and the licence, all of which are stable for the
    // life of the panel; depending on it would restart the timer whenever the
    // licence arrived.
  }, [key, archived, tick])

  const commit = useCallback(() => {
    setTick((value) => value + 1)
  }, [])

  return useMemo(() => ({ state, licence, commit }), [state, licence, commit])
}

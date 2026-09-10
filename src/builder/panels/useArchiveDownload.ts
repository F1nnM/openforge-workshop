/**
 * The download button's state machine.
 *
 * `@/download` is four calls and every one of them can fail in a way the user
 * has to be told about specifically. This hook is where each typed error becomes
 * a sentence, and it is deliberately the *only* place in the builder that knows
 * about them — the panel renders {@link DownloadFailure}, which is prose plus a
 * kind, and never a raw `Error`.
 *
 * ## Every failure is distinct, and one of them is a real product limit
 *
 * | error | what the user is told | offer |
 * | --- | --- | --- |
 * | `IncompleteSceneError` | which slots are empty, and that a pack would be short | — |
 * | `EmptyArchiveError` | nothing is placed | — |
 * | `ArchiveTooLargeToBufferError` | this browser cannot stream a save, and the room is over the buffering limit | the room as several smaller archives, and the URL list plus `ATTRIBUTION.csv` |
 * | `NoSaveTargetError` | this browser offers no way to save a file | — |
 * | `BlobFetchError` | which file failed, and from where | retry |
 * | `PreviewMeshRefusedError` | the archive refused a URL that was not an original STL | — |
 * | `ArchiveLengthMismatchError` | the archive came out short or long and was **failed rather than saved** | retry |
 * | `ArchiveNamingError` | two entries could not be told apart | — |
 * | `GeneratedMeshMissingError` | which generated bases have no mesh, and that a reload always lands here | — |
 * | `GeneratedMeshRefusedError` | which of row S5's four mesh checks failed, in its own words | — |
 * | `GeneratedDigestCollisionError` | a generated digest equals a published file's | — |
 *
 * The last three are row S5's, and the first of them is the one that matters
 * most: **an incomplete bill fails the download rather than shipping a pack one
 * file short.** A short zip written in streaming mode opens cleanly, so nobody
 * would find out until a print failed. It is reachable in exactly the way a user
 * meets it — place a base, reload, press download — because the recipe persists
 * and the mesh does not.
 *
 * ## The same rule, for a hole between the lines — row A8
 *
 * `IncompleteSceneError` is the first row of the table and it is **this
 * module's**, not `@/download`'s, and that placement is the requirement rather
 * than a convenience. A template instance is three to five slots and each is
 * filled independently, so a scene can be missing a file *between* two bill
 * lines: `buildBillOfTiles` reports it as `BillOfTiles.complete` plus a list of
 * `unfilled` slots, and `src/download/**` structurally cannot see it — a plan is
 * built from lines, and a hole is the absence of one. So the gate has to be here,
 * at the only point that holds the bill.
 *
 * **Every slot of every recipe in the build is required**: `PartSlot.optional` is
 * absent from all 128 parts of the 40 shipped templates, and absence means
 * required. So there is no scene for which an empty slot is an acceptable pack,
 * and the refusal has no exemption to make. §3.2 still places the instance
 * anyway — the grid accepts an incomplete recipe, the *zip* does not — which is
 * the same split row S5 made for a generated base with no mesh.
 *
 * Thrown before the pack module is loaded and before a byte is fetched, for the
 * reason the too-large check is raised early: there is nothing to discover later
 * that could change the answer.
 *
 * The too-large case is checked **before a byte is fetched**, not only caught
 * from `saveArchive`. `save.ts` refuses at 512 MB when there is no
 * `showSaveFilePicker` — iOS Safari, always — and discovering that after
 * downloading 900 MB over a phone connection would be the worst possible time to
 * find out. The error is the same type either way, so there is one branch in the
 * UI; it is just raised earlier. `saveArchive`'s own check stays as the backstop.
 *
 * ## The too-large refusal has an answer now, and it is pressed once per part
 *
 * `splitArchivePlans` bin-packs the bill into several archives, each under the
 * browser's buffering ceiling, so the refusal above carries **{@link
 * DownloadFailure.splitPlans}** whenever a packing exists — the URL list stops
 * being the only thing left to offer. When a single file is already over the
 * limit the split raises `ArchivePartTooLargeError`, splitting cannot help, and
 * the failure is exactly what it was before: the URL list, unchanged.
 *
 * **One press per part, never a sequence.** Firing N `showSaveFilePicker` or
 * Blob saves back to back with no fresh user gesture between them is precisely
 * the shape browsers popup-block, so each part is its own button: pressing it
 * saves that part and, on success, offers the next.
 *
 * The parts live on {@link ArchiveDownload.splitPlans} rather than only inside
 * the failure, because the failure is gone by the time the second part is
 * needed — saving part 1 moves `state` to `'saved'`. They are cleared by
 * {@link ArchiveDownload.dismiss} and by a fresh {@link ArchiveDownload.start}.
 *
 * ## A cancellation is not a failure
 *
 * A dismissed file picker and a pressed Cancel both land back on `idle`. Users
 * report a "download failed" message for a download they cancelled, and they are
 * right to.
 *
 * ## Why `environment` and `source` are injectable
 *
 * They are the two seams `@/download` already publishes — `saveArchive` takes a
 * {@link SaveEnvironment} and `openArchiveStream` takes a {@link BlobSource} —
 * and this hook passes them straight through. That is what lets the component
 * tests drive all seven rows of the table above without a network and without a
 * browser that can save a file. Production passes neither and gets R2 plus the
 * real browser.
 */
import { useCallback, useMemo, useRef, useState } from 'react'

import type { BillOfTiles, UnfilledSlot } from '@/assembly'
import type { CatalogAssets } from '@/catalog'
import type { ArchivePlan, BlobSource, GeneratedArchiveSection, SaveEnvironment, SaveVia } from '@/download'
import {
  ArchiveLengthMismatchError,
  ArchiveNamingError,
  ArchivePartTooLargeError,
  ArchiveTooLargeToBufferError,
  BLOB_FALLBACK_LIMIT_BYTES,
  BlobFetchError,
  EmptyArchiveError,
  GeneratedDigestCollisionError,
  NoSaveTargetError,
  PreviewMeshRefusedError,
  browserSaveEnvironment,
  buildArchivePlan,
  openArchiveStream,
  r2BlobSource,
  saveArchive,
  splitArchivePlans,
  urlListFilename,
  urlListText,
} from '@/download'
import type { GeneratedBill } from '@/generator/placement/bill'
// A type-only namespace import, which is erased — the same device row S5's
// `pack.ts` uses to name `./notice` without carrying it. It is `import type` and
// not `typeof import(...)` because the lint rule forbids the latter, and the two
// mean the same thing.
import type * as GeneratedPackModule from '@/generator/placement/pack'
import type { GeneratedMeshHoldings } from '@/generator/placement/pack'

/**
 * Which part of a split download this is.
 *
 * Absent from a state entirely when the download is the whole room in one file,
 * which is every download that is not a split one — so a component can branch
 * on its presence rather than on a sentinel index.
 */
export interface PartInfo {
  /** 0-based. */
  readonly index: number
  readonly of: number
}

/**
 * The scene has a declared slot with no file in it, so no pack of it is
 * printable.
 *
 * Declared here rather than in `@/download` because the fact is the bill's and
 * the bill is this module's argument: `src/download/**` builds a plan from
 * `BillLine`s and a hole is the absence of one, so nothing there can raise it.
 * See the module note.
 *
 * It carries the holes rather than a count, because the sentence a user can act
 * on names the recipe and the slot — *"the base slot of a wall-on-tile corner"* —
 * and a bare "3 slots are empty" sends them to look at a drawing that is one tab
 * stop.
 */
export class IncompleteSceneError extends Error {
  readonly unfilled: readonly UnfilledSlot[]

  constructor(unfilled: readonly UnfilledSlot[]) {
    super(
      `${String(unfilled.length)} declared ${unfilled.length === 1 ? 'slot has' : 'slots have'} no file in ` +
        'it, so this pack would be short of a printable model.',
    )
    // Assigned rather than declared as a parameter property, and the field is
    // spelled above: `erasableSyntaxOnly` is on, so a parameter property is a
    // compile error — it is the one piece of TypeScript syntax in a class body
    // that emits code. `download/save.ts`'s own errors are written the same way.
    this.name = 'IncompleteSceneError'
    this.unfilled = unfilled
  }
}

/**
 * Row S5's pack module, loaded on the press rather than imported.
 *
 * The type is a namespace `typeof import(...)`, which is erased, so **nothing in
 * `pack.ts` is in the entry chunk** — not the md5 implementation, not the STL
 * parser, and not the 11 KB of Apache-2.0 licence text one dynamic import
 * further on. S5's own table projected +5,260 B raw / +2,101 B gzipped for
 * wiring this statically from here, and this is what that buys back.
 *
 * It is loaded even for a download with no generated bases in it, one `await` on
 * a press that is about to fetch megabytes, and that is the deliberate simple
 * choice: the alternative is two code paths through `start`, one of which never
 * gets exercised by a test that has a generated base in the scene.
 */
type GeneratedPack = typeof GeneratedPackModule

/** Which failure this is, for the panel's own branching. Prose is in the object. */
export type DownloadFailureKind =
  | 'empty'
  | 'incomplete'
  | 'too-large'
  | 'no-save-target'
  | 'fetch'
  | 'refused'
  | 'length-mismatch'
  | 'naming'
  | 'unrendered'
  | 'mesh-refused'
  | 'digest-collision'
  | 'unknown'

export interface DownloadFailure {
  readonly kind: DownloadFailureKind
  readonly headline: string
  readonly detail: string
  /** Whether pressing the button again could plausibly work. */
  readonly retryable: boolean
  /**
   * The plan the failure happened on, when there is one.
   *
   * Present for the too-large case, which is the one where the plan is still the
   * answer: it holds the URL list and the attribution table.
   */
  readonly plan?: ArchivePlan
  /**
   * What the URL list cannot represent, or absent when it can represent
   * everything.
   *
   * Row S5's `urlListShortfall`, evaluated here rather than in the component,
   * and that is a bundle decision with a measurement behind it: the function
   * lives in `pack.ts`, so a component importing it statically would put the md5
   * implementation, the STL parser and — one dynamic import on — the Apache-2.0
   * licence text back in the entry chunk, which is exactly what
   * {@link GeneratedPack} exists to avoid. The hook already has the module
   * loaded at this point, so the sentence costs nothing here and the component
   * renders a string.
   *
   * It is on the failure rather than on the state because the only path that
   * offers the URL list is the too-large failure. §11's degradation path has
   * nothing to offer a mesh that was never on R2, and this is the sentence that
   * says so instead of letting it be a silent omission.
   */
  readonly urlListShortfall?: string
  /**
   * Split alternatives to the too-large plan, one archive each under the
   * browser's buffering ceiling — present exactly when
   * {@link ArchiveTooLargeToBufferError} fired and `splitArchivePlans` found a
   * packing. Absent when a single file is already over the limit
   * (`ArchivePartTooLargeError`): splitting cannot help that case, and the URL
   * list is the only offer left.
   */
  readonly splitPlans?: readonly ArchivePlan[]
}

export type DownloadState =
  | { readonly status: 'idle' }
  /** A plan exists and the picker may be open; nothing is being fetched yet. */
  | { readonly status: 'preparing'; readonly plan: ArchivePlan; readonly part?: PartInfo }
  | {
      readonly status: 'running'
      readonly plan: ArchivePlan
      readonly part?: PartInfo
      readonly bytesWritten: number
      /** Entries begun, licensing files included. */
      readonly entriesStarted: number
      readonly entries: number
      /** The entry being written, for a line under the bar. */
      readonly entry: string | undefined
    }
  | {
      readonly status: 'saved'
      readonly bytes: number
      readonly filename: string
      readonly via: SaveVia
      readonly part?: PartInfo
    }
  | { readonly status: 'failed'; readonly failure: DownloadFailure }

export interface ArchiveDownload {
  readonly state: DownloadState
  /** Build a plan, open the stream and save it. A no-op while one is in flight. */
  readonly start: () => void
  /** Abort an in-flight download. Lands on `idle`, not on a failure. */
  readonly cancel: () => void
  /** Clear a finished or failed run so the button reads as an action again. */
  readonly dismiss: () => void
  /**
   * §11's degradation path: the model URLs as a text file, **and** the
   * attribution table beside it.
   *
   * Both, always. §10's obligation does not lapse because the transport changed,
   * and the URL list carries no attribution of its own — every file in it lands
   * under its md5, so `ATTRIBUTION.csv` is the only route back to a readable name.
   */
  readonly saveUrlList: () => void
  /**
   * Split alternatives from the current or most recent too-large failure.
   * Cleared by {@link ArchiveDownload.dismiss} and by a fresh
   * {@link ArchiveDownload.start}. `undefined` outside that flow.
   */
  readonly splitPlans: readonly ArchivePlan[] | undefined
  /** Save one part of {@link ArchiveDownload.splitPlans}. A no-op while a save is in flight. */
  readonly saveSplitPart: (index: number) => void
}

/** The generated half of a download: the bill's rows and the bytes behind them. */
export interface GeneratedDownload {
  readonly bill: GeneratedBill
  readonly holdings: GeneratedMeshHoldings
}

export interface ArchiveDownloadOptions {
  readonly bill: BillOfTiles
  readonly assets: Pick<CatalogAssets, 'models'>
  /**
   * Row S5's generated bases, or absent for a pack of catalog files only.
   *
   * Two things rather than one, and they are separate because they answer
   * separate questions and can disagree — which is the whole reason the pack
   * refuses. The **bill** says what is on the plan; the **holdings** say what has
   * bytes. A base in the first and not the second is a placed-but-unrendered
   * base, and `buildGeneratedPack` fails the download over it rather than
   * shipping a pack one file short. Handing over one merged structure would have
   * made that state unrepresentable and the refusal unreachable.
   */
  readonly generated?: GeneratedDownload
  /** Injected by tests; production probes the browser. */
  readonly environment?: SaveEnvironment
  /** Injected by tests; production fetches from R2. */
  readonly source?: BlobSource
  /** Injected by tests; production loads row S5's pack module on the press. */
  readonly loadPack?: () => Promise<GeneratedPack>
}

export function useArchiveDownload({
  bill,
  assets,
  generated,
  environment,
  source,
  loadPack,
}: ArchiveDownloadOptions): ArchiveDownload {
  const [state, setState] = useState<DownloadState>({ status: 'idle' })
  /**
   * The parts of a split download, for as long as one is being worked through.
   *
   * Alongside {@link DownloadState} rather than inside it: saving part 1 moves
   * `state` off the `'failed'` variant these first appeared on, and the panel
   * still has to know there is a part 2. See the module note.
   */
  const [splitPlans, setSplitPlans] = useState<readonly ArchivePlan[] | undefined>(undefined)
  const abort = useRef<AbortController | null>(null)
  /** Guards re-entry: a second click while a stream is open would fetch twice. */
  const running = useRef(false)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    running.current = false
    setState({ status: 'idle' })
  }, [])

  const dismiss = useCallback(() => {
    setState({ status: 'idle' })
    setSplitPlans(undefined)
  }, [])

  /**
   * Open the stream for one plan and save it — the whole room, or one part.
   *
   * Shared by {@link start} and `saveSplitPart` so a part is saved by exactly
   * the code path the whole room is, `PartInfo` threaded through the three
   * states it labels. `'cancelled'` rather than a `setState` of its own,
   * because the two callers land a dismissed picker on `idle` themselves and
   * this is the one decision they do not share.
   */
  const runSave = useCallback(
    async (
      plan: ArchivePlan,
      packSource: BlobSource,
      controller: AbortController,
      part?: PartInfo,
    ): Promise<'saved' | 'cancelled'> => {
      // `exactOptionalPropertyTypes` is on: spreading `{}` is how `part` is left
      // absent rather than explicitly `undefined`. Same device as `shortfallOf`.
      const partField = part === undefined ? {} : { part }
      setState({ status: 'preparing', plan, ...partField })
      const host = environment ?? browserSaveEnvironment()
      const stream = openArchiveStream(plan, {
        source: packSource,
        signal: controller.signal,
        onProgress: (progress) => {
          setState({
            status: 'running',
            plan,
            ...partField,
            bytesWritten: progress.bytesWritten,
            entriesStarted: progress.entriesStarted,
            entries: progress.entries,
            entry: progress.entry?.name,
          })
        },
      })

      const result = await saveArchive(plan, stream, host)
      if (result.outcome === 'cancelled') return 'cancelled'
      setState({
        status: 'saved',
        bytes: result.bytes,
        filename: result.filename,
        via: result.via,
        ...partField,
      })
      return 'saved'
    },
    [environment],
  )

  const start = useCallback(() => {
    if (running.current) return
    running.current = true

    const controller = new AbortController()
    abort.current = controller

    void (async () => {
      // A new run, so the previous run's parts are no longer on offer. Inside
      // the IIFE rather than above the re-entry guard: a press ignored because
      // one is already in flight must not clear what is on screen.
      setSplitPlans(undefined)
      let plan: ArchivePlan | undefined
      let pack: GeneratedPack | undefined
      try {
        // **The hole between the lines, refused first.** Before the pack module
        // is loaded, before a plan exists and before a byte is fetched: nothing
        // discovered later can change the answer, and the two facts it reads are
        // already computed. See the module note for why this cannot live in
        // `@/download`.
        if (!bill.complete) throw new IncompleteSceneError(bill.unfilled)

        // Loaded before the plan, because the plan needs the section. Held in
        // `pack` for `classify` below: the three refusals this module carries
        // are `instanceof` checks against classes that live inside this chunk,
        // and a `generatedBlobSource` refusal can arrive *during* the stream, in
        // the outer catch. Passing the module rather than re-importing it there
        // is what keeps every branch an `instanceof` and lets the two errors that
        // carry data — the unrendered recipe handles, the offending digest — be
        // read off the class.
        pack = await (loadPack ?? loadGeneratedPack)()
        const section = await generatedSection(pack, generated)

        plan = buildArchivePlan(bill, { assets, ...(section === undefined ? {} : { generated: section }) })

        const host = environment ?? browserSaveEnvironment()
        const limit = host.blobLimitBytes ?? BLOB_FALLBACK_LIMIT_BYTES
        // Refused before the first fetch rather than after the last one. See the
        // module note; `saveArchive` checks this too and stays the backstop.
        if (host.showSaveFilePicker === undefined && plan.predictedLength > limit) {
          let parts: readonly ArchivePlan[] | undefined
          try {
            parts = splitArchivePlans(bill, {
              assets,
              generatedAt: plan.generatedAt,
              limitBytes: limit,
              ...(section === undefined ? {} : { generated: section }),
            })
          } catch (splitError) {
            // A single file already exceeds the limit — splitting cannot help,
            // so the failure below carries no parts and the URL list is the
            // only offer, exactly as it was before splitting existed.
            if (!(splitError instanceof ArchivePartTooLargeError)) throw splitError
          }
          setSplitPlans(parts)
          setState({
            status: 'failed',
            failure: classify(new ArchiveTooLargeToBufferError(plan.predictedLength, limit), plan, pack, parts),
          })
          return
        }

        const openPlan = plan
        // The composition is what lets `stream.ts` stay untouched: it asks for
        // bytes by content address, and this answers for the digests the pack
        // named as generated and falls through for everything else. The fallback
        // is the injected source in a test and R2 in production, so a room mixing
        // catalogued tiles and generated bases exercises both halves.
        const blobs = source ?? r2BlobSource(assets)
        const packSource = generated === undefined ? blobs : pack.generatedBlobSource(generated.holdings, blobs)
        const outcome = await runSave(openPlan, packSource, controller)
        if (outcome === 'cancelled') {
          setState({ status: 'idle' })
          return
        }
      } catch (error) {
        if (controller.signal.aborted) {
          setState({ status: 'idle' })
          return
        }
        setState({ status: 'failed', failure: classify(error, plan, pack) })
      } finally {
        running.current = false
        abort.current = null
      }
    })()
  }, [assets, bill, environment, generated, loadPack, runSave, source])

  /**
   * Save one part of a split download.
   *
   * Row-by-row rather than a loop: each part needs its own user gesture, or the
   * second `showSaveFilePicker` is popup-blocked. See the module note.
   *
   * The pack module is loaded again here rather than held from `start`, and only
   * when the part actually carries a generated mesh — an all-catalog part costs
   * no dynamic import at all. It is then **held for `classify`**, for the same
   * reason `start` holds it: `generatedBlobSource.open` re-checks every hold at
   * stream time and can raise `GeneratedMeshRefusedError` *during* the save, and
   * every branch for row S5's three errors is an `instanceof` against a class
   * that lives inside `pack.ts`. Passing `undefined` there would degrade a
   * refused mesh to the generic "the download failed" — and mark it retryable,
   * which it is not: retrying ships the same bytes.
   */
  const saveSplitPart = useCallback(
    (index: number) => {
      if (running.current) return
      const plan = splitPlans?.[index]
      if (plan === undefined) return
      running.current = true

      const controller = new AbortController()
      abort.current = controller
      const of = splitPlans?.length ?? 0

      void (async () => {
        let pack: GeneratedPack | undefined
        try {
          const blobs = source ?? r2BlobSource(assets)
          let packSource: BlobSource = blobs
          if (plan.generated.length > 0 && generated !== undefined) {
            pack = await (loadPack ?? loadGeneratedPack)()
            packSource = pack.generatedBlobSource(generated.holdings, blobs)
          }
          const outcome = await runSave(plan, packSource, controller, { index, of })
          if (outcome === 'cancelled') setState({ status: 'idle' })
        } catch (error) {
          if (controller.signal.aborted) {
            setState({ status: 'idle' })
            return
          }
          setState({ status: 'failed', failure: classify(error, plan, pack) })
        } finally {
          running.current = false
          abort.current = null
        }
      })()
    },
    [assets, generated, loadPack, runSave, source, splitPlans],
  )

  const saveUrlList = useCallback(() => {
    const plan = state.status === 'failed' ? state.failure.plan : undefined
    if (plan === undefined) return
    saveText(urlListFilename(plan), urlListText(plan), 'text/plain')
    for (const entry of plan.entries) {
      if (entry.kind === 'text' && entry.name.endsWith('.csv')) saveText('ATTRIBUTION.csv', entry.text, 'text/csv')
    }
  }, [state])

  return useMemo(
    () => ({ state, start, cancel, dismiss, saveUrlList, splitPlans, saveSplitPart }),
    [state, start, cancel, dismiss, saveUrlList, splitPlans, saveSplitPart],
  )
}

/* ---------------------------------------------------------------- classifying */

/**
 * One error, one message.
 *
 * `instanceof` per type rather than a switch on `error.name`: every one of these
 * is exported from `@/download` and thrown in the same realm, and the two that
 * carry data — the size and the limit, the expected and actual byte counts — are
 * only readable through the class.
 */
/**
 * Row S5's pack, loaded lazily. See {@link GeneratedPack}.
 *
 * A named function rather than an inline arrow so the `??` default above is
 * stable across renders and `start`'s `useCallback` is not invalidated by it.
 */
function loadGeneratedPack(): Promise<GeneratedPack> {
  return import('@/generator/placement/pack')
}

/**
 * The generated half of the plan, or `undefined` when there is none.
 *
 * `undefined` for an absent option **and** for a bill with no rows, which is not
 * the same thing said twice: a builder that has never opened the generator
 * passes nothing, and a builder that placed a base and then removed it passes an
 * empty bill. Both must produce a pack with no `generated/` subtree and no
 * `GENERATED.txt` — `plan.ts` refuses a section whose meshes are empty of
 * nothing in particular, and an archive carrying a notice about zero meshes
 * would be stating a licence obligation it does not have.
 */
async function generatedSection(
  pack: GeneratedPack,
  generated: GeneratedDownload | undefined,
): Promise<GeneratedArchiveSection | undefined> {
  if (generated === undefined || generated.bill.lines.length === 0) return undefined
  return pack.buildGeneratedPack(generated.bill, generated.holdings)
}

function classify(
  error: unknown,
  plan: ArchivePlan | undefined,
  pack: GeneratedPack | undefined,
  splitPlans?: readonly ArchivePlan[],
): DownloadFailure {
  if (pack !== undefined && error instanceof pack.GeneratedMeshMissingError) {
    return {
      kind: 'unrendered',
      headline:
        error.recipes.length === 1
          ? 'One generated base has not been rendered'
          : `${String(error.recipes.length)} generated bases have not been rendered`,
      detail:
        `${error.recipes.join(', ')} — on the plan with no mesh behind ${error.recipes.length === 1 ? 'it' : 'them'}. ` +
        'A pack that left them out would be one file short and would still open, so nothing was saved. ' +
        'Open the generator on each one to render it, or take it off the plan. A reload always lands here: ' +
        'the recipe is saved and the mesh is not, because a mesh is megabytes and is only valid for the ' +
        'engine build that made it.',
      retryable: false,
    }
  }

  if (pack !== undefined && error instanceof pack.GeneratedMeshRefusedError) {
    return {
      kind: 'mesh-refused',
      headline: 'A generated mesh was refused',
      detail: `${error.message} Re-render it in the generator panel.`,
      // Never retryable, and S5's class says so in its own name: retrying ships
      // the same bytes.
      retryable: false,
    }
  }

  if (error instanceof GeneratedDigestCollisionError) {
    return {
      kind: 'digest-collision',
      headline: 'A generated mesh collides with a published file',
      detail: `${error.message} Change any parameter on the generated base and it clears.`,
      retryable: false,
    }
  }

  if (error instanceof IncompleteSceneError) {
    /*
      **An accessory hole is a different sentence and a different repair.** A
      fill's own file can declare slots — the door of a doorway, the torch of a
      socket — and 1,047 of the 1,244 declarations in the archive are required,
      so a scene can be refused with every slot *on the plan* filled. Naming that
      hole `wall` and telling the user to fill the wall points at the one thing
      that is not empty; `unfilledSentence` names the pair instead, and the two
      sentences below change with it.

      Counted rather than switched on the first hole, because a scene can hold
      both kinds at once: the noun narrows to "accessory slot" only when every
      hole is one, and the repair clause is added whenever any hole is.
    */
    const accessories = error.unfilled.filter((hole) => hole.hold !== undefined).length
    const onlyAccessories = accessories === error.unfilled.length
    return {
      kind: 'incomplete',
      headline:
        error.unfilled.length === 1
          ? `One ${onlyAccessories ? 'accessory slot' : 'slot on the plan'} is still empty`
          : `${String(error.unfilled.length)} ${onlyAccessories ? 'accessory slots' : 'slots on the plan'} are still empty`,
      detail:
        `${unfilledSentence(error.unfilled)} Every slot of every recipe in this build is required` +
        (accessories === 0
          ? ''
          : ', and so is most of what the tiles themselves declare — 1,047 of the 1,244 accessory slots in the ' +
            'archive') +
        ', so a pack without them would be short of a printable model — and a streamed zip records its sizes at ' +
        'the end, so a short one still opens and nobody would find out until the print failed. Nothing was saved. ' +
        (accessories === 0
          ? 'Fill each slot, or take the piece off the grid.'
          : 'Fill each one — an accessory in the slot editor of the piece holding it — or take the piece off the ' +
            'grid.'),
      retryable: false,
    }
  }

  if (error instanceof EmptyArchiveError) {
    return {
      kind: 'empty',
      headline: 'Nothing to download',
      detail: 'Place a tile first — an archive holding only a licence is not a result.',
      retryable: false,
    }
  }

  if (error instanceof ArchiveTooLargeToBufferError) {
    return {
      kind: 'too-large',
      headline: `Too large for this browser to save in one file`,
      detail:
        `This room is ${sizeLabel(error.bytes)} and this browser has no streaming save, so it would have to hold ` +
        `the whole archive in memory — the limit is ${sizeLabel(error.limit)}. ` +
        (splitPlans === undefined
          ? 'Take the URL list instead and feed it to a download manager, or build the room in sections.'
          : `Save it as ${String(splitPlans.length)} smaller archives instead, or take the URL list.`),
      retryable: false,
      ...(plan === undefined ? {} : { plan }),
      ...(splitPlans === undefined ? {} : { splitPlans }),
      ...shortfallOf(plan, pack),
    }
  }

  if (error instanceof NoSaveTargetError) {
    return {
      kind: 'no-save-target',
      headline: 'This browser cannot save a file',
      detail:
        'Neither a file picker nor a download link is available here. Open the builder in a normal browser tab ' +
        'and try again.',
      retryable: false,
    }
  }

  if (error instanceof BlobFetchError) {
    return {
      kind: 'fetch',
      headline: 'A model could not be fetched',
      detail: `${error.url} did not return the file. Nothing was saved. ${error.message}`,
      retryable: true,
    }
  }

  if (error instanceof PreviewMeshRefusedError) {
    return {
      kind: 'refused',
      headline: 'The archive refused a file',
      detail:
        `${error.url} is not the original STL the index measured, so it was not put in the archive. This is a ` +
        'storage problem rather than something you can retry around.',
      retryable: false,
    }
  }

  if (error instanceof ArchiveLengthMismatchError) {
    return {
      kind: 'length-mismatch',
      headline: 'The archive came out the wrong size',
      detail:
        `Expected exactly ${sizeLabel(error.expected)} and got ${sizeLabel(error.actual)}. The download was ` +
        'failed rather than saved: a streamed zip records its sizes at the end, so a truncated one still opens ' +
        'and one of the meshes inside it would be corrupt.',
      retryable: true,
    }
  }

  if (error instanceof ArchiveNamingError) {
    return {
      kind: 'naming',
      headline: 'Two files could not be told apart',
      detail: `${error.message} Nothing was saved.`,
      retryable: false,
    }
  }

  return {
    kind: 'unknown',
    headline: 'The download failed',
    detail: error instanceof Error ? error.message : String(error),
    retryable: true,
  }
}

/**
 * The URL-list shortfall as a spreadable fragment, or `{}`.
 *
 * `exactOptionalPropertyTypes` is on, so an explicitly `undefined` property is
 * not the same as an absent one; spreading `{}` is how an optional field is left
 * absent. Empty when there is no plan (the failure happened before one existed),
 * when the pack module never loaded, or when the plan holds no generated mesh —
 * in which case `urlListShortfall` itself returns `null` and there is nothing to
 * disclose.
 */
function shortfallOf(
  plan: ArchivePlan | undefined,
  pack: GeneratedPack | undefined,
): { urlListShortfall?: string } {
  if (plan === undefined || pack === undefined) return {}
  const sentence = pack.urlListShortfall(plan)
  return sentence === null ? {} : { urlListShortfall: sentence }
}

/**
 * The holes, named — at most three of them, then a count.
 *
 * Three because the failure block is prose in a 302px column and the list is
 * unbounded: a fifty-instance room with one empty slot each would otherwise be a
 * hundred and fifty recipe names. A slot is `undefined` for an instance whose
 * whole recipe is unknown, which is a different sentence and is spelled as one.
 *
 * **A hole one level down names the pair** — `recipe: wall › door`, *the door of
 * the wall of this piece*. Without it a doorway refused for its empty `door`
 * slot would be reported as `recipe: wall`, which is a slot the user has
 * filled, and the only actionable half of the sentence would be the wrong half.
 */
function unfilledSentence(unfilled: readonly UnfilledSlot[]): string {
  const named = unfilled
    .slice(0, 3)
    .map((hole) => `${hole.template}${slotSuffix(hole)}`)
  const rest = unfilled.length - named.length
  return `${named.join('; ')}${rest > 0 ? `; and ${String(rest)} more` : ''}.`
}

/** ` (no such recipe in this build)`, `: wall`, or `: wall › door`. */
function slotSuffix(hole: UnfilledSlot): string {
  if (hole.slot === undefined) return ' (no such recipe in this build)'
  return hole.hold === undefined ? `: ${hole.slot}` : `: ${hole.slot} › ${hole.hold}`
}

/** Bytes as the panel spells them. Decimal, one place — the corpus's own convention. */
function sizeLabel(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * Hand a text file to the download manager.
 *
 * The same anchor trick `save.ts` uses for the blob path, and for the same
 * reason: there is no other way to produce a file from a static site. Revoked on
 * the next task rather than immediately — revoking in the same tick as the click
 * cancels the download in Safari.
 */
function saveText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

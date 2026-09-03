/**
 * The worker protocol, as data.
 *
 * Split out from both sides for the reason `src/three/stl/protocol.ts` gives:
 * the thing that is easy to get wrong should be the thing that is unit-tested.
 * Here that is two things.
 *
 * **The mesh must be transferred, not copied.** A 4×4 base is ~324 KB and a
 * large curve considerably more; `postMessage` without a transfer list
 * structured-clones the buffer, allocating and memcpying it a second time on the
 * receiving thread at the moment the main thread is about to hand it to the STL
 * parser. `renderedResponse` returns the transfer list with the message so the
 * two cannot drift apart.
 *
 * **Every message carries an id.** The STL parser can get away with one
 * in-flight request because a viewer shows one mesh; a parameter panel with
 * auto-preview cannot. Two renders queued behind one another and correlated only
 * by arrival order will silently swap results the first time one of them is
 * abandoned. Ids make that a lookup rather than an assumption.
 *
 * Nothing in this module imports the engine, the glue or the geometry, so the
 * main thread can hold the types without pulling 10.5 MB behind them.
 */
import type { ExportFormat, ParameterAssignment } from './args'
import type { Diagnostics } from './diagnostics'
import type { ParameterSchema } from './schema'
import type { Verification } from './verify'
import type { EngineVersion } from './version'

/** Correlates a reply with its request. Monotonic within one client. */
export type RequestId = number

interface Envelope {
  readonly id: RequestId
}

/** Read the engine's own version and source commit. */
export interface VersionRequest extends Envelope {
  readonly type: 'version'
}

/** Derive one entry point's parameter schema from `--export-format=param`. */
export interface SchemaRequest extends Envelope {
  readonly type: 'schema'
  readonly entry: string
}

export interface RenderRequest extends Envelope {
  readonly type: 'render'
  readonly entry: string
  readonly parameters: Readonly<Record<string, ParameterAssignment>>
  readonly format?: ExportFormat
  /**
   * The index's `blob` for the base S4's resolver matched, when it matched one.
   * Supplying it is what turns the digest from a content address into an
   * integrity check — see `verify.ts`.
   */
  readonly expectedMd5?: string
}

export type EngineRequest = VersionRequest | SchemaRequest | RenderRequest

export interface VersionResponse extends Envelope {
  readonly type: 'version'
  readonly version: EngineVersion
  /** `WebAssembly.compile` time, ms. Paid once for the worker's lifetime. */
  readonly compileMs: number
}

export interface SchemaResponse extends Envelope {
  readonly type: 'schema'
  readonly schema: ParameterSchema
  readonly diagnostics: Diagnostics
  readonly renderMs: number
}

export interface RenderedResponse extends Envelope {
  readonly type: 'rendered'
  /** The mesh. Transferred, so the worker no longer holds it. */
  readonly mesh: ArrayBuffer
  /** MD5 of `mesh`, computed in the worker so the main thread never hashes. */
  readonly md5: string
  /**
   * What that digest did and did not establish. Carried as a value rather than
   * left to the caller to infer, because the three cases are not
   * interchangeable and `verify.ts` is where the distinction is argued.
   */
  readonly verification: Verification
  readonly diagnostics: Diagnostics
  /** Time inside `callMain`, ms. */
  readonly renderMs: number
  /** Time to instantiate the fresh module, ms. The per-render fixed cost. */
  readonly bootMs: number
  /** How many renders this worker has served. 1 means the compile was not reused. */
  readonly runs: number
}

export interface FailedResponse extends Envelope {
  readonly type: 'failed'
  readonly kind: EngineFailure
  readonly message: string
  /** Present when the engine ran and complained. Absent when it never started. */
  readonly diagnostics?: Diagnostics
}

/**
 * Why a request failed, coarsely enough to act on.
 *
 * `geometry` is the case worth naming: OpenSCAD's documented refusal path is an
 * `echo("ERROR: …")` with **no mesh and a zero status**, which S1 recorded for
 * `dragonlock` or `infinitylock` combined with a non-inch `SQUARE_BASIS`. A
 * client that only checked for a thrown error would show a spinner for ever.
 */
export type EngineFailure =
  /** The argv was rejected before anything booted — a missing backend flag, a `$` name. */
  | 'arguments'
  /** The binary did not hash to the vendored one, or the notice did not ship. */
  | 'integrity'
  /** The engine ran and emitted `ERROR:`, or produced no output file. */
  | 'geometry'
  /** `--export-format=param` produced something unparseable. */
  | 'schema'
  /** The worker died, or something unclassifiable happened. */
  | 'internal'
  /** The caller abandoned the request. */
  | 'aborted'

export type EngineResponse = VersionResponse | SchemaResponse | RenderedResponse | FailedResponse

/** A message and the transfer list it must be posted with. */
export interface Posted<T> {
  readonly message: T
  readonly transfer: readonly Transferable[]
}

/**
 * Build the render reply, moving the mesh out of the worker.
 *
 * Takes a `Uint8Array` and posts its buffer, so the caller cannot accidentally
 * post the view (which clones) instead of the buffer (which transfers). The
 * array is assumed to own its buffer exactly — `FS.readFile` returns a fresh
 * one, so it does.
 */
export function renderedResponse(
  id: RequestId,
  mesh: Uint8Array,
  rest: Omit<RenderedResponse, 'type' | 'id' | 'mesh'>,
): Posted<RenderedResponse> {
  const buffer = mesh.buffer as ArrayBuffer
  return { message: { type: 'rendered', id, mesh: buffer, ...rest }, transfer: [buffer] }
}

/** Build a failure reply. Nothing to transfer. */
export function failedResponse(
  id: RequestId,
  kind: EngineFailure,
  error: unknown,
  diagnostics?: Diagnostics,
): Posted<FailedResponse> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    message: diagnostics === undefined ? { type: 'failed', id, kind, message } : { type: 'failed', id, kind, message, diagnostics },
    transfer: [],
  }
}

/**
 * Map a thrown error to a failure kind by its `name`.
 *
 * By name rather than `instanceof` because this runs on both sides of a worker
 * boundary and the classes are not shared across it.
 */
export function failureKind(error: unknown): EngineFailure {
  const name = error instanceof Error ? error.name : ''
  switch (name) {
    case 'EngineArgsError':
      return 'arguments'
    case 'EngineIntegrityError':
    case 'EngineLicenceError':
      return 'integrity'
    case 'ParameterSchemaError':
      return 'schema'
    default:
      return 'internal'
  }
}

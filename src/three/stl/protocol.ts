/**
 * The worker protocol, as data — and the transfer list, as a return value.
 *
 * Split out from both the worker and its client so the thing that is easy to get
 * wrong is the thing that is unit-tested: **the positions array must be
 * transferred, not copied.** `postMessage(message)` without a transfer list
 * structured-clones the buffer, which for a mesh at the gate is an extra 18.1 MB
 * allocated and 18.1 MB memcpy'd on the *receiving* thread, at the exact moment
 * the main thread is about to build a geometry. It is invisible — the app works,
 * it just stutters — so it is asserted instead of assumed
 * (`protocol.test.ts` checks the buffer is detached afterwards, which is the
 * only observable difference between a transfer and a copy).
 */
import type { ParsedStl, StlFormat, StlParseErrorKind } from './parse'

/** Main thread → worker. The buffer is transferred in, so the caller loses it. */
export interface ParseRequest {
  readonly type: 'parse'
  /** The STL bytes. Transferred, so this is the last reference the sender has. */
  readonly bytes: ArrayBuffer
}

/** Worker → main thread, on success. */
export interface ParsedResponse {
  readonly type: 'parsed'
  readonly positions: Float32Array<ArrayBuffer>
  readonly triangles: number
  readonly format: StlFormat
  readonly sourceBytes: number
  readonly dropped: number
  /** Wall-clock parse time inside the worker, in ms. Surfaced in the readout. */
  readonly parseMs: number
}

/** Worker → main thread, on a buffer that is not STL. */
export interface FailedResponse {
  readonly type: 'failed'
  readonly kind: StlParseErrorKind | 'unknown'
  readonly message: string
}

export type ParseResponse = ParsedResponse | FailedResponse

/** A message plus the transfer list it must be posted with. */
export interface Posted<T> {
  readonly message: T
  readonly transfer: readonly Transferable[]
}

/** Build the request. The buffer rides in the transfer list, so nothing is copied. */
export function parseRequest(bytes: ArrayBuffer): Posted<ParseRequest> {
  return { message: { type: 'parse', bytes }, transfer: [bytes] }
}

/** Build the success reply, transferring the positions buffer out of the worker. */
export function parsedResponse(parsed: ParsedStl, parseMs: number): Posted<ParsedResponse> {
  const { positions, triangles, format, sourceBytes, dropped } = parsed
  return {
    message: { type: 'parsed', positions, triangles, format, sourceBytes, dropped, parseMs },
    transfer: [positions.buffer],
  }
}

/** Build the failure reply. Nothing to transfer. */
export function failedResponse(error: unknown): Posted<FailedResponse> {
  const kind =
    typeof error === 'object' && error !== null && 'kind' in error
      ? ((error as { kind: StlParseErrorKind }).kind ?? 'unknown')
      : 'unknown'
  const message = error instanceof Error ? error.message : String(error)
  return { message: { type: 'failed', kind, message }, transfer: [] }
}

/** Reassemble a {@link ParsedStl} from a reply, so the client hands back one type. */
export function fromResponse(response: ParsedResponse): ParsedStl {
  return {
    positions: response.positions,
    triangles: response.triangles,
    format: response.format,
    sourceBytes: response.sourceBytes,
    dropped: response.dropped,
  }
}

/**
 * Test fixtures: deterministic content addresses, synthetic bucket objects, and
 * a `fetch` that never leaves the process.
 *
 * No test in this package touches the network. That is not only politeness
 * towards somebody else's bucket — a test that fetched 33 MB objects could not
 * assert anything about *when* a body is opened, which is how the streaming
 * properties are checked at all.
 */
import type { ArchiveModelEntry } from '../archive'
import type { ModelSource } from '../bucket'
import type { ZipRequestFile } from '../request'
import { ZIP_REQUEST_VERSION } from '../request'

/** The bucket base every fixture composes URLs against. */
export const MODELS_BASE = 'https://objects.openforge.tools/models'

/** A deterministic 32-hex content address from a small seed. */
export function md5(seed: number): string {
  const hex = seed.toString(16).padStart(4, '0')
  return (hex + '0123456789abcdef0123456789abcdef').slice(0, 32)
}

/** The URL the Worker will compose for a seed. */
export function urlFor(seed: number, base: string = MODELS_BASE): string {
  const address = md5(seed)
  return `${base}/${address.slice(0, 6)}/${address}.stl`
}

/**
 * Synthetic model bytes, unique per seed.
 *
 * A repeating pattern seeded by the address, so an entry that ends up holding
 * another entry's bytes fails a content comparison rather than a length one.
 */
export function modelBytes(seed: number, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + seed * 7 + 13) & 0xff
  return bytes
}

/** One wire row for a seed. */
export function requestFile(seed: number, overrides: Partial<ZipRequestFile> = {}): ZipRequestFile {
  const length = overrides.bytes ?? 1_024 + seed
  return {
    md5: md5(seed),
    name: `models/cave/wall-${String(seed)}.stl`,
    bytes: length,
    paths: [`tiles/cave/thick_wall/wall-${String(seed)}.stl`],
    copies: 1,
    ...overrides,
  }
}

/** A whole wire body. `generatedAt` is fixed so archives are byte-reproducible. */
export function requestBody(files: readonly ZipRequestFile[], overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: ZIP_REQUEST_VERSION,
    filename: 'openforge-room-2026-09-02.zip',
    generatedAt: '2026-09-02T10:00:00.000Z',
    files: [...files],
    ...overrides,
  }
}

/** How a fixture object misbehaves, if it does. */
export interface FakeObject {
  bytes: Uint8Array
  /** Chunks the body is split into. 1 by default; more exercises the streaming path. */
  chunks?: number
  status?: number
  contentType?: string | null
  /** Overrides the `content-length` header, to simulate a lying origin. */
  declaredLength?: string
  /** Serves fewer bytes than the header promises: the classic silent truncation. */
  truncateTo?: number
  /** The URL the response reports, to simulate a redirect off the models path. */
  redirectedTo?: string
}

/** A `fetch` over a fixed set of objects, recording what was asked for and when. */
export interface FakeFetch {
  impl: typeof fetch
  /** URLs requested, in order. */
  readonly requested: readonly string[]
  /** User-Agent headers seen, in order. */
  readonly agents: readonly (string | null)[]
  /** Bodies handed out and not yet finished or cancelled. */
  readonly open: number
  /** The highest {@link open} ever reached. */
  readonly peakOpen: number
}

export function fakeFetch(objects: ReadonlyMap<string, FakeObject>): FakeFetch {
  const requested: string[] = []
  const agents: (string | null)[] = []
  let open = 0
  let peakOpen = 0

  const impl = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requested.push(url)
    agents.push(new Headers(init?.headers).get('user-agent'))

    const object = objects.get(url)
    if (object === undefined) {
      return Promise.resolve(new Response('not found\n', { status: 404, statusText: 'Not Found' }))
    }
    if (object.status !== undefined && object.status >= 400) {
      return Promise.resolve(new Response('refused\n', { status: object.status, statusText: 'Forbidden' }))
    }

    const served = object.truncateTo === undefined ? object.bytes : object.bytes.subarray(0, object.truncateTo)
    const chunks = splitInto(served, object.chunks ?? 1)

    open += 1
    peakOpen = Math.max(peakOpen, open)
    let closed = false
    const close = (): void => {
      if (closed) return
      closed = true
      open -= 1
    }

    let at = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[at]
        at += 1
        if (chunk === undefined) {
          close()
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
      cancel() {
        close()
      },
    })

    const headers = new Headers()
    headers.set('content-type', object.contentType === undefined ? 'application/octet-stream' : (object.contentType ?? ''))
    if (object.contentType === null) headers.delete('content-type')
    headers.set('content-length', object.declaredLength ?? String(object.bytes.byteLength))

    const response = new Response(body, { status: 200, headers })
    if (object.redirectedTo !== undefined) {
      // `redirected` and `url` are read-only on a constructed Response, so they
      // are overridden here rather than simulated with a real redirect.
      Object.defineProperty(response, 'redirected', { value: true })
      Object.defineProperty(response, 'url', { value: object.redirectedTo })
    }
    return Promise.resolve(response)
  }) as typeof fetch

  return {
    impl,
    requested,
    agents,
    get open() {
      return open
    },
    get peakOpen() {
      return peakOpen
    },
  }
}

function splitInto(bytes: Uint8Array, chunks: number): Uint8Array[] {
  if (chunks <= 1) return bytes.byteLength === 0 ? [] : [bytes]
  const size = Math.ceil(bytes.byteLength / chunks)
  const out: Uint8Array[] = []
  for (let at = 0; at < bytes.byteLength; at += size) out.push(bytes.subarray(at, Math.min(at + size, bytes.byteLength)))
  return out
}

/**
 * A `ModelSource` that records exactly when each body is opened and closed.
 *
 * Used where a test needs to assert the *shape* of the fetching — laziness,
 * prefetch depth, peak concurrency — rather than the bucket guards, which the
 * {@link fakeFetch} tests cover.
 */
export interface RecordingSource extends ModelSource {
  /** md5s opened, in order. */
  readonly opened: readonly string[]
  /** Bodies handed out and not yet drained or cancelled. */
  readonly live: number
  /** The highest {@link live} ever reached. */
  readonly peakLive: number
}

export function recordingSource(content: (entry: ArchiveModelEntry) => Uint8Array, chunks = 4): RecordingSource {
  const opened: string[] = []
  let live = 0
  let peakLive = 0

  return {
    opened,
    get live() {
      return live
    },
    get peakLive() {
      return peakLive
    },
    open: (entry) => {
      opened.push(entry.md5)
      live += 1
      peakLive = Math.max(peakLive, live)

      let closed = false
      const close = (): void => {
        if (closed) return
        closed = true
        live -= 1
      }

      const pieces = splitInto(content(entry), chunks)
      let at = 0
      return Promise.resolve(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            const chunk = pieces[at]
            at += 1
            if (chunk === undefined) {
              close()
              controller.close()
              return
            }
            controller.enqueue(chunk)
          },
          cancel() {
            close()
          },
        }),
      )
    },
  }
}

/** Read a stream to the end, returning one buffer. */
export async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (value !== undefined) {
      chunks.push(value)
      total += value.byteLength
    }
    if (done) break
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.byteLength
  }
  return out
}

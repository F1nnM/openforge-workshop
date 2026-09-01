/**
 * Getting bytes into a URL and back: `deflate-raw` and base64url.
 *
 * ## Native compression, no dependency
 *
 * `CompressionStream` is the reason this app can put a room in a link without
 * shipping a compressor. It is Baseline — Chrome 80, Firefox 113, Safari 16.4 —
 * and `deflate-raw` specifically, rather than `gzip` or `deflate`, because both of
 * those wrap the same DEFLATE stream in a header the payload does not need:
 * gzip's is 18 bytes and zlib's is 6, which is 24 and 8 base64 characters spent
 * saying nothing. On a payload measured in hundreds of bytes that is real.
 *
 * ## The whole API is async, and that is contained here
 *
 * `CompressionStream` is a stream, so encoding is a `Promise`, and PR 5 keeps the
 * store's write path deliberately synchronous to avoid lost writes when a user
 * places tiles quickly. The two facts are compatible only as long as **nothing in
 * this module is ever called from a store action**: a share link is produced when
 * somebody presses "share" and consumed when a link is opened, both of which are
 * already async user gestures. `src/share/scene.ts` spells out the call shape.
 *
 * ## Everything here can fail, and none of it throws
 *
 * Both functions return `undefined` rather than rejecting. Inflation of a
 * truncated or hand-edited stream fails as a matter of routine — a link that got
 * wrapped in an email is the normal case, not the exceptional one — and a rejected
 * promise at the top of a route loader is a white screen.
 */

/**
 * Whether this runtime can encode and decode share links at all.
 *
 * Every browser the app targets can. It is checked anyway because the alternative
 * to a typed "this browser cannot open share links" is a `TypeError` from a
 * constructor call, which surfaces as a blank page on somebody's shared link — and
 * the check costs two `typeof`s.
 */
export function isShareCodecSupported(): boolean {
  return typeof CompressionStream === 'function' && typeof DecompressionStream === 'function'
}

/**
 * Read a whole stream into one buffer.
 *
 * Reads chunk by chunk rather than going through `new Response(stream)` so the
 * module depends on nothing but the Streams API — `Response` with a stream body is
 * present in every target browser but absent from more than one non-browser
 * runtime, and the manual version is ten lines.
 */
async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (value !== undefined) {
      chunks.push(value)
      total += value.length
    }
    if (done) break
  }

  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

async function pump(
  format: 'deflate-raw',
  direction: 'compress' | 'decompress',
  input: Uint8Array,
): Promise<Uint8Array> {
  const stream: CompressionStream | DecompressionStream =
    direction === 'compress' ? new CompressionStream(format) : new DecompressionStream(format)

  const writer = stream.writable.getWriter()
  // Copied into a fresh buffer rather than cast. A `Uint8Array` may be backed by a
  // `SharedArrayBuffer`, which is not a `BufferSource`; nothing here produces one,
  // and a copy of a few hundred bytes is cheaper than a type assertion that would
  // stop being true if that changed.
  const chunk = new Uint8Array(input)
  // A malformed stream errors on both ends. It is read from the readable side
  // below, where the failure can be attributed; swallowing it here only prevents
  // the same error surfacing a second time as an unhandled rejection.
  const written = writer
    .write(chunk)
    .then(() => writer.close())
    .catch(() => undefined)

  const output = await collect(stream.readable)
  await written
  return output
}

/** Compress. `undefined` only if the runtime lacks `CompressionStream`. */
export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (!isShareCodecSupported()) return undefined
  try {
    return await pump('deflate-raw', 'compress', bytes)
  } catch {
    return undefined
  }
}

/**
 * Decompress. `undefined` when the bytes are not a valid DEFLATE stream.
 *
 * This is the check that catches most damaged links: DEFLATE carries its own
 * Huffman tables and end-of-block markers, so a truncated or edited stream fails
 * here rather than inflating to plausible garbage that the payload reader would
 * then have to reject.
 */
export async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  if (!isShareCodecSupported()) return undefined
  try {
    return await pump('deflate-raw', 'decompress', bytes)
  } catch {
    return undefined
  }
}

/* --------------------------------------------------------------- base64url */

/**
 * Bytes → unpadded base64url.
 *
 * RFC 4648 §5's alphabet, so the result is `A–Z a–z 0–9 - _` — every character
 * unreserved in RFC 3986. That means no browser re-encodes it, it survives a
 * round trip through the address bar looking like itself, and it can be pasted
 * into chat without an autolinker mangling it. Standard base64's `+` and `/` fail
 * all three, and `=` padding is dropped because the length already determines it.
 *
 * This mirrors the reasoning `src/search/searchSchema.ts` gives for choosing `~`
 * as its facet separator: pick characters the URL layer leaves alone.
 */
export function toBase64Url(bytes: Uint8Array): string {
  // Chunked because `String.fromCharCode(...bytes)` spreads into the argument
  // list and overflows the stack somewhere around 100 KB — which a room build
  // reaches long before the URL budget does.
  const CHUNK = 0x8000
  let binary = ''
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Unpadded base64url → bytes, or `undefined` if the text is not base64url.
 *
 * Strict about the alphabet, because the alternative is silently discarding
 * characters: `atob` follows the "forgiving base64" algorithm, which strips ASCII
 * whitespace, so a link that arrived with a newline inserted mid-string would
 * decode to *something* — a different room — instead of being reported as damaged.
 * A length of `4n + 1` is rejected for the same reason: no byte string encodes to
 * it, so it can only be a truncation.
 */
export function fromBase64Url(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined
  if (text.length % 4 === 1) return undefined

  const padded = text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return undefined
  }

  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

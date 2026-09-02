/**
 * The wire format, and every reason a request is refused before a byte is
 * fetched.
 *
 * ## What the Worker is handed, and why it is not a share link
 *
 * A share link (`src/share/**`) is the obvious candidate and it is the wrong
 * one, for three reasons that are all about the same thing — a share link
 * describes a *scene*, and this Worker needs a *build*:
 *
 *   1. **A link carries manifest ordinals, not blobs.** Turning ordinals into
 *      md5s means the whole catalog index in the Worker, plus the assembly
 *      resolver, plus the footprint tables, plus the lock-system preference
 *      logic — a second implementation of the exact computation that must not
 *      diverge from the browser's. That is not a fallback download path, it is a
 *      second copy of the app.
 *   2. **A link deliberately omits what the archive is made of.** No blobs, no
 *      byte counts, no `generatedAt`. `LICENSE.txt` states the file count, the
 *      model byte total and the assembly timestamp, so an archive built from a
 *      link could not carry the same licence text as the archive the browser
 *      would have built — and then a recipient *can* tell which path built it,
 *      which is the one property this row exists to preserve.
 *   3. **A link resolves against whichever catalog the resolver happens to
 *      hold.** The Worker's copy and the user's tab can be different builds. The
 *      user would be sent a room they were not looking at, silently.
 *
 * So the input is the **bill of tiles the browser already computed**, projected
 * onto the flat rows this Worker needs: one row per distinct md5, its entry name,
 * its size, the catalog paths that resolved to it and the number of copies. Those
 * are exactly the fields of `ArchiveFileEntry` in `src/download/plan.ts` minus
 * the ones the archive itself does not use. Everything else — the licence text,
 * the attribution CSV, the entry order, the predicted length, the URLs — the
 * Worker derives, with the same code where it can and under test where it cannot.
 *
 * ## Why POST rather than a GET link
 *
 * The worst case this row exists for is 900 rows of roughly 140 bytes:
 * **~126 KB of request**, past every URL length limit in the stack. And the
 * client cannot shorten it into a URL without the ordinal scheme, which is the
 * share-link dead end above.
 *
 * POST is also the shape iOS Safari needs. The whole point of this Worker is
 * that Safari has no `showSaveFilePicker` and refuses a buffered download above
 * 512 MB, so the archive must arrive as a **navigation** the browser's own
 * download manager handles, with no JavaScript touching the bytes. A form
 * submission is a navigation, so this handler accepts both a JSON body and a
 * form field named `build` — a hidden `<form method="post">` is a download path
 * that needs no `fetch`, no `Blob` and no picker.
 *
 * ## Why every field is re-derived or re-validated
 *
 * The caller is the user's own browser building the user's own room, so there is
 * no privilege to escalate and nothing to protect the user from. What there *is*
 * to protect against is a **stale or wrong client**: a cached build a version
 * behind, a hand-rolled request, a bug in the caller. Each check below turns one
 * of those into an HTTP error instead of an archive that extracts wrongly.
 *
 * Two of them are worth naming here:
 *
 *   - **A repeated md5 is refused.** 171 md5s are shared by 520 catalog rows, so
 *     dedupe by content address is the difference between a correct archive and
 *     one that downloads and stores the same 33 MB mesh nine times.
 *     `buildBillOfTiles` already emits one line per distinct md5; a request that
 *     does not is a broken caller, and accepting it would also produce a
 *     duplicate entry name, which extractors resolve by keeping the last.
 *   - **Entry names are validated, never re-derived.** Re-deriving them would
 *     need `BillLine`, the `CatalogRecord` behind it and the collision analysis
 *     over the bill — the second producer this row must not become. The client
 *     derives (`src/download/entries.ts`); the Worker refuses anything that is
 *     not a well-formed result of that derivation. A validator that restates a
 *     shape is not a duplicate deriver.
 */
import { MAX_ARCHIVE_BYTES, MAX_ARCHIVE_FILES, SUBREQUEST_LIMIT } from './limits'
import { MD5 } from './url'

/** The wire version. Bumped only if the field names or meanings change. */
export const ZIP_REQUEST_VERSION = 1

/** Every model lives under this. Mirrors `MODELS_PREFIX` in `src/download/entries.ts`. */
export const MODELS_PREFIX = 'models/'

/** Names the licensing entries own; no model entry may take one. */
export const RESERVED_ENTRY_NAMES: readonly string[] = ['LICENSE.txt', 'ATTRIBUTION.csv']

/**
 * Longest entry name accepted, in UTF-8 bytes.
 *
 * The ZIP name field is 16 bits, so 65,535 is the format's own ceiling; 1,024 is
 * roughly three times the longest corpus path prefixed with `models/` and
 * suffixed with `~{md5}`, and keeping it small keeps the framing arithmetic
 * bounded no matter what a caller sends.
 */
export const MAX_ENTRY_NAME_BYTES = 1_024

/**
 * The archive filename, as it goes into `Content-Disposition`.
 *
 * Deliberately narrower than an entry name: `"`, `\`, CR and LF would break the
 * header, and a path separator would let a caller suggest a location rather than
 * a name. The client's default, `openforge-room-YYYY-MM-DD.zip`, fits.
 */
export const ARCHIVE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,115}\.zip$/

/** Control characters, which no entry name may carry. */
// eslint-disable-next-line no-control-regex -- rejecting control bytes is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Characters Windows refuses in a filename. `src/download/entries.ts` maps these to `_`. */
const WINDOWS_RESERVED_CHARACTERS = /[:*?"<>|]/

/** One row of the bill, as it arrives. */
export interface ZipRequestFile {
  /** Content address. The row's identity, and what the URL is built from. */
  md5: string
  /** The disambiguated entry path the client derived. Validated, not re-derived. */
  name: string
  /** Size from the catalog index — the reason no HEAD request is made. */
  bytes: number
  /** Every catalog path in this bill that resolved to this md5. Usually one. */
  paths: string[]
  /** Copies the room asked for. The archive holds the file once regardless. */
  copies: number
}

/** The request body. */
export interface ZipRequestBody {
  v: number
  filename: string
  /** ISO 8601. Stamped on every entry and printed in `LICENSE.txt`. */
  generatedAt: string
  files: ZipRequestFile[]
}

/** A validated request: the same rows, plus the totals the plan needs. */
export interface ArchiveRequest {
  readonly filename: string
  readonly generatedAt: Date
  readonly files: readonly ZipRequestFile[]
  /**
   * Sum of `files[].bytes`.
   *
   * Computed here rather than taken from the wire because it is *the* number in
   * `LICENSE.txt`, and it must equal `bill.download.bytes` — which
   * `buildBillOfTiles` also computes as the sum over deduplicated lines
   * (`bill.ts`: `downloadSize(lines.reduce(…line.bytes))`). Deriving it makes the
   * two agree by arithmetic instead of by trust.
   */
  readonly modelBytes: number
}

/**
 * A request this Worker will not serve, with the status it should answer.
 *
 * `status` and `code` live on the error rather than being decided at the call
 * site because the distinction between "your caller is broken" (400) and "this
 * archive is too big for a Worker" (413) is a property of the failure — and 413
 * is the one the UI must turn into §11's URL-list offer rather than a retry.
 */
export class ZipRequestError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ZipRequestError'
    this.status = status
    this.code = code
  }
}

/** The form field a hidden `<form method="post">` puts the JSON in. */
export const FORM_FIELD = 'build'

/**
 * Read a request body in either of the two shapes a browser can send.
 *
 * `application/json` is what `fetch` sends. The form encodings are what a
 * navigation sends, and a navigation is the only way iOS Safari can receive a
 * 1.6 GB download — see the module docblock.
 */
export async function readArchiveRequest(request: Request): Promise<ArchiveRequest> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''

  let text: string
  if (contentType === 'application/json') {
    text = await request.text()
  } else if (contentType === 'application/x-www-form-urlencoded' || contentType === 'multipart/form-data') {
    const form = await request.formData()
    const field = form.get(FORM_FIELD)
    if (typeof field !== 'string') {
      throw new ZipRequestError(400, 'missing_field', `the form carries no "${FORM_FIELD}" field`)
    }
    text = field
  } else {
    throw new ZipRequestError(
      415,
      'unsupported_media_type',
      `send application/json, or a form with a "${FORM_FIELD}" field; got ${contentType === '' ? 'no content-type' : contentType}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new ZipRequestError(400, 'malformed_json', `the body is not JSON: ${reason(cause)}`)
  }

  return validateArchiveRequest(parsed)
}

/**
 * Validate a parsed body.
 *
 * Separated from the reading so the whole refusal surface is testable without
 * constructing a `Request`, and so the order of the checks is visible: shape,
 * then the budgets, then the rows, then the two whole-archive properties that
 * can only be checked once every row is known.
 */
export function validateArchiveRequest(raw: unknown): ArchiveRequest {
  const body = asObject(raw, 'the body')

  if (body.v !== ZIP_REQUEST_VERSION) {
    throw new ZipRequestError(
      400,
      'bad_version',
      `this Worker speaks request version ${String(ZIP_REQUEST_VERSION)}; the request says ${JSON.stringify(body.v)}. Reload the app.`,
    )
  }

  const filename = asString(body.filename, 'filename')
  if (!ARCHIVE_FILENAME.test(filename)) {
    throw new ZipRequestError(400, 'bad_filename', `filename ${JSON.stringify(filename)} is not an acceptable archive name`)
  }

  const generatedAt = new Date(asString(body.generatedAt, 'generatedAt'))
  if (Number.isNaN(generatedAt.getTime())) {
    throw new ZipRequestError(400, 'bad_timestamp', `generatedAt ${JSON.stringify(body.generatedAt)} is not a date`)
  }

  if (!Array.isArray(body.files)) throw new ZipRequestError(400, 'bad_shape', 'files must be an array')

  // Checked before the per-row validation so that "download the whole corpus"
  // — 8,353 blobs, 9.28× the cap — is answered in constant time rather than
  // after validating 8,353 rows.
  if (body.files.length === 0) {
    throw new ZipRequestError(400, 'empty_archive', 'nothing to download: the request holds no files')
  }
  if (body.files.length > MAX_ARCHIVE_FILES) {
    throw new ZipRequestError(
      413,
      'too_many_files',
      `${String(body.files.length)} files is past this Worker's limit of ${String(MAX_ARCHIVE_FILES)}: one bucket request per file, against Cloudflare's cap of ${String(SUBREQUEST_LIMIT)} subrequests per invocation. Download the URL list instead and feed it to a download manager.`,
    )
  }

  const files = body.files.map((file, index) => validateFile(file, index))

  let modelBytes = 0
  for (const file of files) modelBytes += file.bytes
  if (modelBytes > MAX_ARCHIVE_BYTES) {
    throw new ZipRequestError(
      413,
      'archive_too_large',
      `${String(modelBytes)} bytes of models is past this Worker's limit of ${String(MAX_ARCHIVE_BYTES)}. Download the URL list instead and feed it to a download manager.`,
    )
  }

  assertDistinctBlobs(files)
  assertUsableEntryNames(files)

  return { filename, generatedAt, files, modelBytes }
}

/* ------------------------------------------------------------------- a row */

function validateFile(raw: unknown, index: number): ZipRequestFile {
  const where = `files[${String(index)}]`
  const file = asObject(raw, where)

  const md5 = asString(file.md5, `${where}.md5`)
  if (!MD5.test(md5)) {
    throw new ZipRequestError(400, 'bad_md5', `${where}.md5 ${JSON.stringify(md5)} is not a 32-character lowercase md5`)
  }

  const bytes = file.bytes
  if (!Number.isSafeInteger(bytes) || (bytes as number) < 0) {
    throw new ZipRequestError(400, 'bad_bytes', `${where}.bytes must be a non-negative integer; got ${JSON.stringify(bytes)}`)
  }

  const copies = file.copies
  if (!Number.isSafeInteger(copies) || (copies as number) < 1) {
    throw new ZipRequestError(400, 'bad_copies', `${where}.copies must be a positive integer; got ${JSON.stringify(copies)}`)
  }

  if (!Array.isArray(file.paths) || file.paths.length === 0) {
    throw new ZipRequestError(400, 'bad_paths', `${where}.paths must be a non-empty array of catalog paths`)
  }
  const paths = file.paths.map((path, at) => asString(path, `${where}.paths[${String(at)}]`))

  return { md5, name: validateEntryName(file.name, where), bytes: bytes as number, paths, copies: copies as number }
}

/**
 * The shape a name produced by `src/download/entries.ts` has.
 *
 * Each clause corresponds to something that module either guarantees or strips,
 * and every one of them is a way a valid-looking archive extracts wrongly:
 * traversal escapes the extraction directory, a control byte or a
 * Windows-reserved character makes the entry unwritable, and a trailing dot or
 * space is silently dropped by Windows — which is how two distinct entries
 * become one file.
 *
 * What is deliberately *not* rejected: `#`, `+`, `,`, `%`, `°` and interior
 * spaces. 1,249 corpus paths carry a non-ASCII character and the corpus is full
 * of the rest; they are only special in URLs, and the writer flags names as
 * UTF-8 so they extract correctly on Windows too.
 */
export function validateEntryName(raw: unknown, where: string): string {
  const name = asString(raw, `${where}.name`)

  if (utf8Bytes(name) > MAX_ENTRY_NAME_BYTES) {
    throw new ZipRequestError(400, 'bad_entry_name', `${where}.name is longer than ${String(MAX_ENTRY_NAME_BYTES)} bytes`)
  }
  if (RESERVED_ENTRY_NAMES.includes(name)) {
    throw new ZipRequestError(400, 'reserved_entry_name', `${where}.name ${JSON.stringify(name)} is reserved for the licensing files`)
  }
  if (!name.startsWith(MODELS_PREFIX)) {
    throw new ZipRequestError(
      400,
      'bad_entry_name',
      `${where}.name ${JSON.stringify(name)} must start with "${MODELS_PREFIX}" — that prefix is what makes the licensing entries unshadowable by a catalog file that happens to be called one of them`,
    )
  }
  if (name.includes('\\')) {
    throw new ZipRequestError(400, 'bad_entry_name', `${where}.name ${JSON.stringify(name)} contains a backslash`)
  }

  const segments = name.slice(MODELS_PREFIX.length).split('/')
  if (segments.some((segment) => segment === '')) {
    throw new ZipRequestError(400, 'bad_entry_name', `${where}.name ${JSON.stringify(name)} has an empty path segment`)
  }
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new ZipRequestError(400, 'bad_entry_name', `${where}.name ${JSON.stringify(name)} contains a traversal segment`)
    }
    if (CONTROL_CHARACTERS.test(segment)) {
      throw new ZipRequestError(400, 'bad_entry_name', `${where}.name ${JSON.stringify(name)} contains a control character`)
    }
    if (WINDOWS_RESERVED_CHARACTERS.test(segment)) {
      throw new ZipRequestError(
        400,
        'bad_entry_name',
        `${where}.name ${JSON.stringify(name)} contains a character Windows refuses in a filename`,
      )
    }
    if (/[. ]$/.test(segment) || segment.startsWith(' ')) {
      throw new ZipRequestError(
        400,
        'bad_entry_name',
        `${where}.name ${JSON.stringify(name)} has a segment with a leading space or a trailing dot or space, which Windows silently drops — turning two distinct entries into one file`,
      )
    }
  }

  return name
}

/* ------------------------------------------------- whole-archive invariants */

/**
 * One row per content address.
 *
 * See the module docblock: 171 md5s are shared by 520 catalog rows, and a
 * request that repeats one is a caller that lost the bill's dedupe.
 */
function assertDistinctBlobs(files: readonly ZipRequestFile[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.md5)) {
      throw new ZipRequestError(
        400,
        'duplicate_blob',
        `md5 ${file.md5} appears twice. A bill of tiles holds one line per distinct md5; this request has lost that dedupe.`,
      )
    }
    seen.add(file.md5)
  }
}

/**
 * Unique names, and no name that is also a directory.
 *
 * 89 corpus filenames map to two or three genuinely different meshes. A ZIP
 * given the same name twice writes both, and every extractor keeps the last: the
 * user gets one mesh where they asked for three, with no error anywhere. That is
 * a wrong print, not a confusing archive.
 *
 * The directory check collects every prefix into a set rather than comparing
 * neighbours in a sorted list, for the reason `entries.ts` gives: `/` is not the
 * lowest character in these paths — `#`, `+`, `,`, `.` and `%` all sort below
 * it — so the colliding pair is not reliably adjacent.
 */
function assertUsableEntryNames(files: readonly ZipRequestFile[]): void {
  const names = new Set<string>()
  for (const file of files) {
    if (names.has(file.name)) {
      throw new ZipRequestError(
        400,
        'duplicate_entry_name',
        `entry name ${JSON.stringify(file.name)} is used by two different meshes. Every extractor keeps only the last, which is a wrong print rather than a visible error.`,
      )
    }
    names.add(file.name)
  }

  const directories = new Set<string>()
  for (const name of names) {
    const segments = name.split('/')
    for (let i = 1; i < segments.length; i += 1) directories.add(segments.slice(0, i).join('/'))
  }
  for (const name of names) {
    if (directories.has(name)) {
      throw new ZipRequestError(400, 'entry_is_directory', `entry ${JSON.stringify(name)} is also a directory in this archive`)
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function asObject(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ZipRequestError(400, 'bad_shape', `${where} must be an object`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, where: string): string {
  if (typeof value !== 'string') throw new ZipRequestError(400, 'bad_shape', `${where} must be a string`)
  return value
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

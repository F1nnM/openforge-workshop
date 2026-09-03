/**
 * The columnar wire format: a header, then one column per field.
 *
 * This module is deliberately ignorant of the catalog, the manifest and the
 * store. It maps a {@link WirePayload} — small numbers — to bytes and back,
 * synchronously. Everything that needs to know what a number *means* lives in
 * `link.ts`, which is also where the compression and the base64 live. Keeping the
 * split means the format can be exercised exhaustively in a plain node test with
 * no streams involved.
 *
 * ## Why columnar
 *
 * Placements share structure: a room is one floor tile repeated ninety times, one
 * wall tile repeated forty, and two rotations. Row-major layout interleaves those
 * repetitions with the coordinates, which are the only part that actually varies,
 * so deflate's back-references have to straddle changing bytes. Column-major puts
 * all ninety copies of the floor ordinal next to each other and all ninety
 * coordinates next to each other, and the match lengths go from ~4 bytes to
 * hundreds.
 *
 * Measured by `capacity.test.ts`, which prints this table on every run —
 * placements that fit inside a 2,000-character URL:
 *
 * | layout                      | room-shaped build | scattered build |
 * | --------------------------- | ----------------: | --------------: |
 * | naive JSON array of objects |               554 |             159 |
 * | columnar JSON               |            17,128 |             204 |
 * | row-major varint            |               760 |             235 |
 * | **columnar varint (this)**  |        **29,705** |         **243** |
 *
 * **29,705, not the 29,713 this table read until row V4.** The figure was
 * measured against `main` before this row changed anything — the test prints it
 * on every run and nothing had read it — so it was stale rather than moved, and
 * V4 measures the identical number before and after its own change.
 *
 * The two middle rows are there to separate the two effects, because they are not
 * the same size. **Layout** is what carries the room build: columnar JSON reaches
 * 17,128 against naive JSON's 554, a 31× gain from nothing but reordering the same
 * characters. **Representation** is what carries the scattered build: it is
 * essentially incompressible — `deflate-raw` returns *more* bytes than it was
 * given below about a hundred placements — so no layout helps, and the varint
 * packing lifts it from 159 to 235. Columnar varint takes both, and is the only
 * one of the four that is not last on either shape.
 *
 * Delta-coding the columns was measured during design and **rejected**: it gains
 * on the room build, which is already 15× past any URL length that matters, and
 * costs about 11% on the scattered build, which is the one that is actually tight.
 * The delta between two unrelated ordinals is usually wider than either ordinal.
 *
 * ## Layout
 *
 * ```text
 *   u8      format version          SHARE_FORMAT_VERSION
 *   u8      flags                   bits 0–2 tile x/z/rotation exact,
 *                                   bits 3–5 generated x/z/rotation exact
 *   uvar    manifest version        CatalogFile.version.manifest
 *   u8      lock index              index into LOCK_ORDER
 *   uvar    count                   number of placements
 *   u8[4]   digest                  see manifest.ts, big-endian
 *   ordinal column                  count × uvar   (v3: a design's address;
 *                                   v2: the placed file — see the version note)
 *   x column                        count × zigzag(x · 2)   or   count × f64
 *   z column                        count × zigzag(z · 2)   or   count × f64
 *   rotation column                 count × uvar(rot · 4)   or   count × f64
 *   uvar    recipe count            distinct generated bases in the scene
 *   recipe table                    recipeCount × (uvar byte length, UTF-8 bytes)
 *   uvar    generated count         generated placements on the scene
 *   recipe column                   genCount × uvar (index into the recipe table)
 *   generated x column              genCount × zigzag(x · 2)   or   genCount × f64
 *   generated z column              genCount × zigzag(z · 2)   or   genCount × f64
 *   generated rotation column       genCount × uvar(rot · 4)   or   genCount × f64
 * ```
 *
 * ## The generated half, and why it is a table of strings
 *
 * A generated base is not a catalog file, so there is no manifest ordinal to
 * stand in for it (`src/generator/placement/scene.ts` — it is a third identity).
 * What identifies one is its **recipe**, and the recipe has to travel as text,
 * because the alternative — a positional tuple of parameter values against the
 * pinned `.scad` schema — drops the parameter *names*, and `panel/recipe.ts` is
 * explicit that a recipe which does not record what it meant silently changes
 * meaning the day a `.scad` default moves. A URL sits in a chat log for years;
 * that is the last place to put a positional encoding against a pin.
 *
 * So the table holds one JSON document per **distinct** base, and the placements
 * index into it. The dedup is the whole reason it is affordable: a room is one
 * base recipe repeated, and the measured cost is the *first* document.
 *
 * Measured, `deflate-raw` then base64url, against a 2,000-character URL on
 * `https://openforge.tools/builder` — see `capacity.test.ts`, which prints it.
 * **Row V4 changed what the ordinal column means and not one character of what
 * it costs**, which is the finding: the two columns below are the same
 * measurement before and after a placement stopped naming a file.
 *
 * | scene                                    | v2 chars | v3 chars | of budget |
 * | ---------------------------------------- | -------: | -------: | --------: |
 * | 90 tiles, no generated bases             |      130 |      130 |      6.5% |
 * | 90 tiles, 1 generated base               |      570 |      570 |     28.5% |
 * | 90 tiles, 16 generated bases, 1 recipe   |      608 |      608 |     30.4% |
 * | 90 tiles, 90 generated bases, 1 recipe   |      636 |      636 |     31.8% |
 * | 90 tiles, 90 generated bases, 3 recipes  |      680 |      680 |     34.0% |
 * | 90 tiles, 90 generated bases, 90 recipes |    1,784 |    1,784 |     89.2% |
 * | 400 tiles, 64 generated bases, 2 recipes |      756 |      756 |     37.8% |
 *
 * The plan expected this row to *shorten* links, on the grounds that a
 * `DesignId` is 13 characters against a `TileId`'s 39–183. **That premise is
 * about a string this codec has never put on the wire.** A link carries an
 * ordinal — one or two varint bytes — so there was no 39-to-183-character cost
 * to reclaim, and a design id in the column would have been 6 to 13 times
 * *worse* than the ordinal it replaced. `manifest.ts` has the arithmetic. The
 * saving the 13-character figure really buys lands in `localStorage` and in
 * `transfer.ts`'s JSON export, where a placement did carry a whole path.
 *
 * Where the link genuinely does get shorter is a scene that places **two
 * variants of one item** — two ordinals before, one after — which is a scene
 * only the pre-V4 palette could produce.
 *
 * **The first base costs 440 characters and the next 89, sharing its recipe, cost
 * 66 between them.** The widest of the five shapes at file defaults is a
 * 242-character recipe key, so a document — the id and the recipe, and the id
 * *is* the key — is 563 bytes raw; deflate takes the ninetieth copy of that text
 * to almost nothing, and the table means it only ever sees one.
 *
 * The adversarial row is a scene of ninety bases with ninety *different* recipes,
 * which is not a thing anyone builds, and it still fits. So the loss X9 found is
 * worth the bytes rather than worth a warning.
 *
 * ## Quantisation, and why there is an exact escape hatch
 *
 * Positions are stored in **half grid units** and rotations in **quarter
 * degrees**, which covers every value the app can currently produce: §7 snaps the
 * builder to 0.5 units, and the finest rotation in the corpus is 11.25° (45
 * quarter-degrees) on the tiles that carry `size|angle|11.25`.
 *
 * But `Placement` validates a coordinate as any finite number, on purpose — its
 * docblock says a schema that enforced the snap would reject a legitimate finer
 * mode the day one ships. A codec that quantised unconditionally would therefore
 * be **lossy on schema-valid input**, and it would be lossy the way this whole PR
 * is written to avoid: silently, by moving a tile a quarter of a unit. So a column
 * that cannot be represented exactly falls back to float64 for the whole column,
 * flagged in the header. Per column rather than per value because the alternative
 * is an exception list with its own indices — more format, more to get wrong, and
 * it would only ever run on data that does not exist yet.
 */
import type { LockSystem } from '@/store'

import { ByteReader, ByteWriter, MalformedPayloadError } from './bytes'

/* ---------------------------------------------------------------- constants */

/**
 * Version of *this layout*.
 *
 * Bump it in the same commit that changes a field's position or meaning, so an
 * older link is refused with a clear message instead of read as though the fields
 * were where this build expects them. It is separate from the manifest version:
 * this one says "these bytes are laid out differently", that one says "these
 * integers mean different tiles".
 *
 * **2 — the generated half.** A v1 payload ends after the rotation column, so a
 * v2 reader meeting one runs off the end and a v1 reader meeting a v2 payload
 * finds trailing bytes. Both are refusals rather than a plausible wrong room,
 * which is what the version byte is for; the version check in
 * {@link decodePayload} is what makes the first of those a named failure.
 *
 * **3 — the ordinal column names an item, not a file.** Row V4. Not one byte
 * moved: the field is the same `uvar` in the same position and a v2 payload and
 * a v3 payload of the same room are byte-for-byte identical whenever the room's
 * files happen to be its designs' address files. What changed is the *meaning*,
 * which this constant exists to record, and it is the only kind of change the
 * layout table cannot show.
 *
 * ### What a version 2 link does now: it is refused, and it did not have to be
 *
 * This is worth stating precisely, because a share link is the one piece of
 * state the "nothing is deployed" licence cannot cover — it lives in somebody's
 * chat log and outlives the build that wrote it.
 *
 *   - **A v2 link is refused**, by {@link decodePayload}'s equality check and by
 *     `link.ts`'s `format-version` result, with a message telling the reader to
 *     reload and to ask for a fresh link.
 *   - **It could have been read.** A v2 ordinal is the ordinal of the file the
 *     user placed; `ShareManifest.designOf` resolves *any* ordinal of any
 *     variant to its design, so reading a v2 payload under v3's rules yields the
 *     design the user placed, and then rule 0 re-picks the file under the lock
 *     the link carries. The room would open, and open *better* than it was
 *     written, because the file that was frozen at share time is no longer
 *     frozen.
 *   - **It is refused anyway because the population is empty, and accepting it
 *     would be a guard that cannot fire.** No v2 link exists: no module under
 *     `src/` outside `src/share/**` imports the codec (`tools/stamp/run.ts` and
 *     `tools/hygiene/project.test.ts` reach for `buildShareManifest`, which is
 *     the manifest and not the codec), so nothing in this repo has ever written
 *     one. Row X10 checked that for the 1 → 2 bump and it is still true;
 *     `project.test.ts` is what keeps it true.
 *
 * **This is the last bump that gets that answer.** The day a build is served,
 * the paragraph above stops being an argument for refusing and becomes the
 * recipe for accepting: keep the equality check for the *layout* and make the
 * reader take a set of readable versions, with the ordinal column's meaning
 * selected per version. It is cheap precisely because v2 and v3 differ in
 * nothing else.
 */
export const SHARE_FORMAT_VERSION = 3

/**
 * Ceiling on the declared placement count.
 *
 * Not a product limit — the URL budget bites long before it (29,705 placements in
 * a 2,000-character link for a room build, and a person will not build 100,000
 * tiles). It is an allocation guard: a hand-edited payload can claim any count,
 * and a reader that trusted it would size an array from a stranger's number. The
 * cheaper check below — count against bytes remaining — catches almost every case
 * first; this catches the rest.
 */
export const MAX_SHARE_PLACEMENTS = 100_000

/**
 * Ceiling on the declared generated-placement count, and on the recipe table.
 *
 * One number for both, and the same allocation-guard argument as
 * {@link MAX_SHARE_PLACEMENTS}: a hand-edited payload can claim any count. The
 * real ceiling is the URL budget, which the measured table above puts at well
 * under a hundred distinct recipes, so this is four orders of magnitude of
 * headroom rather than a product limit.
 *
 * It is lower than {@link MAX_SHARE_PLACEMENTS} because a recipe table entry is
 * a *string*, so a claimed count is a claim about far more than one byte each.
 * The cheaper "count against bytes remaining" check in {@link decodePayload}
 * catches almost every corrupt header first; this catches a header corrupt in a
 * buffer big enough to survive that.
 */
export const MAX_SHARE_GENERATED = 10_000

/**
 * Position quantum: values are stored as `x · 2`, i.e. in half grid units.
 *
 * §7 and `src/catalog/schema.ts#WALL_THICKNESS_UNITS`: every dimension in the
 * catalog is a multiple of 0.5 units, which is why the builder's 0.25 snap was
 * dropped, so a half-unit grid is the whole space of buildable positions.
 */
const COORD_SCALE = 2

/**
 * Rotation quantum: values are stored as `deg · 4`, i.e. in quarter degrees.
 *
 * Chosen from the data rather than for tidiness. The observed `size|angle` values
 * are 90, 45, 22.5, 60, 270, 11.25, 120, 240 and 300; the finest is 11.25°, which
 * is exactly 45 quarter-degrees. A whole-degree quantum would silently round the
 * 893 tiles that carry a non-multiple-of-90 angle.
 */
const ROT_SCALE = 4

const FLAG_X_EXACT = 1
const FLAG_Z_EXACT = 2
const FLAG_ROT_EXACT = 4
const FLAG_GEN_X_EXACT = 8
const FLAG_GEN_Z_EXACT = 16
const FLAG_GEN_ROT_EXACT = 32
const KNOWN_FLAGS =
  FLAG_X_EXACT | FLAG_Z_EXACT | FLAG_ROT_EXACT | FLAG_GEN_X_EXACT | FLAG_GEN_Z_EXACT | FLAG_GEN_ROT_EXACT

/**
 * Lock systems in wire order. **Append-only, for the same reason ordinals are.**
 *
 * The payload stores an index, so reordering this array would change which lock
 * system every link already in the wild resolves with — and §2 makes lock
 * preference the thing that picks the concrete STL, so the symptom is a download
 * pack full of the wrong joinery rather than an error. A new system goes on the
 * end; `payload.test.ts` asserts this covers `LockSystem` exactly, so adding one
 * to the enum fails a test rather than shipping a payload that cannot say it.
 */
export const LOCK_ORDER: readonly LockSystem[] = ['openlock', 'dragonlock', 'magnetic']

/* -------------------------------------------------------------------- types */

/** One placement as the wire sees it: an ordinal and three numbers. */
export interface WirePlacement {
  readonly ordinal: number
  readonly x: number
  readonly z: number
  readonly rotation: number
}

/**
 * One generated base as the wire sees it: an index into the recipe table, and
 * the same three numbers.
 *
 * Structurally a {@link WirePlacement} with `recipe` where `ordinal` was, and
 * kept a separate type rather than reusing it under a rename, because the two
 * integers index different things — one the catalog manifest, one this payload's
 * own table — and a codec that let them be assigned to each other would make an
 * ordinal/index mix-up a silent wrong room. Same argument `TagId` and
 * `ManifestOrdinal` are branded apart for in `src/catalog/schema.ts`.
 */
export interface WireGenerated {
  readonly recipe: number
  readonly x: number
  readonly z: number
  readonly rotation: number
}

/**
 * A whole payload, before compression and before any catalog knowledge.
 *
 * `lockIndex` rather than a `LockSystem` because decoding must be able to *report*
 * an index this build does not know — a link written by a future version that
 * added a fourth system — instead of failing to construct the value.
 */
export interface WirePayload {
  readonly manifestVersion: number
  readonly lockIndex: number
  readonly digest: number
  readonly placements: readonly WirePlacement[]
  /**
   * The distinct generated bases in the scene, as opaque strings.
   *
   * Opaque *here*: this module neither parses nor validates them, for the same
   * reason it does not validate an ordinal. `link.ts` runs each through zod and
   * drops a document it cannot read by name. What this module does guarantee is
   * that every {@link WireGenerated.recipe} is a valid index into this array —
   * that is internal consistency of the payload, not meaning, so it is checked
   * here.
   */
  readonly recipes: readonly string[]
  readonly generated: readonly WireGenerated[]
}

/* ------------------------------------------------------------------ columns */

/**
 * Whether every value survives `v · scale` as an exact integer.
 *
 * The second half of the test is the one that matters: `0.1 · 2` is `0.2`, not an
 * integer, so it is caught by `Number.isSafeInteger`; but a value like `1e17`
 * passes that and comes back changed, so the round trip is checked directly
 * rather than assumed from the type.
 */
function quantisable(values: readonly number[], scale: number): boolean {
  return values.every((value) => {
    const scaled = value * scale
    return Number.isSafeInteger(scaled) && scaled / scale === value
  })
}

function writeColumn(writer: ByteWriter, values: readonly number[], scale: number, signed: boolean, exact: boolean) {
  for (const value of values) {
    if (exact) {
      writer.f64(value)
    } else if (signed) {
      writer.zigzag(Math.round(value * scale))
    } else {
      writer.uvar(Math.round(value * scale))
    }
  }
}

function readColumn(reader: ByteReader, count: number, scale: number, signed: boolean, exact: boolean): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    if (exact) {
      values.push(reader.f64())
    } else if (signed) {
      values.push(reader.zigzag() / scale)
    } else {
      values.push(reader.uvar() / scale)
    }
  }
  return values
}

/* ------------------------------------------------------------------ encoding */

/**
 * Serialise a payload. Synchronous — the compression is the caller's.
 *
 * Throws {@link MalformedPayloadError} only on input this app cannot produce (a
 * negative count, a lock index off the end, an ordinal that is not a
 * non-negative safe integer, a recipe index off the end of the table it names).
 * Callers construct the input from validated values, so a throw here is a bug in
 * the caller rather than bad user data.
 */
export function encodePayload(payload: WirePayload): Uint8Array {
  if (payload.placements.length > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `${String(payload.placements.length)} placements exceeds the ${String(MAX_SHARE_PLACEMENTS)} the format carries`,
    )
  }
  if (!Number.isInteger(payload.lockIndex) || payload.lockIndex < 0 || payload.lockIndex > 0xff) {
    throw new MalformedPayloadError(`lock index ${String(payload.lockIndex)} does not fit one byte`)
  }
  if (payload.generated.length > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `${String(payload.generated.length)} generated bases exceeds the ${String(MAX_SHARE_GENERATED)} the format carries`,
    )
  }
  if (payload.recipes.length > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `${String(payload.recipes.length)} recipes exceeds the ${String(MAX_SHARE_GENERATED)} the format carries`,
    )
  }
  for (const generated of payload.generated) {
    if (!Number.isInteger(generated.recipe) || generated.recipe < 0 || generated.recipe >= payload.recipes.length) {
      throw new MalformedPayloadError(
        `generated base names recipe ${String(generated.recipe)} of ${String(payload.recipes.length)}`,
      )
    }
  }

  const xs = payload.placements.map((placement) => placement.x)
  const zs = payload.placements.map((placement) => placement.z)
  const rotations = payload.placements.map((placement) => placement.rotation)
  const genXs = payload.generated.map((generated) => generated.x)
  const genZs = payload.generated.map((generated) => generated.z)
  const genRotations = payload.generated.map((generated) => generated.rotation)

  const xExact = !quantisable(xs, COORD_SCALE)
  const zExact = !quantisable(zs, COORD_SCALE)
  const rotExact = !quantisable(rotations, ROT_SCALE)
  const genXExact = !quantisable(genXs, COORD_SCALE)
  const genZExact = !quantisable(genZs, COORD_SCALE)
  const genRotExact = !quantisable(genRotations, ROT_SCALE)

  const writer = new ByteWriter()
  writer.u8(SHARE_FORMAT_VERSION)
  writer.u8(
    (xExact ? FLAG_X_EXACT : 0) |
      (zExact ? FLAG_Z_EXACT : 0) |
      (rotExact ? FLAG_ROT_EXACT : 0) |
      (genXExact ? FLAG_GEN_X_EXACT : 0) |
      (genZExact ? FLAG_GEN_Z_EXACT : 0) |
      (genRotExact ? FLAG_GEN_ROT_EXACT : 0),
  )
  writer.uvar(payload.manifestVersion)
  writer.u8(payload.lockIndex)
  writer.uvar(payload.placements.length)
  writer.u8((payload.digest >>> 24) & 0xff)
  writer.u8((payload.digest >>> 16) & 0xff)
  writer.u8((payload.digest >>> 8) & 0xff)
  writer.u8(payload.digest & 0xff)

  for (const placement of payload.placements) writer.uvar(placement.ordinal)
  writeColumn(writer, xs, COORD_SCALE, true, xExact)
  writeColumn(writer, zs, COORD_SCALE, true, zExact)
  writeColumn(writer, rotations, ROT_SCALE, false, rotExact)

  writer.uvar(payload.recipes.length)
  for (const recipe of payload.recipes) writer.utf8(recipe)
  writer.uvar(payload.generated.length)
  for (const generated of payload.generated) writer.uvar(generated.recipe)
  writeColumn(writer, genXs, COORD_SCALE, true, genXExact)
  writeColumn(writer, genZs, COORD_SCALE, true, genZExact)
  writeColumn(writer, genRotations, ROT_SCALE, false, genRotExact)

  return writer.bytes()
}

/* ------------------------------------------------------------------ decoding */

/** The format version a payload declares, or `undefined` if it is empty. */
export function payloadFormatVersion(bytes: Uint8Array): number | undefined {
  return bytes[0]
}

/**
 * Read a payload back.
 *
 * Throws `TruncatedPayloadError` or {@link MalformedPayloadError}; `link.ts` turns
 * both into typed failures. It does **not** validate meanings — an ordinal no
 * catalog holds, a lock index no build knows and a rotation of 900° all come back
 * as written, because whether each of those is recoverable depends on the manifest
 * and that is not this module's business.
 *
 * The format version is checked first and hardest. Everything after byte 0 is
 * positional, so reading a v2 payload with v1's field offsets would not fail — it
 * would succeed, and produce a different room. The 2 → 3 bump is the one case
 * where the offsets *are* the same and the check is about meaning rather than
 * layout; {@link SHARE_FORMAT_VERSION} says why it refuses anyway.
 */
export function decodePayload(bytes: Uint8Array): WirePayload {
  const reader = new ByteReader(bytes)

  const format = reader.u8()
  if (format !== SHARE_FORMAT_VERSION) {
    throw new MalformedPayloadError(
      `payload format ${String(format)} is not ${String(SHARE_FORMAT_VERSION)}; ` +
        'the fields would be read from the wrong offsets',
    )
  }

  const flags = reader.u8()
  if ((flags & ~KNOWN_FLAGS) !== 0) {
    throw new MalformedPayloadError(`payload sets unknown flag bits (0x${flags.toString(16)})`)
  }

  const manifestVersion = reader.uvar()
  const lockIndex = reader.u8()
  const count = reader.uvar()

  if (count > MAX_SHARE_PLACEMENTS) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} placements, above the ${String(MAX_SHARE_PLACEMENTS)} limit`,
    )
  }
  // Four columns, at least one byte per value in the cheapest encoding, and four
  // digest bytes still to read. A count that cannot fit is a corrupt header, and
  // saying so beats allocating for it and failing later with "truncated".
  if (count * 4 > reader.remaining + 4) {
    throw new MalformedPayloadError(
      `payload claims ${String(count)} placements but holds ${String(reader.remaining)} more bytes`,
    )
  }

  const digest = ((reader.u8() << 24) | (reader.u8() << 16) | (reader.u8() << 8) | reader.u8()) >>> 0

  const ordinals: number[] = []
  for (let i = 0; i < count; i += 1) ordinals.push(reader.uvar())
  const xs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_X_EXACT) !== 0)
  const zs = readColumn(reader, count, COORD_SCALE, true, (flags & FLAG_Z_EXACT) !== 0)
  const rotations = readColumn(reader, count, ROT_SCALE, false, (flags & FLAG_ROT_EXACT) !== 0)

  const recipeCount = reader.uvar()
  if (recipeCount > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `payload claims ${String(recipeCount)} recipes, above the ${String(MAX_SHARE_GENERATED)} limit`,
    )
  }
  // A recipe costs at least its own one-byte length prefix, so a count above the
  // bytes left cannot be honoured. Saying so beats allocating for it.
  if (recipeCount > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(recipeCount)} recipes but holds ${String(reader.remaining)} more bytes`,
    )
  }
  const recipes: string[] = []
  for (let i = 0; i < recipeCount; i += 1) recipes.push(reader.utf8())

  const genCount = reader.uvar()
  if (genCount > MAX_SHARE_GENERATED) {
    throw new MalformedPayloadError(
      `payload claims ${String(genCount)} generated bases, above the ${String(MAX_SHARE_GENERATED)} limit`,
    )
  }
  if (genCount * 4 > reader.remaining) {
    throw new MalformedPayloadError(
      `payload claims ${String(genCount)} generated bases but holds ${String(reader.remaining)} more bytes`,
    )
  }
  const recipeIndices: number[] = []
  for (let i = 0; i < genCount; i += 1) recipeIndices.push(reader.uvar())
  const genXs = readColumn(reader, genCount, COORD_SCALE, true, (flags & FLAG_GEN_X_EXACT) !== 0)
  const genZs = readColumn(reader, genCount, COORD_SCALE, true, (flags & FLAG_GEN_Z_EXACT) !== 0)
  const genRotations = readColumn(reader, genCount, ROT_SCALE, false, (flags & FLAG_GEN_ROT_EXACT) !== 0)

  if (!reader.atEnd) {
    throw new MalformedPayloadError('payload has trailing bytes after the last column')
  }

  const placements: WirePlacement[] = []
  for (let i = 0; i < count; i += 1) {
    placements.push({
      ordinal: ordinals[i] ?? 0,
      x: xs[i] ?? 0,
      z: zs[i] ?? 0,
      rotation: rotations[i] ?? 0,
    })
  }

  const generated: WireGenerated[] = []
  for (let i = 0; i < genCount; i += 1) {
    const recipe = recipeIndices[i] ?? 0
    // Internal consistency, not meaning: the table this index addresses is in the
    // same payload, so an index off its end is the payload contradicting itself.
    // Left to `link.ts` it would have to become another `dropped` reason for a
    // condition that cannot arise from any encoder.
    if (recipe >= recipes.length) {
      throw new MalformedPayloadError(
        `generated base ${String(i)} names recipe ${String(recipe)} of ${String(recipes.length)}`,
      )
    }
    generated.push({ recipe, x: genXs[i] ?? 0, z: genZs[i] ?? 0, rotation: genRotations[i] ?? 0 })
  }

  return { manifestVersion, lockIndex, digest, placements, recipes, generated }
}

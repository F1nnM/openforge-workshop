/**
 * Generated meshes in the download pack — and the four ways a short pack fails
 * loudly instead.
 *
 * The pack path v1 built is a stream with an **exact** byte count: nothing is
 * compressed, so `plan.predictedLength` is right to the byte, and `stream.ts`
 * fails the download when the total is off in either direction. That is not
 * belt-and-braces. A ZIP written in streaming mode records each entry's real
 * size *after* the data, so a truncated archive **opens cleanly** and one of the
 * meshes inside it is a corrupt STL that nobody discovers until the print fails.
 * v1 rejected `native-file-system-adapter` for exactly this: its fallback
 * truncates unobservably.
 *
 * A generated mesh must not be able to reopen that hole, so it is checked at
 * four points and every one of them is a refusal:
 *
 *   1. **The bill must be complete.** {@link buildGeneratedPack} throws if any
 *      generated base on the plan has no bytes behind it. A base can legitimately
 *      be placed and unrendered — the footprint is arithmetic, so the outline was
 *      truthful before the engine was asked anything — but a *download* that
 *      quietly omitted it would be short and would look like success.
 *   2. **The bytes must be a whole binary STL.** `detectStlFormat` returns
 *      `'binary'` only when the facet count in the header predicts the file
 *      length exactly, `84 + 50n`. So the format check *is* the truncation
 *      check, and it is W1's own function rather than a second copy of the
 *      arithmetic.
 *   3. **The triangle count must not be zero.** There is not one `assert()` in
 *      the vendored geometry: an invalid combination `echo`es to stderr and emits
 *      empty geometry with **status 0**. S4 checks this before showing a
 *      preview; this checks it again before the bytes leave for a printer,
 *      because the two are different moments and a parameter can change between
 *      them.
 *   4. **The digest must recompute.** MD5 over the held bytes has to equal the
 *      md5 the plan named. Not a security claim — MD5 is collision-broken and
 *      `engine/md5.ts` says so — but it is what makes "these are the bytes whose
 *      digest we published in the pack" a checked statement rather than an
 *      asserted one, and it catches a hold that was swapped or clipped between
 *      the render and the save.
 *
 * All four run before the first byte of the archive is written, except (2)–(4),
 * which run again inside {@link generatedBlobSource} at the moment the entry is
 * opened. A failure there rejects inside the entry generator, `client-zip`
 * propagates it as a stream error, and `stream.ts` produces no complete file —
 * the same path a failed R2 fetch takes.
 *
 * ## What lands in the pack
 *
 * Under `generated/`, one entry per distinct mesh digest, plus one text entry:
 * {@link GENERATED_NOTICE_NAME}. The notice is not a courtesy.
 *
 *   - **`ATTRIBUTION.csv` cannot hold these rows.** Its `licence` column is
 *     `CC BY-NC-SA 4.0` for every row, which is the licence of the archive's
 *     published files. A generated STL is a derivative of **Apache-2.0** `.scad`
 *     sources. Filing it under the wrong licence would be worse than filing it
 *     nowhere, so the notice is their attribution table and says so in its first
 *     lines.
 *   - **Apache-2.0 §4(a) asks that a recipient of a derivative work be handed a
 *     copy of the licence**, and §4(d) that the upstream NOTICE travel with it.
 *     Both are `?raw` imports in `notice.ts`, which this module reaches through
 *     a dynamic `import()` — `engine/index.ts`'s discipline, and for the
 *     measured reason `notice.ts` records: static, the 11 KB of licence text
 *     lands in the entry bundle, because `@/download` is eagerly reachable.
 *     Nothing is traded away by that. Both documents still ship in the same
 *     build, from the same import, with no deployment step that could omit
 *     them, and `assertGeometryLicencePresent` refuses to produce a notice if
 *     either failed to load.
 *   - **The OpenSCAD binary is not in the archive**, so GPL-2 §1 and §3 do not
 *     attach to it. The notice points at where the app shows that licence and
 *     its written source offer rather than restating 18 KB of it here.
 *
 * ## The one thing the pack cannot represent
 *
 * §11's degradation path — a URL list for a room too large to stream — has
 * nothing to offer a generated mesh, because there is no URL: the bytes were
 * never on R2. `plan.ts` keeps them out of `plan.files` so `urlListText` stays
 * honest about what it does list, and {@link urlListShortfall} is the sentence a
 * caller offering that path has to show. It is a real limit, stated, rather than
 * a 404 in a `wget` list.
 */
import type { BlobId } from '@/catalog'
import { BlobId as BlobIdSchema } from '@/catalog'
import type {
  ArchivePlan,
  GeneratedArchiveMesh,
  GeneratedArchiveSection,
} from '@/download/plan'
import type { BlobSource } from '@/download/source'
import { detectStlFormat } from '@/three/stl/parse'

import { md5 } from '../engine/md5'

import type { GeneratedBill, GeneratedBillLine, GeneratedMeshFacts } from './bill'
// A type-only namespace import. Erased, so it does not put 11 KB of Apache
// licence text in this module's chunk — the whole point of `notice.ts`.
import type * as Notice from './notice'
import type { GeneratedBaseId } from './scene'
import { GENERATED_SHAPES } from './scene'

/** A binary STL's fixed preamble: 80-byte header plus a `uint32` facet count. */
const BINARY_HEADER_BYTES = 84

/** Bytes per binary facet: normal (12) + three vertices (36) + attribute (2). */
const BINARY_FACET_BYTES = 50

/** The provenance-and-licence entry for the `generated/` subtree, at the archive root. */
export const GENERATED_NOTICE_NAME = 'GENERATED.txt'

/**
 * Load the notice writer and the Apache-2.0 licence it carries.
 *
 * `loadEngineLicence()` in S3's engine seam, one directory over, for the same
 * reason and with the same shape: the licence text belongs in the chunk of
 * whoever is about to distribute the thing it licenses, not in the entry bundle.
 * {@link buildGeneratedPack} awaits this itself, so a caller building a pack
 * needs nothing extra; it is exported for a caller that wants to *show* the
 * notice without packing anything.
 */
export async function loadGeneratedNotice(): Promise<typeof Notice> {
  return import('./notice')
}

/** Bytes held for one recipe, for the life of the panel session. */
export interface GeneratedMeshHold {
  /** The digest S3's engine computed over {@link bytes}. */
  readonly md5: string
  /** The binary STL itself. Never persisted; see `scene.ts`. */
  readonly bytes: Uint8Array
}

/** Every mesh this session is holding, by the recipe that produced it. */
export type GeneratedMeshHoldings = ReadonlyMap<GeneratedBaseId, GeneratedMeshHold>

/** A generated mesh was refused. Never retryable: retrying ships the same bytes. */
export class GeneratedMeshRefusedError extends Error {
  override readonly name = 'GeneratedMeshRefusedError'
  readonly md5: string

  constructor(md5Value: string, reason: string) {
    super(`refusing to pack the mesh ${md5Value.slice(0, 8)}: ${reason}. The download has been failed rather than saved.`)
    this.md5 = md5Value
  }
}

/** A placed generated base has no bytes, so the pack would be one file short. */
export class GeneratedMeshMissingError extends Error {
  override readonly name = 'GeneratedMeshMissingError'
  readonly recipes: readonly string[]

  constructor(recipes: readonly string[]) {
    super(
      `${String(recipes.length)} generated base(s) on the plan have not been rendered — ${recipes.join(', ')}. ` +
        'A pack that left them out would be one file short and would still open, so the download has been ' +
        'refused: render them in the generator panel, or remove them from the plan.',
    )
    this.recipes = recipes
  }
}

/**
 * The facts about one held mesh, checked rather than taken on trust.
 *
 * Checks (2), (3) and (4) of the module note. Exported because the drawer wants
 * exactly this to feed a bill row — so a row that says "ready" and a pack that
 * accepts the bytes are answering one question with one implementation.
 *
 * The triangle count is derived from the length identity `detectStlFormat` has
 * just proved — `(byteLength − 84) / 50` — rather than re-read out of the
 * header, and the two are equal by construction: `'binary'` is returned *only*
 * when `84 + facets × 50 === byteLength`. S4's `triangleCount` reads the header
 * field directly and lives in `usePreview.ts`, which imports React and S3's
 * engine seam; importing it here would put the 298 kB worker chunk in the
 * download path. `pack.test.ts` asserts the two agree on real fixtures, so the
 * derivation cannot drift from the reading.
 */
export function verifyGeneratedMesh(hold: GeneratedMeshHold): GeneratedMeshFacts {
  const format = detectStlFormat(hold.bytes)
  if (format !== 'binary') {
    throw new GeneratedMeshRefusedError(
      hold.md5,
      format === 'ascii'
        ? 'it is an ASCII STL, and this engine is asked for `binstl`. The pack’s truncation guard is the ' +
            'binary length identity, so an ASCII mesh would enter with no such check'
        : `${String(hold.bytes.byteLength)} bytes matching neither the binary layout nor an ASCII header, ` +
            'which is what a clipped mesh looks like',
    )
  }

  const triangles = (hold.bytes.byteLength - BINARY_HEADER_BYTES) / BINARY_FACET_BYTES
  if (triangles === 0) {
    throw new GeneratedMeshRefusedError(
      hold.md5,
      'it holds zero triangles. The vendored geometry has no assert() in it, so an invalid combination ' +
        'echoes to stderr and emits empty geometry with exit status 0',
    )
  }

  const recomputed = md5(hold.bytes)
  if (recomputed !== hold.md5) {
    throw new GeneratedMeshRefusedError(
      hold.md5,
      `the held bytes hash to ${recomputed.slice(0, 8)}, not to the digest the pack named them by`,
    )
  }

  return { md5: hold.md5, bytes: hold.bytes.byteLength, triangles }
}

/**
 * Turn a generated bill and the meshes behind it into the pack's generated half.
 *
 * **Deduped on the digest, not on the recipe.** The bill is one row per recipe,
 * because that is what somebody chose to print; the pack is one entry per
 * distinct mesh, because that is what the bytes are — the same split
 * `buildBillOfTiles` makes when it folds 171 md5s shared by 520 catalog rows into
 * one line each. Two recipes that render byte-identically therefore share one
 * entry and both appear in its `recipes` list and in the notice.
 *
 * Throws rather than returning a partial section. See check (1) in the module
 * note: short is the failure mode this whole path exists to prevent.
 */
export async function buildGeneratedPack(
  bill: GeneratedBill,
  holdings: GeneratedMeshHoldings,
): Promise<GeneratedArchiveSection> {
  // The 11 KB of Apache licence, and the notice that carries it, arrive here and
  // nowhere else in the static graph. `notice.ts` records the measurement that
  // decided it; {@link loadGeneratedNotice} is the same seam for a caller that
  // wants the notice without a pack.
  const { assertGeometryLicencePresent, generatedNotice } = await import('./notice')
  assertGeometryLicencePresent()

  const missing = bill.lines.filter((line) => !holdings.has(line.base)).map((line) => line.recipeId)
  if (missing.length > 0) throw new GeneratedMeshMissingError(missing)

  interface Group {
    blob: BlobId
    bytes: number
    stems: string[]
    recipes: string[]
    quantity: number
    lines: GeneratedBillLine[]
  }
  const groups = new Map<string, Group>()

  for (const line of bill.lines) {
    // Non-null: `missing` is empty, so every line has a holding.
    const hold = holdings.get(line.base) as GeneratedMeshHold
    const facts = verifyGeneratedMesh(hold)
    const held = groups.get(facts.md5)
    if (held === undefined) {
      groups.set(facts.md5, {
        blob: BlobIdSchema.parse(facts.md5),
        bytes: facts.bytes,
        stems: [stemFor(line)],
        recipes: [line.recipeId],
        quantity: line.quantity,
        lines: [line],
      })
    } else {
      if (held.bytes !== facts.bytes) {
        throw new GeneratedMeshRefusedError(
          facts.md5,
          `two held meshes share this digest at ${String(held.bytes)} and ${String(facts.bytes)} bytes, ` +
            'so one of them is not the mesh its digest names',
        )
      }
      held.stems.push(stemFor(line))
      held.recipes.push(line.recipeId)
      held.quantity += line.quantity
      held.lines.push(line)
    }
  }

  const meshes: GeneratedArchiveMesh[] = [...groups.values()]
    .sort((a, b) => (a.blob < b.blob ? -1 : 1))
    .map((group) => ({
      blob: group.blob,
      bytes: group.bytes,
      // The lowest stem, so the entry name is a function of the content rather
      // than of the order the user placed things in.
      stem: [...group.stems].sort()[0] ?? `generated.${group.blob}.stl`,
      recipes: group.recipes,
      quantity: group.quantity,
    }))

  return { meshes, notice: { name: GENERATED_NOTICE_NAME, text: generatedNotice([...groups.values()]) } }
}

/**
 * A readable filename for one generated base.
 *
 * The shape, the size in grid squares and S4's 8-character recipe handle —
 * mirroring the name the drawer's own "Download this mesh" button offers, so a
 * file saved from the panel and the same file inside a pack are recognisably the
 * same thing. `plan.ts` sanitises it, prefixes `generated/`, and appends the md5
 * if two of them collapse onto one name.
 */
function stemFor(line: GeneratedBillLine): string {
  const grid = line.foot.gridFootprint
  const size = grid.shape === 'rect' ? `${String(grid.w)}x${String(grid.d)}` : grid.shape
  const shape = GENERATED_SHAPES[line.entry].label.toLowerCase().replace(/\s+/g, '-')
  return `${shape}-base-${size}.${line.recipeId}.stl`
}

/**
 * A {@link BlobSource} that serves generated meshes from memory and everything
 * else from the fallback.
 *
 * The composition is what lets `stream.ts` stay untouched: it asks for bytes by
 * content address, and this answers for the digests the pack named as generated.
 *
 * **`urlFor` throws for a generated digest**, and that is the point rather than
 * an omission. There is no URL — the bytes were never on R2 — and the two places
 * that call `urlFor` are the URL-list degradation path and an error message. The
 * first must not be handed something that looks like a URL and 404s; the second
 * is better off with a loud failure than with a fabricated address. `plan.ts`
 * keeps generated entries out of `plan.files`, so the URL list never asks.
 */
export function generatedBlobSource(holdings: GeneratedMeshHoldings, fallback: BlobSource): BlobSource {
  const byDigest = new Map<string, GeneratedMeshHold>()
  for (const hold of holdings.values()) byDigest.set(hold.md5, hold)

  return {
    urlFor: (blob) => {
      const hold = byDigest.get(blob)
      if (hold === undefined) return fallback.urlFor(blob)
      throw new GeneratedMeshRefusedError(
        hold.md5,
        'it has no URL. These bytes were generated in this browser and were never published, so there is ' +
          'nothing a URL list or a download manager could fetch',
      )
    },

    open: async (blob, signal) => {
      const hold = byDigest.get(blob)
      if (hold === undefined) return signal === undefined ? fallback.open(blob) : fallback.open(blob, signal)
      signal?.throwIfAborted()
      // Checked again at the moment of opening, not only when the plan was
      // built: a plan can be shown to the user and streamed a minute later, and
      // the hold is a live reference to a `Uint8Array` the panel owns.
      verifyGeneratedMesh(hold)
      const bytes = hold.bytes
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      })
    },
  }
}

/**
 * What a caller offering §11's URL list has to disclose, or `null` when there is
 * nothing to disclose.
 *
 * The URL list is the honest answer for a room too large to stream, and it has
 * nothing to say about a mesh that was never published. Rather than let that be
 * a silent omission, this is the sentence that names the shortfall — see the
 * report for the one call site that has to render it.
 */
export function urlListShortfall(plan: Pick<ArchivePlan, 'generated'>): string | null {
  const count = plan.generated.length
  if (count === 0) return null
  return (
    `The URL list covers the archive's published files only. ${String(count)} generated ` +
    `${count === 1 ? 'mesh is' : 'meshes are'} not in it, because ${count === 1 ? 'it was' : 'they were'} ` +
    'produced in this browser and was never published — re-generate ' +
    `${count === 1 ? 'it' : 'them'} in the generator panel, or download the archive instead.`
  )
}

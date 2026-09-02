/**
 * Reading the four file-backed artefacts, and the one that has no file.
 *
 * ## Five artefacts, two of which can be regenerated in CI
 *
 * The row's phrase is "one stamp across five artefacts, regenerated in one CI
 * step", and only two of the five are regenerable there. That is worth stating
 * rather than blurring, because it is what the gate has to be built around:
 *
 * | artefact | derived from | regenerable in CI |
 * | --- | --- | --- |
 * | index | the fixtures | **yes** — seconds, no network |
 * | share manifest | the index | **yes** — a pure function of it |
 * | measurement sidecar | 13 GB of strided range reads | no |
 * | thumbnail set | 4.5 GB of sprite sheets | no, and blocked on B1/B2 |
 * | LOD store | ~108 GB of STL | no, and blocked on B2 |
 *
 * So the step regenerates the two, and for the other three does the only useful
 * thing left: joins them to the freshly built index by md5 and says, per
 * artefact, exactly which objects are now unreachable. See `corpus.ts` for why
 * that join and not a stamp comparison is what detects churn.
 *
 * ## Reading them with a schema rather than a cast
 *
 * Each manifest is read with the narrowest Zod shape this module actually uses:
 * the tool's own manifest version, the index stamp it carries, and the md5 of
 * every object. Everything else in those files — sha256 columns, upload
 * commands, G1's format contract — is deliberately not described here, so the
 * three tools can change their manifests without this module having an opinion.
 *
 * What it *does* have an opinion about is the manifest version. {@link
 * SUPPORTED_MANIFEST_VERSIONS} is this module's declared understanding, and
 * `stamp.test.ts` cross-checks every entry against the constant the owning tool
 * exports. A tool that reshapes its manifest and bumps its version fails here
 * with a message naming both numbers, rather than being parsed under the old
 * assumptions and reported as clean.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import type { CatalogFile, VersionStamp } from '../../src/catalog'
import { DEFAULT_OUT_DIR as LOD_OUT_DIR } from '../lod/catalog'
import { DEFAULT_SIDECAR_PATH } from '../measure/catalog'
import { DEFAULT_OUT_DIR as THUMBS_OUT_DIR } from '../thumbnails/catalog'

/**
 * The manifest shapes this module claims to understand.
 *
 * Cross-checked against `tools/*` own exported constants by the test, which is
 * the only reason a hardcoded number here is acceptable: importing them
 * directly would pull `sharp` — a native module — into a step whose job is to
 * compare hashes, and a native load failure would take the gate down for a
 * reason unrelated to anything it checks.
 */
export const SUPPORTED_MANIFEST_VERSIONS = {
  sidecar: 1,
  thumbs: 1,
  lod: 1,
} as const

/**
 * The basename both `tools/thumbnails/cli.ts` and `tools/lod/cli.ts` default
 * their `--manifest` flag to.
 */
export const UPLOAD_MANIFEST_NAME = 'upload-manifest.json'

/** Default locations, taken from the owning tools rather than re-spelled. */
export const ARTEFACT_PATHS = {
  sidecar: DEFAULT_SIDECAR_PATH,
  thumbs: join(THUMBS_OUT_DIR, UPLOAD_MANIFEST_NAME),
  lod: join(LOD_OUT_DIR, UPLOAD_MANIFEST_NAME),
} as const

/* -------------------------------------------------------------- the stamp */

/**
 * The comparable part of a `VersionStamp`.
 *
 * `built` is dropped. It is a clock reading, so two artefacts derived from the
 * same index minutes apart carry different values, and comparing it would report
 * every artefact as drifted forever. The four that remain are the ones that mean
 * something: the record shape, the derivation rules, the corpus snapshot and the
 * ordinal manifest.
 */
export type ArtefactStamp = Pick<VersionStamp, 'schema' | 'pipeline' | 'fixtures' | 'manifest'>

export function stampOf(version: VersionStamp): ArtefactStamp {
  return {
    schema: version.schema,
    pipeline: version.pipeline,
    fixtures: version.fixtures,
    manifest: version.manifest,
  }
}

/** Which of the four fields differ. Empty when the two stamps agree. */
export function stampDifference(a: ArtefactStamp, b: ArtefactStamp): string[] {
  const fields: (keyof ArtefactStamp)[] = ['schema', 'pipeline', 'fixtures', 'manifest']
  return fields
    .filter((field) => a[field] !== b[field])
    .map((field) => `${field} ${String(a[field])} to ${String(b[field])}`)
}

export function formatStamp(stamp: ArtefactStamp): string {
  return `schema ${String(stamp.schema)} · pipeline ${String(stamp.pipeline)} · manifest ${String(stamp.manifest)} · fixtures ${stamp.fixtures.slice(0, 12)}`
}

/* ------------------------------------------------------------- the readers */

const StampIn = z.object({
  schema: z.number().int().nonnegative(),
  pipeline: z.number().int().nonnegative(),
  fixtures: z.string().min(1),
  manifest: z.number().int().nonnegative(),
})

const SidecarIn = z.object({
  version: z.number().int().nonnegative(),
  catalog: StampIn,
  coverage: z.object({ blobs: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }),
  measurements: z.record(z.string().min(1), z.object({ status: z.string().min(1) })),
})

const UploadManifestIn = z.object({
  version: z.number().int().nonnegative(),
  catalog: StampIn,
  entries: z.array(z.object({ blob: z.string().min(1) })),
})

/** One artefact as found on disk. */
export interface ArtefactFile {
  /** Absolute path looked in. */
  path: string
  /** The tool's own manifest version. */
  version: number
  /** The index stamp the artefact was derived from. */
  stamp: ArtefactStamp
  /** Every md5 the artefact covers. */
  blobs: string[]
  /** Targets attempted but not finished. Sidecar only; 0 for the manifests. */
  pending: number
}

/**
 * @throws when the file's own manifest version is not the one this module
 * understands, naming both numbers and the constant to update.
 */
function assertManifestVersion(kind: keyof typeof SUPPORTED_MANIFEST_VERSIONS, found: number, path: string): void {
  const expected = SUPPORTED_MANIFEST_VERSIONS[kind]
  if (found === expected) return
  throw new Error(
    `${path} declares ${kind} manifest version ${String(found)}; tools/stamp understands ${String(expected)}. ` +
      'Read the new shape, then update SUPPORTED_MANIFEST_VERSIONS in tools/stamp/artefacts.ts — ' +
      'parsing it under the old assumptions would report a stale artefact as clean.',
  )
}

/** W1's sidecar. Committed, so it is expected to be present on every machine. */
export function readMeasureSidecar(path: string = ARTEFACT_PATHS.sidecar): ArtefactFile | undefined {
  if (!existsSync(path)) return undefined
  const parsed = SidecarIn.parse(JSON.parse(readFileSync(path, 'utf8')))
  assertManifestVersion('sidecar', parsed.version, path)
  return {
    path,
    version: parsed.version,
    stamp: parsed.catalog,
    // Only a measured entry covers a mesh. A `failed` entry records an attempt
    // and no dimension, so counting it as coverage would report a mesh nobody
    // can read as done.
    blobs: Object.entries(parsed.measurements)
      .filter(([, entry]) => entry.status === 'measured')
      .map(([blob]) => blob),
    pending: parsed.coverage.pending,
  }
}

/** The thumbnail and LOD upload manifests, which share this shape. */
export function readUploadManifest(kind: 'thumbs' | 'lod', path: string): ArtefactFile | undefined {
  if (!existsSync(path)) return undefined
  const parsed = UploadManifestIn.parse(JSON.parse(readFileSync(path, 'utf8')))
  assertManifestVersion(kind, parsed.version, path)
  return {
    path,
    version: parsed.version,
    stamp: parsed.catalog,
    blobs: parsed.entries.map((entry) => entry.blob),
    pending: 0,
  }
}

/** Every distinct md5 the index carries. The denominator of every join. */
export function liveBlobs(file: CatalogFile): Set<string> {
  return new Set(file.records.map((record) => record.blob as string))
}

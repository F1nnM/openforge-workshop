/**
 * Fixtures → one validated `CatalogFile`.
 *
 * This is the whole pipeline of §5 in one function, in the order the plan draws
 * it: resolve the footprint primitive, classify the layer, normalise the
 * connection vocabulary, synthesise a display name, take the family from the
 * path, intern the tags, assign append-only ordinals.
 *
 * Two properties are deliberate and tested:
 *
 *   - **Records are sorted by `id`, not by ordinal.** Catalog paths share long
 *     prefixes, so id order puts near-identical records next to each other and
 *     is worth a large fraction of the brotli saving. It also makes the ordinals
 *     visibly non-dense, so nothing downstream can quietly start assuming
 *     `ord === index`.
 *   - **The return value is `CatalogFile.parse`'s output, not the draft.** What
 *     gets written is what validated — including the file-level checks for
 *     dangling tag ids and duplicate ids and ordinals — rather than something
 *     that merely passed a check on the way past.
 */
import { basename, dirname } from 'node:path'

import { CatalogFile, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from '../src/catalog'

import { buildDesignIndex } from './design'
import {
  buildSystem,
  classifyLayer,
  connectionSystems,
  kindBuckets,
  openlockSizeCode,
  rotationStep,
  textureRoot,
} from './facets'
import { resolveFootprint } from './footprint'
import type { FixtureRow } from './fixtures'
import { liveRows } from './fixtures'
import { displayName } from './naming'
import type { OrdinalManifest } from './ordinals'
import { assignOrdinals } from './ordinals'
import { buildTagTable } from './tags'
import { ASSET_BASES, PIPELINE_VERSION, buildTimestamp } from './version'

export interface BuildOptions {
  /** Every fixture row, deprecated included; the live filter is applied here. */
  rows: readonly FixtureRow[]
  /** The manifest as it stands on disk. Extended, never rewritten. */
  manifest: OrdinalManifest
  /** `version.fixtures` — the snapshot these rows came from. */
  fixturesRef: string
  /** `version.built`. Defaults to {@link buildTimestamp}. */
  builtAt?: string
}

export interface BuildStats {
  fixtureRows: number
  deprecated: number
  records: number
  tags: number
  tagReferences: number
  designs: number
  families: number
  footprints: Record<string, number>
  layers: Record<string, number>
  withConfig: number
  distinctNames: number
  newOrdinals: number
  retiredOrdinals: number
}

export interface BuildResult {
  file: CatalogFile
  /** The manifest to write back. */
  manifest: OrdinalManifest
  added: string[]
  retired: string[]
  stats: BuildStats
}

export function buildCatalog(options: BuildOptions): BuildResult {
  const live = liveRows(options.rows).sort((a, b) =>
    a.file_metadata.full_name < b.file_metadata.full_name
      ? -1
      : a.file_metadata.full_name > b.file_metadata.full_name
        ? 1
        : 0,
  )

  const ids = live.map((row) => row.file_metadata.full_name)
  const { manifest, ordinalOf, added, retired } = assignOrdinals(options.manifest, ids)
  const { designOf, designs } = buildDesignIndex(
    live.map((row) => ({ id: row.file_metadata.full_name, tags: row.tags })),
  )
  const { table, idOf } = buildTagTable(live.map((row) => row.tags))

  const records = live.map((row) => {
    const id = row.file_metadata.full_name
    const ord = ordinalOf.get(id)
    const design = designOf.get(id)
    if (ord === undefined || design === undefined) throw new Error(`no ordinal or design for ${id}`)

    const foot = resolveFootprint(row.tags)
    const build = buildSystem(row.tags)
    const texture = textureRoot(row.tags)
    const rotStep = rotationStep(row.tags)
    const sizeCode = openlockSizeCode(row.tags)

    return {
      id,
      ord,
      blob: row.file_metadata.md5,
      file: basename(id),
      bytes: row.file_metadata.size,
      sprite: (row.images ?? []).some((image) => Boolean(image.image_url)),
      family: dirname(id),
      design,
      name: displayName(row.tags, foot, row.file_metadata.file),
      kinds: kindBuckets(row.tags),
      conn: connectionSystems(row.tags),
      ...(build === undefined ? {} : { build }),
      layer: classifyLayer(row.tags),
      ...(texture === undefined ? {} : { texture }),
      tags: row.tags.map((tag) => {
        const tagId = idOf.get(tag)
        if (tagId === undefined) throw new Error(`tag ${tag} missing from the intern table`)
        return tagId
      }),
      foot,
      ...(rotStep === undefined ? {} : { rotStep }),
      ...(sizeCode === undefined ? {} : { sizeCode }),
      ...(row.config === undefined ? {} : { config: row.config }),
    }
  })

  const file = CatalogFile.parse({
    version: {
      schema: SCHEMA_VERSION,
      pipeline: PIPELINE_VERSION,
      fixtures: options.fixturesRef,
      manifest: manifest.manifest,
      built: options.builtAt ?? buildTimestamp(),
    },
    assets: ASSET_BASES,
    sprite: MEASURED_SPRITE_SHEET,
    tags: table,
    records,
  })

  return {
    file,
    manifest,
    added,
    retired,
    stats: {
      fixtureRows: options.rows.length,
      deprecated: options.rows.length - live.length,
      records: records.length,
      tags: table.length,
      tagReferences: records.reduce((total, record) => total + record.tags.length, 0),
      designs,
      families: new Set(records.map((record) => record.family)).size,
      footprints: tally(records.map((record) => record.foot.shape)),
      layers: tally(records.map((record) => record.layer)),
      withConfig: records.filter((record) => record.config !== undefined).length,
      distinctNames: new Set(records.map((record) => record.name)).size,
      newOrdinals: added.length,
      retiredOrdinals: retired.length,
    },
  }
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

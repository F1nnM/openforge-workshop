/**
 * The spec grid's two honest fields, and the four cells around them.
 *
 * The cases below are one per tier of the footprint cascade and one per branch of
 * the height lookup, because the failure this file exists to prevent is a cell
 * that prints a blank or an invented number. `corpus.test.ts` proves the same
 * cascade over all 8,702 live tiles; this file proves each branch in isolation.
 */
import { describe, expect, it } from 'vitest'

import type { CatalogRecord } from '@/catalog'
import { CatalogAssets, CatalogRecord as CatalogRecordSchema } from '@/catalog'

import {
  NO_FOOTPRINT,
  NO_HEIGHT,
  buildLabel,
  componentLabel,
  familyTrail,
  fileLabel,
  footprintLabel,
  formatFileSize,
  formatUnits,
  heightLabel,
  storageAddress,
  textureSetLabel,
} from './labels'

/* ------------------------------------------------------------------ fixtures */

/** A minimal live record. Parsed, so a fixture that drifts from the schema fails here. */
function record(overrides: Partial<Record<string, unknown>> = {}): CatalogRecord {
  return CatalogRecordSchema.parse({
    id: 'tiles/cave/floors/floor/cave%floor.1x1.stl',
    ord: 7,
    blob: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
    file: 'cave%floor.1x1.stl',
    bytes: 1_335_084,
    sprite: true,
    family: 'tiles/cave/floors/floor',
    design: 'd51024cbbcd6f',
    name: 'Cave Floor 1x1',
    kinds: ['floor'],
    conn: ['openforge'],
    layer: 'topper',
    texture: 'cave',
    tags: [],
    foot: { shape: 'rect', w: 1, d: 1 },
    ...overrides,
  })
}

const ASSETS = CatalogAssets.parse({
  models: 'https://objects.openforge.tools/models',
  sprites: 'https://objects.openforge.tools/sprites',
  thumbs: 'https://objects.openforge.tools/thumbs',
  lod: 'https://objects.openforge.tools/lod',
})

/* ----------------------------------------------------------------- numbers */

describe('numbers', () => {
  it('prints a grid length without trailing zeros', () => {
    expect(formatUnits(1)).toBe('1')
    expect(formatUnits(1.5)).toBe('1.5')
    expect(formatUnits(0.5)).toBe('0.5')
  })

  it('sizes a file in decimal units, and in KB below a megabyte', () => {
    expect(formatFileSize(1_335_084)).toBe('1.3 MB')
    expect(formatFileSize(45_284)).toBe('45 KB')
    expect(formatFileSize(812)).toBe('812 B')
  })
})

/* --------------------------------------------------------------- footprint */

describe('footprintLabel', () => {
  it('tier 1 — a rect prints width × depth', () => {
    const value = footprintLabel(record({ foot: { shape: 'rect', w: 2, d: 1.5 } }), [])
    expect(value).toMatchObject({ text: '2 × 1.5', basis: 'rect' })
  })

  it('tier 2 — a wall prints its length against the measured wall thickness', () => {
    const value = footprintLabel(record({ foot: { shape: 'wall', length: 4 } }), [])
    expect(value).toMatchObject({ text: '4 × 0.5', basis: 'wall' })
    // The note has to name the constant, or the 0.5 reads as tagged data.
    expect(value.note).toContain('12.7 mm')
  })

  it('tier 3 — an arc prints its band pair and sweep, never a width × depth', () => {
    // Row W5. The old expectation was `2r 22.5°`, the tagged radius — which for a
    // `concave` tile is neither edge of the piece, because a curved wall is named
    // after the floor it clips to. The cell now shows the outline and the note
    // names the tag it was derived from.
    const concave = { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 22.5, band: 'concave', bandBasis: 'measured' }
    const value = footprintLabel(record({ foot: concave }), [])
    expect(value).toMatchObject({ text: '2 – 2.5 r 22.5°', basis: 'arc' })
    expect(value.note).toContain('tagged radius of 2')
    expect(value.note).toContain('outside which the material lies')
    expect(value.note).toContain('Confirmed against 36 measured meshes')
  })

  it('tier 3 — a disc prints one radius, and a fallback band says it is one', () => {
    const disc = { shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' }
    expect(footprintLabel(record({ foot: disc }), [])).toMatchObject({ text: '2 r 90°' })

    // `convex` has no accepted W1 sector fit behind it — 43 meshes attempted and
    // 43 refused — so the cell still prints the sector and the note refuses to
    // call it measured.
    const convex = { shape: 'arc', rIn: 1.5, rOut: 2, sweep: 45, band: 'convex', bandBasis: 'fallback' }
    const value = footprintLabel(record({ foot: convex }), [])
    expect(value.text).toBe('1.5 – 2 r 45°')
    expect(value.note).toContain('Not confirmed against a measured mesh')
  })

  it('tier 4 — no footprint, but an OpenLOCK code', () => {
    const value = footprintLabel(record({ foot: { shape: 'none' }, sizeCode: 'BA' }), [])
    expect(value).toMatchObject({ text: 'OpenLOCK BA', basis: 'size-code' })
  })

  it('tier 5 — no footprint and no code, but a shape word', () => {
    const value = footprintLabel(record({ foot: { shape: 'none' } }), [
      'shape|floor|curved',
      'texture|cave',
    ])
    expect(value).toMatchObject({ text: 'Curved', basis: 'shape-word' })
  })

  it('tier 5 — the vocabulary is ordered, so hex beats curved', () => {
    const value = footprintLabel(record({ foot: { shape: 'none' } }), [
      'shape|base|curved',
      'shape|base|hex',
    ])
    expect(value.text).toBe('Hex')
  })

  it('tier 6 — says so rather than printing a blank', () => {
    const value = footprintLabel(record({ foot: { shape: 'none' } }), ['component|door'])
    expect(value).toMatchObject({ text: NO_FOOTPRINT, basis: 'unspecified' })
    expect(value.text.trim()).not.toBe('')
  })

  it('never returns an empty label for any footprint shape', () => {
    const shapes = [
      { shape: 'rect', w: 1, d: 1 },
      { shape: 'wall', length: 1 },
      { shape: 'arc', rIn: 0, rOut: 1, sweep: 90, band: 'radial', bandBasis: 'measured' },
      { shape: 'none' },
    ]
    for (const foot of shapes) {
      expect(footprintLabel(record({ foot }), []).text).not.toBe('')
    }
  })
})

/* ------------------------------------------------------------------ height */

describe('heightLabel', () => {
  it('reads a single qualifier off the tag tree', () => {
    expect(heightLabel(['shape|wall|low', 'texture|cave'])).toMatchObject({
      text: 'Low',
      basis: 'qualitative',
    })
    expect(heightLabel(['shape|riser|high'])).toMatchObject({ text: 'High' })
    expect(heightLabel(['component|torch|low'])).toMatchObject({ text: 'Low' })
  })

  it('reads a compound tag as a per-segment profile, not as a range', () => {
    const value = heightLabel(['component|wall|full-low'])
    expect(value).toMatchObject({ text: 'Full / Low', basis: 'profile' })
    expect(value.note).toContain('per-segment')
  })

  it('handles a three-segment corner profile', () => {
    expect(heightLabel(['shape|corner|low-minimal-full']).text).toBe('Low / Minimal / Full')
  })

  it('falls back honestly when there is no height basis at all', () => {
    const value = heightLabel(['shape|floor', 'size|width|2', 'connection|openlock'])
    expect(value).toMatchObject({ text: NO_HEIGHT, basis: 'none' })
    // The note is what stops "Not recorded" reading as a bug in the app.
    expect(value.note).toContain('bounding box')
  })

  it('does not mistake a non-height segment for one', () => {
    // `size|width|4` is a measurement, not a height word; `shape|base|square` is
    // a shape. Neither may produce a height.
    expect(heightLabel(['size|width|4', 'shape|base|square']).basis).toBe('none')
  })

  it('ignores height-shaped words outside the shape and component trees', () => {
    expect(heightLabel(['texture|towne|full']).basis).toBe('none')
  })
})

/* --------------------------------------------------------- the other cells */

describe('the other cells', () => {
  it('names the build system, and names its absence', () => {
    expect(buildLabel(record({ build: 'separate wall' }))).toMatchObject({
      text: 'Separate wall',
      basis: 'tagged',
    })
    expect(buildLabel(record())).toMatchObject({ text: 'Not specified', basis: 'none' })
  })

  it('describes the file as an STL and a size', () => {
    expect(fileLabel(record()).text).toBe('STL · 1.3 MB')
  })

  it('derives the storage address as an HTTPS URL under the sharded path', () => {
    const address = storageAddress(ASSETS, record())
    expect(address).toBe(
      'https://objects.openforge.tools/models/a1b2c3/a1b2c3d4e5f60718293a4b5c6d7e8f90.stl',
    )
    expect(new URL(address).protocol).toBe('https:')
  })
})

/* ---------------------------------------------------------------- eyebrow */

describe('the eyebrow and subtitle', () => {
  it('names the texture set, and names its absence', () => {
    expect(textureSetLabel(record({ texture: 'dungeon_stone' }))).toBe('Dungeon stone')
    expect(textureSetLabel(record({ texture: undefined }))).toBe('No texture set')
  })

  it('shows every kind bucket a tile is in, including none', () => {
    expect(componentLabel(record({ kinds: ['base', 'wall'] }))).toBe('Base + Wall')
    expect(componentLabel(record({ kinds: [] }))).toBe('Uncategorised')
  })

  it('reads the family as a trail with the archive root dropped', () => {
    expect(familyTrail(record({ family: 'tiles/aztlan/floors/floor/openforge' }))).toBe(
      'aztlan / floors / floor / openforge',
    )
  })
})

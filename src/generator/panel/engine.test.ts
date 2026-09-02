/// <reference types="node" />
/**
 * The two claims that need the real engine, and one that needs the archive too.
 *
 * `src/generator/engine/render.test.ts` boots the vendored 10.5 MB binary to
 * prove the engine is the engine. This file boots it for two different reasons,
 * both specific to this row.
 *
 * **1. The pinned schemas are OpenSCAD's own output.** `schemas.ts` commits the
 * `--export-format=param` export for each of the five offered entry points so
 * the panel can paint a form before it knows whether it needs the engine at all.
 * A pin is only as good as the thing that re-derives it, so every one is
 * re-exported here and compared field by field. **This is the `.scad` half of
 * this row's CI gate**: a changed default, a changed option list, a renamed
 * group or a reflowed comment fails here with the entry point named. S1 asserts
 * 13 defaults for one file by hand; this asserts all 15 of that file plus 43
 * more across four others, and the option sets with them.
 *
 * **2. The archive is not reproducible from the vendored geometry, and the panel
 * is worded around that.** `plain#base+square.1x1.openlock,magnetic+flex.stl` is
 * published at 106,092 bytes and 760 ASCII facets, and its `PRIORITY` twin
 * `…magnetic+flex,openlock.stl` at 217,173 bytes and 1,380 facets — both
 * counted off `objects.openforge.tools`, both files beginning
 * `solid OpenSCAD_Model`. The two tuples the sweep tables say produced them
 * render here at 296 and 1,428 triangles, and neither digest matches. Off-test, the whole connector space of
 * that size was searched — 144 renders through `bases-square.scad` and 40
 * through the legacy `bases.scad`, every combination of `LOCK` x `MAGNETS` x
 * `MAGNET_HOLE` x `PRIORITY` x `TOPLESS` x `SUPPORTS` — with **zero** md5
 * matches and **zero** facet-count matches. Two renders are pinned here rather
 * than 184 because 184 costs 27 seconds and the conclusion is the same one.
 *
 * That is why `expectedMd5` is never passed to the engine: S3's
 * `catalogued-mismatch` explains a difference by the native/WASM gap, and this
 * difference is not that. Every generated mesh is `self-addressed`.
 *
 * About a second and a half, for the only tests here that can tell a working
 * pin from a plausible one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { OUTPUT_PATH, SCHEMA_PATH, renderArgs, schemaArgs } from '../engine/args'
import { md5 } from '../engine/md5'
import type { EngineRuntime } from '../engine/runtime'
import { createRuntime } from '../engine/runtime'
import { parseParameterExport } from '../engine/schema'

import { PANEL_ENTRIES, panelSchema } from './schemas'
import { triangleCount } from './usePreview'

const BINARY = fileURLToPath(new URL('../../../vendor/openscad-wasm/openscad.wasm', import.meta.url))

/** One runtime for the file: the compile is the expensive part and it is shared. */
const engine: Promise<EngineRuntime> = createRuntime({
  loadEngine: () => Promise.resolve(new Uint8Array(readFileSync(BINARY))),
})

describe('the pinned schemas are the engine’s own', () => {
  for (const entry of PANEL_ENTRIES) {
    it(`re-exports ${entry} identically`, async () => {
      const runtime = await engine
      const result = await runtime.run(schemaArgs(entry), [SCHEMA_PATH])
      const exported = result.outputs.get(SCHEMA_PATH)
      expect(exported, `${entry} produced no param export`).toBeDefined()
      const fresh = parseParameterExport(Buffer.from(exported!).toString('utf8'), entry)
      // Compared whole rather than field by field: the initial values, the
      // option sets, the labels, the captions and the group order are all
      // load-bearing for the resolver or for the form, and naming a subset here
      // would be choosing which drift to notice.
      expect(fresh).toEqual(panelSchema(entry))
    }, 120_000)
  }

  it('agrees with S1 on every default it asserts by hand', () => {
    // The 13 in PROVENANCE, read out of the pin rather than out of the file.
    const initial = Object.fromEntries(panelSchema('bases-square.scad').parameters.map((p) => [p.name, p.initial]))
    expect(initial).toEqual({
      x: 2,
      y: 2,
      HEIGHT: 6,
      SQUARE_BASIS: 'inch',
      LOCK: 'openlock',
      TOPLESS: 'true',
      SUPPORTS: 'true',
      MAGNETS: 'flex_magnetic',
      MAGNET_HOLE: 6,
      ELECTRONICS: 'false',
      PRIORITY: 'lock',
      NOTCH: 'false',
      NOTCH_X: 2,
      NOTCH_Y: 2,
      CENTER: 'none',
    })
  })
})

describe('the archive is not reproducible from this geometry', () => {
  /** The archived 1x1 pair, from `public/catalog/catalog.json`. */
  const ARCHIVED = {
    lock: { md5: '00ae8629d3b994e987a7b41fac9a1c86', bytes: 106_092, facets: 760 },
    magnets: { md5: '7fb19ddc054e726bc45ac45c2be06044', bytes: 217_173, facets: 1_380 },
  }

  const base = { x: 1, y: 1, SQUARE_BASIS: 'inch', LOCK: 'openlock', MAGNETS: 'flex_magnetic', MAGNET_HOLE: 6, TOPLESS: 'false' }

  it('renders the two tuples the sweep names, and neither is the published file', async () => {
    const runtime = await engine
    for (const [priority, archived] of [
      ['lock', ARCHIVED.lock],
      ['magnets', ARCHIVED.magnets],
    ] as const) {
      const result = await runtime.run(
        renderArgs({ entry: 'bases-square.scad', parameters: { ...base, PRIORITY: priority } }),
        [OUTPUT_PATH],
      )
      const mesh = result.outputs.get(OUTPUT_PATH)
      expect(mesh).toBeDefined()
      expect(md5(mesh!)).not.toBe(archived.md5)
      expect(triangleCount(mesh!)).not.toBe(archived.facets)
      // And the meshes are real geometry, so the mismatch is not an empty render.
      expect(triangleCount(mesh!)).toBeGreaterThan(200)
    }
  }, 180_000)

  it('still produces two different meshes for the two priorities, which is trap 2', async () => {
    const runtime = await engine
    const digests: string[] = []
    for (const priority of ['lock', 'magnets']) {
      const result = await runtime.run(
        renderArgs({ entry: 'bases-square.scad', parameters: { ...base, PRIORITY: priority } }),
        [OUTPUT_PATH],
      )
      digests.push(md5(result.outputs.get(OUTPUT_PATH)!))
    }
    expect(digests[0]).not.toBe(digests[1])
  }, 180_000)

  it('refuses dragonlock on a non-inch basis with the words the panel quotes', async () => {
    const runtime = await engine
    const result = await runtime.run(
      renderArgs({ entry: 'bases-square.scad', parameters: { x: 2, y: 2, SQUARE_BASIS: 'wyloch', LOCK: 'dragonlock' } }),
      [OUTPUT_PATH],
    )
    // The preflight exists because this is what the geometry does instead of
    // failing: it echoes and emits nothing, with a zero status.
    expect(result.output.join(' ')).toContain('ERROR: dragonlock is only compatible with inch basis')
    const mesh = result.outputs.get(OUTPUT_PATH)
    expect(mesh === undefined || triangleCount(mesh) === 0).toBe(true)
  }, 180_000)
})

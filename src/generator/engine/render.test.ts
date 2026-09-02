/// <reference types="node" />
/**
 * The real engine, actually run.
 *
 * Everything else in this directory is testable without OpenSCAD, and is tested
 * that way. This file boots the vendored 10.5 MB binary and renders geometry,
 * because four of the claims this row makes cannot be established any other way:
 *
 * - the compiled `WebAssembly.Module` **is** reused across renders, which is the
 *   whole reason the worker is long-lived;
 * - `--export-format=param` really does produce the fixture the schema tests
 *   parse, so those fixtures are not a snapshot of a bug;
 * - the binary self-reports `2026.01.02.wasm30346 (git 7a2053ed)`, which is what
 *   `WRITTEN-OFFER.md` names as the corresponding source;
 * - the geometry's refusal path emits an `ERROR:` with **no mesh and no non-zero
 *   status**, which is the failure a client has to detect by looking.
 *
 * **No network.** `loadEngine` reads `vendor/openscad-wasm/openscad.wasm` off
 * disk; the worker's `fetchEngine` is the only thing that ever fetches, and it
 * is not used here.
 *
 * It costs about a second and a half. That is the price of the only test in the
 * suite that can tell a working engine from a plausible one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { OUTPUT_PATH, SCHEMA_PATH, renderArgs, schemaArgs } from './args'
import { classifyOutput } from './diagnostics'
import { md5 } from './md5'
import type { EngineRuntime } from './runtime'
import { assertUnsharedMemory, createRuntime } from './runtime'
import { parseParameterExport } from './schema'
import { ENGINE_BYTES, ENGINE_SHA256, ENGINE_SOURCE_COMMIT, ENGINE_VERSION, verifyGeneratedMesh } from './verify'

const BINARY = fileURLToPath(new URL('../../../vendor/openscad-wasm/openscad.wasm', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** How many times the binary was read. Proves the compile is not repeated. */
let loads = 0

/** One runtime for the file, which is exactly the arrangement being tested. */
const engine: Promise<EngineRuntime> = createRuntime({
  loadEngine: () => {
    loads += 1
    return Promise.resolve(new Uint8Array(readFileSync(BINARY)))
  },
})

const stl = async (parameters: Record<string, number | string>) => {
  const runtime = await engine
  const result = await runtime.run(renderArgs({ entry: 'bases-square.scad', parameters }), [OUTPUT_PATH])
  return { ...result, mesh: result.outputs.get(OUTPUT_PATH), diagnostics: classifyOutput(result.output) }
}

/**
 * A minimal `.wasm`: the eight-byte preamble plus whatever sections are given.
 *
 * Returns the buffer rather than the view, because `WebAssembly.Module` takes a
 * `BufferSource` whose backing store is statically known not to be shared.
 */
const wat = (sections: readonly number[]): ArrayBuffer =>
  new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...sections]).buffer

/** Triangle count from a binary STL header, so "it rendered" is more than a length. */
const triangles = (mesh: Uint8Array): number => new DataView(mesh.buffer, mesh.byteOffset, mesh.byteLength).getUint32(80, true)

describe('the vendored engine, run', () => {
  it('identifies itself as the release the source offer names', async () => {
    const version = await (await engine).version()
    expect(version.version).toBe(ENGINE_VERSION)
    // The commit is read out of the artefact, not inferred from a build date.
    // It is what makes `WRITTEN-OFFER.md`'s pointer at openscad/openscad
    // checkable rather than a guess.
    expect(version.commit).toBe(ENGINE_SOURCE_COMMIT)
  }, 60_000)

  it('renders a 2x2 base, and the mesh is geometry rather than a stub', async () => {
    const result = await stl({ x: 2, y: 2 })
    expect(result.mesh).toBeDefined()
    const mesh = result.mesh ?? new Uint8Array()
    // 84-byte header plus 50 bytes per triangle is the binary STL layout, so a
    // consistent pair is a real mesh and not a truncated write.
    expect(mesh.byteLength).toBe(84 + 50 * triangles(mesh))
    expect(triangles(mesh)).toBeGreaterThan(1_000)
    expect(result.diagnostics.failed).toBe(false)
  }, 60_000)

  it('changes the mesh when a parameter changes', async () => {
    // The one assertion that would catch the trap in `runtime.ts`: a reused
    // instance leaves the previous `out.stl` in place, so a stale read returns
    // the old mesh at a plausible length with no error at all, and a parameter
    // would appear to do nothing.
    const small = await stl({ x: 2, y: 2 })
    const large = await stl({ x: 4, y: 4 })
    expect(triangles(large.mesh ?? new Uint8Array())).toBeGreaterThan(triangles(small.mesh ?? new Uint8Array()))
    expect(md5(large.mesh ?? new Uint8Array())).not.toBe(md5(small.mesh ?? new Uint8Array()))
  }, 60_000)

  it('reads the binary once and compiles once, however many renders follow', async () => {
    const runtime = await engine
    const before = runtime.runs
    await stl({ x: 1, y: 1 })
    await stl({ x: 1, y: 2 })
    expect(runtime.runs).toBe(before + 2)
    // S2's 281 ms startup floor is paid by `WebAssembly.compile`. One load, one
    // compile, many renders — this is the reuse claim as a number.
    expect(loads).toBe(1)
  }, 60_000)

  it('pays a per-render boot far smaller than a fresh compile', async () => {
    // A fresh instance is unavoidable — OpenSCAD's `main` is not re-entrant — but
    // it instantiates from the cached module rather than recompiling, so it is
    // cheap. Asserted as a ratio rather than a wall-clock number, because the
    // absolute figures belong in the PR body and are machine-dependent.
    const runtime = await engine
    const result = await stl({ x: 2, y: 2 })
    expect(result.bootMs).toBeLessThan(runtime.compileMs)
    expect(result.runMs).toBeGreaterThan(0)
  }, 60_000)

  it('produces a digest that matches an independent md5 of the same bytes', async () => {
    // Ties the browser-side MD5 to the thing the catalog's addresses mean.
    const mesh = (await stl({ x: 1, y: 1 })).mesh ?? new Uint8Array()
    const { createHash } = await import('node:crypto')
    const independent = createHash('md5').update(mesh).digest('hex')
    expect(md5(mesh)).toBe(independent)
    expect(verifyGeneratedMesh(mesh, independent).kind).toBe('catalogued-match')
    expect(verifyGeneratedMesh(mesh).kind).toBe('self-addressed')
  }, 60_000)

  it('emits the DUAL warning on a perfectly good render, and it is suppressed', async () => {
    // S2 saw it on 48 of 48 configurations. If it ever stops appearing, upstream
    // fixed `connectors.scad` and the suppression list should shrink — which is
    // worth being told about rather than discovering years later.
    const result = await stl({ x: 2, y: 2 })
    expect(result.output.some((line) => line.includes('Ignoring unknown variable "DUAL"'))).toBe(true)
    expect(result.diagnostics.suppressed).toBeGreaterThan(0)
    expect(result.diagnostics.notable.every((entry) => entry.kind !== 'error')).toBe(true)
  }, 60_000)

  it('refuses an impossible combination by echoing ERROR and emitting nothing', async () => {
    // S1: `bases-*.scad` `echo("ERROR: …")` and emit nothing when `dragonlock`
    // or `infinitylock` is combined with a non-inch basis. This is the case a
    // client that only watches for thrown errors would show a spinner for.
    const result = await stl({ x: 2, y: 2, LOCK: 'dragonlock', SQUARE_BASIS: 'wyloch' })
    expect(result.diagnostics.failed).toBe(true)
    expect(result.mesh).toBeUndefined()
  }, 60_000)

  it('exports the parameter schema the fixtures were built from', async () => {
    // Guards the fixtures against being a snapshot of an engine we no longer
    // ship: byte-for-byte, not shape-for-shape.
    const runtime = await engine
    const result = await runtime.run(schemaArgs('bases-square.scad'), [SCHEMA_PATH])
    const exported = result.outputs.get(SCHEMA_PATH)
    expect(exported).toBeDefined()
    const text = new TextDecoder().decode(exported ?? new Uint8Array())
    expect(text).toBe(readFileSync(`${FIXTURES}bases-square.param.json`, 'utf8'))

    const schema = parseParameterExport(text, 'bases-square.scad')
    expect(schema.parameters).toHaveLength(15)
    expect(schema.groups).toHaveLength(8)
  }, 60_000)

  it('exports a usable schema for a CRLF entry point, because the VFS normalises', async () => {
    // Verbatim, this file yields four parameters and no dropdowns. The engine is
    // fed the normalised text, so it yields six and six.
    const runtime = await engine
    const result = await runtime.run(schemaArgs('risers_square.scad'), [SCHEMA_PATH])
    const text = new TextDecoder().decode(result.outputs.get(SCHEMA_PATH) ?? new Uint8Array())
    expect(text).toBe(readFileSync(`${FIXTURES}risers_square.param.json`, 'utf8'))
    const schema = parseParameterExport(text, 'risers_square.scad')
    expect(schema.parameters).toHaveLength(6)
    expect(schema.parameters.every((parameter) => !(parameter.caption ?? '').includes('\r'))).toBe(true)
  }, 60_000)

  it('refuses to compile a binary that is not the vendored one', async () => {
    // The one integrity claim in this row that is a real guarantee: both sides
    // of the comparison come from different places — the constant from the
    // bundle, the bytes from the network.
    const truncated = new Uint8Array(readFileSync(BINARY)).subarray(0, ENGINE_BYTES - 1)
    await expect(createRuntime({ loadEngine: () => Promise.resolve(truncated) })).rejects.toThrow(
      /truncated or substituted asset/,
    )

    const tampered = new Uint8Array(readFileSync(BINARY))
    // Flip a byte deep in the code section, where nothing structural notices.
    tampered[9_000_000] = (tampered[9_000_000] ?? 0) ^ 0xff
    await expect(createRuntime({ loadEngine: () => Promise.resolve(tampered) })).rejects.toThrow(
      new RegExp(`expected ${ENGINE_SHA256}`),
    )
  }, 120_000)

  it('runs on unshared linear memory, and would refuse otherwise', async () => {
    // `createRuntime` asserts this on the first instance it builds, so every
    // render above is already evidence that the live memory is unshared —
    // `vendor.test.ts` reads the same fact out of the binary's memory section.
    // What is worth testing here is the *guard*: that an engine with shared
    // memory would be turned away rather than accommodated, because
    // accommodating it means COOP/COEP, and that blocks the catalog bucket.
    await expect(engine).resolves.toBeDefined()

    // A module that exports a shared memory, built here rather than mocked, so
    // the guard is exercised against the object shape it will really see.
    const sharedModule = new WebAssembly.Module(
      wat([
        0x05, 0x04, 0x01, 0x03, 0x01, 0x01, // memory: flags 0x03 (has_max | shared), min 1, max 1
        0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00, // export "memory"
      ]),
    )
    const sharedInstance = new WebAssembly.Instance(sharedModule)
    expect(
      (sharedInstance.exports.memory as WebAssembly.Memory).buffer,
      'this runtime cannot make a SharedArrayBuffer at all',
    ).toBeInstanceOf(SharedArrayBuffer)
    expect(() => {
      assertUnsharedMemory(sharedModule, sharedInstance)
    }).toThrow(/needs COOP\/COEP/)

    // And a module with no memory at all is refused rather than waved through,
    // which is the mode a check written against Emscripten's unpublished
    // `wasmMemory` would silently have run in.
    const bare = new WebAssembly.Module(wat([]))
    expect(() => {
      assertUnsharedMemory(bare, new WebAssembly.Instance(bare))
    }).toThrow(/exports no memory/)
  }, 60_000)
})

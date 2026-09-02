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
 * A fifth claim is checked here rather than timed: that a per-render boot does
 * **no compilation at all**. `WebAssembly` is instrumented below so the count is
 * a fact rather than an inference from a stopwatch — see
 * {@link compilations}, and the boot test for what the stopwatch version cost.
 *
 * **No network.** `loadEngine` reads `vendor/openscad-wasm/openscad.wasm` off
 * disk; the worker's `fetchEngine` is the only thing that ever fetches, and it
 * is not used here.
 *
 * It costs about **1.7 s**, of which the boot comparison is **0.6 s** — eight
 * renders for a best-of-N floor and two boots that compile, which is what buying
 * a timing claim out of a race costs. That is the price of the only test in the
 * suite that can tell a working engine from a plausible one.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import OpenSCAD from '../../../vendor/openscad-wasm/openscad.js'
import { OUTPUT_PATH, SCHEMA_PATH, renderArgs, schemaArgs } from './args'
import { classifyOutput } from './diagnostics'
import { md5 } from './md5'
import type { EngineRuntime } from './runtime'
import { assertUnsharedMemory, createRuntime } from './runtime'
import { parseParameterExport } from './schema'
import { ENGINE_BYTES, ENGINE_SHA256, ENGINE_SOURCE_COMMIT, ENGINE_VERSION, verifyGeneratedMesh } from './verify'

const BINARY = fileURLToPath(new URL('../../../vendor/openscad-wasm/openscad.wasm', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

/** How many times the binary was read. */
let loads = 0

/**
 * How many times anything in this process turned wasm bytes into code.
 *
 * **`loads` alone cannot establish "compiles once", and that gap is not
 * theoretical.** `loads` counts calls to `loadEngine`, and `createRuntime` makes
 * exactly one whatever happens afterwards. So if the `instantiateWasm` override
 * were dropped, Emscripten would obtain the bytes its own way and recompile
 * 10.5 MB on every boot — and `loads` would still read 1.
 *
 * So the four entry points that compile are counted instead. Instantiating a
 * `WebAssembly.Module` reuses compiled code and is deliberately **not** counted;
 * instantiating a `BufferSource` compiles it and is. That distinction is the
 * whole claim.
 *
 * Patched at module scope, before the runtime is built, so the runtime's own
 * compile lands in the count. Vitest isolates each test file, so nothing outside
 * this file sees the patch; it is restored in `afterAll` regardless.
 */
let compilations = 0

const nativeWasm = {
  compile: WebAssembly.compile,
  compileStreaming: WebAssembly.compileStreaming,
  instantiate: WebAssembly.instantiate,
  instantiateStreaming: WebAssembly.instantiateStreaming,
}

WebAssembly.compile = (bytes: BufferSource) => {
  compilations += 1
  return nativeWasm.compile(bytes)
}

WebAssembly.compileStreaming = (source: Response | PromiseLike<Response>) => {
  compilations += 1
  return nativeWasm.compileStreaming(source)
}

WebAssembly.instantiate = ((source: WebAssembly.Module | BufferSource, imports?: WebAssembly.Imports) => {
  if (!(source instanceof WebAssembly.Module)) compilations += 1
  const call = nativeWasm.instantiate as (
    source: WebAssembly.Module | BufferSource,
    imports?: WebAssembly.Imports,
  ) => Promise<unknown>
  return call(source, imports)
}) as typeof WebAssembly.instantiate

WebAssembly.instantiateStreaming = (source: Response | PromiseLike<Response>, imports?: WebAssembly.Imports) => {
  compilations += 1
  return nativeWasm.instantiateStreaming(source, imports)
}

afterAll(() => {
  WebAssembly.compile = nativeWasm.compile
  WebAssembly.compileStreaming = nativeWasm.compileStreaming
  WebAssembly.instantiate = nativeWasm.instantiate
  WebAssembly.instantiateStreaming = nativeWasm.instantiateStreaming
})

/** One runtime for the file, which is exactly the arrangement being tested. */
const engine: Promise<EngineRuntime> = createRuntime({
  loadEngine: () => {
    loads += 1
    return Promise.resolve(new Uint8Array(readFileSync(BINARY)))
  },
})

/**
 * Every per-render boot this file has paid, in ms.
 *
 * Collected so the boot test can take a **best-of-N** rather than sampling one
 * render. A boot is a few milliseconds of real work, so under whole-suite load a
 * single sample is mostly scheduler noise; the floor is not.
 */
const boots: number[] = []

const stl = async (parameters: Record<string, number | string>) => {
  const runtime = await engine
  const result = await runtime.run(renderArgs({ entry: 'bases-square.scad', parameters }), [OUTPUT_PATH])
  boots.push(result.bootMs)
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
    // One load, one compile, many renders — the reuse claim as two numbers.
    // Both are needed: `loads` catches a second *read* of the binary, and
    // `compilations` catches a second *compile* of bytes this file never read,
    // which is what dropping `instantiateWasm` would actually do. See
    // {@link compilations}.
    expect(loads).toBe(1)
    expect(compilations).toBe(1)
  }, 60_000)

  it('pays a per-render boot far smaller than a boot that has to compile', async () => {
    // A fresh instance is unavoidable — OpenSCAD's `main` is not re-entrant — but
    // it instantiates from the cached module rather than recompiling, so it is
    // cheap. This is that claim, measured.
    //
    // ── Why it is no longer `bootMs < runtime.compileMs` ─────────────────────
    //
    // It was, and it was a race: row C3 measured it failing **1 of 4 whole-suite
    // runs** while passing 12 of 12 in isolation. Two reasons, and the first is a
    // wrong premise rather than bad luck.
    //
    // `compileMs` is one `WebAssembly.compile` of the 10.5 MB module, which on V8
    // is **16.5–18.5 ms** — it is *not* S2's 281 ms, which was a whole `openscad`
    // process floor. So the old assertion set a ~6 ms boot against a ~17 ms
    // compile: a 2.5× margin, not the order of magnitude its name claimed. And
    // the first boot of a process is the dearest one (19–22 ms in isolation),
    // so on a cold file it inverts outright.
    //
    // Then both numbers are wall clock in one process. Under whole-suite load
    // `compileMs` inflates to 43–124 ms but individual boots spike to 44–51 ms,
    // and **1 of 32 sampled boots exceeded its own run's `compileMs`** — while the
    // *floor* over the file's boots stayed inside **8.1–11.9 ms** across 21
    // whole-suite runs. The signal was never in a single sample.
    //
    // ── What this asserts instead ───────────────────────────────────────────
    //
    // The comparison is against what reuse actually saves: a boot that compiles.
    // That is not hypothetical — it is precisely what this module does if the
    // `instantiateWasm` override is dropped — so it is booted here for real,
    // through Emscripten's own path.
    //
    // It behaves far better than a ratio between two unrelated clocks, because
    // the dear side does *strictly more work in the same process*: the same
    // instantiation, plus the compile. Contention inflates it at least as much as
    // it inflates a cached boot, so load makes this test pass more easily rather
    // than less. The cheap side is the minimum over every boot the file has paid,
    // so one descheduled render cannot break it. The measured ratio is **6.1×** in
    // isolation and **7.3–13.8× over 17 whole-suite runs** — it *widens* under
    // contention, which is the whole point; the assertion demands only 2×.
    const runtime = await engine
    for (let i = 0; i < 8; i += 1) await stl({ x: 2, y: 2 })

    const selfCompiling: number[] = []
    for (let i = 0; i < 2; i += 1) {
      const before = compilations
      const started = performance.now()
      await OpenSCAD({
        noInitialRun: true,
        wasmBinary: new Uint8Array(readFileSync(BINARY)),
        print: () => undefined,
        printErr: () => undefined,
      })
      selfCompiling.push(performance.now() - started)
      // **This is what stops the count above being a vacuous guard.** Emscripten's
      // own boot path reaches `WebAssembly.instantiate(bytes, imports)`, the
      // instrumentation sees it, and `compilations` moves — so the assertion that
      // it *stays* at 1 across renders is one that can fail, demonstrated in the
      // same file rather than asserted about.
      expect(compilations - before).toBeGreaterThan(0)
    }

    const cached = Math.min(...boots)
    const compiling = Math.min(...selfCompiling)
    // `process.stdout.write`, not `console.log`, so the figures survive the
    // default reporter and land in every CI log — the convention
    // `src/search/corpus.test.ts` set.
    process.stdout.write(
      `\n[engine] compile ${runtime.compileMs.toFixed(1)} ms · cached boot floor ${cached.toFixed(1)} ms of ` +
        `${String(boots.length)} · self-compiling boot ${selfCompiling.map((ms) => ms.toFixed(1)).join(' / ')} ms\n`,
    )

    expect(boots.length).toBeGreaterThanOrEqual(8)
    expect(cached * 2).toBeLessThan(compiling)
    expect((await stl({ x: 2, y: 2 })).runMs).toBeGreaterThan(0)
  }, 120_000)

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

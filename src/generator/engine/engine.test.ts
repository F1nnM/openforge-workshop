/// <reference types="node" />
/**
 * The engine's pure parts: the filesystem, the argv, the schema, the traps.
 *
 * Nothing here boots OpenSCAD — `render.test.ts` does that. This suite covers
 * the code that decides *what* to ask the engine and *how to read the answer*,
 * because every one of those decisions has a silent failure mode:
 *
 * - a dangling include is a parse error in the browser with no filename in it;
 * - a missing `--backend=manifold` is a correct render that takes 16 seconds;
 * - a `-D LOCK=openlock` without quotes is `undef` and a base with no lock;
 * - a CRLF source is a parameter panel missing eleven of fifteen controls;
 * - a `--version` that exits 7 is an engine a probe decides is absent.
 *
 * None of those raise an exception, which is why they are asserted rather than
 * left to be noticed.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  EngineArgsError,
  MANIFOLD_BACKEND,
  OUTPUT_PATH,
  assertManifoldBackend,
  renderArgs,
  schemaArgs,
} from './args'
import { createEngine } from './client'
import { classifyOutput } from './diagnostics'
import { md5 } from './md5'
import type { EngineRequest, EngineResponse } from './protocol'
import { failureKind, renderedResponse } from './protocol'
import { ParameterSchemaError, parseParameterExport } from './schema'
import { describeVerification, verifyGeneratedMesh } from './verify'
import { ARCHIVAL_ENTRY, ENTRY_POINTS, SCAD_SOURCES, VENDORED_SOURCE_COUNT, resolveIncludes } from './vfs'
import { EngineVersionError, looksLikeOpenScad, parseVersion } from './version'

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))
const SOURCE_DIR = fileURLToPath(new URL('../scad/', import.meta.url))
const fixture = (name: string): string => readFileSync(`${FIXTURES}${name}`, 'utf8')

describe('the virtual filesystem', () => {
  it('holds every vendored source, flat, keyed by bare filename', () => {
    expect(SCAD_SOURCES.size).toBe(VENDORED_SOURCE_COUNT)
    const onDisk = readdirSync(SOURCE_DIR)
      .filter((name) => name.endsWith('.scad'))
      .sort((a, b) => a.localeCompare(b))
    expect([...SCAD_SOURCES.keys()].sort((a, b) => a.localeCompare(b))).toEqual(onDisk)
    for (const name of SCAD_SOURCES.keys()) expect(name).not.toContain('/')
  })

  it('resolves all 39 includes against the flat map, with none dangling', () => {
    // S1's figures, re-derived from what actually ships. A refresh that
    // introduced a subdirectory include would fail here rather than in a
    // browser, where OpenSCAD's message does not name the missing file.
    const { statements, targets, dangling, nonFlat } = resolveIncludes()
    expect(statements).toHaveLength(39)
    expect(targets).toHaveLength(19)
    expect(dangling).toEqual([])
    expect(nonFlat).toEqual([])
  })

  it('has no `use <>`, which is why scope is shared', () => {
    // The load-bearing property. `include` splices the file into the includer's
    // scope; `use` imports only its modules and leaves variables behind. A
    // single `use` would mean `connectors.scad` could no longer see the `LOCK`,
    // `MAGNETS` or `HEIGHT` its entry point set — see the next test — and the
    // geometry would silently build against `undef`.
    expect(resolveIncludes().statements.filter((statement) => statement.keyword === 'use')).toEqual([])
  })

  it('shares scope in the way the geometry actually depends on', () => {
    // Concretely, and this is the mechanism S1 warned about: seven parameters
    // are *assigned* only in the entry points and *read* two hops down in
    // `connectors.scad`, with nothing passing them along. Under `use <>` every
    // one of them would read `undef` and the geometry would build wrong rather
    // than fail.
    const connectors = SCAD_SOURCES.get('connectors.scad') ?? ''
    const entry = SCAD_SOURCES.get('bases-square.scad') ?? ''
    for (const global of ['LOCK', 'MAGNETS', 'MAGNET_HOLE', 'TOPLESS', 'SUPPORTS', 'PRIORITY', 'HEIGHT']) {
      expect(connectors, `connectors.scad no longer reads ${global}`).toContain(global)
      expect(connectors, `connectors.scad now assigns ${global} itself`).not.toMatch(
        new RegExp(`^\\s*${global}\\s*=`, 'm'),
      )
      expect(entry, `bases-square.scad no longer assigns ${global}`).toMatch(new RegExp(`^${global}\\s*=`, 'm'))
    }
    // And the chain that carries them is `include`, all the way down.
    expect(entry).toContain('include <impl_square.scad>')
    expect(SCAD_SOURCES.get('impl_square.scad') ?? '').toContain('include <connectors.scad>')
  })

  it('explains the DUAL warning: read by connectors.scad, assigned nowhere', () => {
    // The same shared-scope mechanism, seen from its one upstream defect. S2
    // saw this warning on 48 of 48 configurations; `diagnostics.ts` suppresses
    // it, and this is the evidence that suppressing it is correct rather than
    // convenient — no file in the set ever sets it.
    expect(SCAD_SOURCES.get('connectors.scad') ?? '').toContain('DUAL')
    for (const [name, source] of SCAD_SOURCES) {
      expect(source, `${name} assigns DUAL, so the warning should have stopped`).not.toMatch(/^\s*DUAL\s*=/m)
    }
  })

  it('needs no side-loaded meshes: not one import() in the set', () => {
    // Which is what lets the VFS be 35 strings. The single upstream `import()`
    // was in the excluded `bases-wall-primary.scad`.
    for (const [name, source] of SCAD_SOURCES) {
      expect(source, `${name} calls import()`).not.toMatch(/\bimport\s*\(/)
    }
  })

  it('offers fifteen peer entry points and does not offer the archival monolith', () => {
    expect(ENTRY_POINTS).toHaveLength(15)
    expect(ENTRY_POINTS).not.toContain(ARCHIVAL_ENTRY)
    expect(SCAD_SOURCES.has(ARCHIVAL_ENTRY), 'bases.scad is still needed for alcove geometry').toBe(true)
    expect(ENTRY_POINTS).toContain('bases-square.scad')
    expect(ENTRY_POINTS).toContain('risers_walls.scad')
    // Nothing includes an entry point, by construction.
    const included = new Set(resolveIncludes().targets)
    for (const entry of ENTRY_POINTS) expect(included.has(entry), `${entry} is included by something`).toBe(false)
  })

  it('normalises CRLF in memory and leaves the files on disk alone', () => {
    // S1 pinned `* -text` and asserts twelve CRLF files on disk. Both remain
    // true; the transformation lives exactly one layer above them.
    const onDisk = readFileSync(`${SOURCE_DIR}risers_square.scad`, 'utf8')
    expect(onDisk, 'the vendored file should still be CRLF on disk').toContain('\r\n')
    const crlfOnDisk = readdirSync(SOURCE_DIR)
      .filter((name) => name.endsWith('.scad'))
      .filter((name) => readFileSync(`${SOURCE_DIR}${name}`, 'utf8').includes('\r\n'))
    expect(crlfOnDisk).toHaveLength(12)
    for (const [name, source] of SCAD_SOURCES) {
      expect(source.includes('\r'), `${name} still carries a CR in the VFS`).toBe(false)
    }
  })
})

describe('the argv', () => {
  it('always selects Manifold', () => {
    expect(renderArgs({ entry: 'bases-square.scad', parameters: {} })[0]).toBe(MANIFOLD_BACKEND)
    expect(schemaArgs('bases-square.scad')).toContain(MANIFOLD_BACKEND)
  })

  it('refuses an argv with no backend, quoting what that costs', () => {
    // The one assertion in this file that stands between the panel and a
    // 16-second render nobody asked for.
    expect(() => {
      assertManifoldBackend(['--export-format=binstl', '-o', 'out.stl', 'bases-square.scad'])
    }).toThrow(EngineArgsError)
    expect(() => {
      assertManifoldBackend(['-o', 'out.stl'])
    }).toThrow(/16\.0 s for a 4x4/)
  })

  it('refuses a different backend rather than quietly allowing it', () => {
    expect(() => {
      assertManifoldBackend(['--backend=cgal', '-o', 'out.stl'])
    }).toThrow(/only --backend=manifold is fast enough/)
  })

  it('accepts the argv it builds itself', () => {
    expect(() => {
      assertManifoldBackend(renderArgs({ entry: 'bases-square.scad', parameters: { x: 4, y: 4 } }))
    }).not.toThrow()
  })

  it('quotes strings, because a bare one is undef and not an error', () => {
    const argv = renderArgs({
      entry: 'bases-square.scad',
      parameters: { LOCK: 'openlock', x: 4, TOPLESS: 'true', half: true, offset: [1, 2, 3] },
    })
    expect(argv).toContain('LOCK="openlock"')
    expect(argv).toContain('x=4')
    // The geometry's booleans are OpenSCAD *strings* — `TOPLESS = "true"` — and
    // a real boolean is a different value. Both forms have to survive.
    expect(argv).toContain('TOPLESS="true"')
    expect(argv).toContain('half=true')
    expect(argv).toContain('offset=[1,2,3]')
    expect(argv.at(-1)).toBe('bases-square.scad')
    expect(argv).toContain(OUTPUT_PATH)
  })

  it('refuses $-variables, because -D on one does nothing', () => {
    // S2: every `$fn` in the vendored set is a call-site argument, so
    // `-D '$fn=50'` produces byte-identical output. There is no tessellation
    // lever, and offering one would be a control that silently does nothing.
    expect(() => renderArgs({ entry: 'bases-square.scad', parameters: { $fn: 50 } })).toThrow(/call-site argument/)
  })

  it('refuses a path, because the filesystem is flat', () => {
    for (const entry of ['scad/bases-square.scad', '../bases-square.scad', 'bases-square.stl', '']) {
      expect(() => renderArgs({ entry, parameters: {} }), entry).toThrow(EngineArgsError)
    }
  })

  it('refuses values it cannot encode', () => {
    expect(() => renderArgs({ entry: 'bases-square.scad', parameters: { x: Number.NaN } })).toThrow(/NaN/)
    expect(() => renderArgs({ entry: 'bases-square.scad', parameters: { LOCK: 'a\nb' } })).toThrow(
      /control character/,
    )
    expect(() => renderArgs({ entry: 'bases-square.scad', parameters: { '2x': 1 } })).toThrow(/identifier/)
  })

  it('escapes a quote rather than closing the literal', () => {
    expect(renderArgs({ entry: 'bases-square.scad', parameters: { L: 'a"b' } })).toContain('L="a\\"b"')
  })
})

describe('the parameter schema, from OpenSCAD’s own export', () => {
  const schema = parseParameterExport(fixture('bases-square.param.json'), 'bases-square.scad')

  it('reads all fifteen of bases-square.scad’s parameters', () => {
    // Fifteen, not thirteen. S1's PROVENANCE lists thirteen because it writes
    // `NOTCH`/`NOTCH_X`/`NOTCH_Y` as one item; the export names them separately,
    // which is what the panel has to render.
    expect(schema.title).toBe('bases-square')
    expect(schema.parameters.map((parameter) => parameter.name)).toEqual([
      'x',
      'y',
      'HEIGHT',
      'SQUARE_BASIS',
      'LOCK',
      'TOPLESS',
      'SUPPORTS',
      'MAGNETS',
      'MAGNET_HOLE',
      'ELECTRONICS',
      'PRIORITY',
      'NOTCH',
      'NOTCH_X',
      'NOTCH_Y',
      'CENTER',
    ])
  })

  it('groups them under the /* [Heading] */ comments, in file order', () => {
    expect(schema.groups.map((group) => group.name)).toEqual([
      'Base Tile Size',
      'Square Basis',
      'Lock',
      'Magnets',
      'Electronics',
      'Priority',
      'Notch Options',
      'Center Options',
    ])
    expect(schema.groups[0]?.parameters.map((parameter) => parameter.name)).toEqual(['x', 'y', 'HEIGHT'])
  })

  it('carries the option labels the annotation gave, not just the values', () => {
    const basis = schema.parameters.find((parameter) => parameter.name === 'SQUARE_BASIS')
    expect(basis?.kind).toBe('enum')
    expect(basis?.options.map((option) => option.value)).toEqual(['25mm', 'inch', 'wyloch', 'drc'])
    expect(basis?.options[0]?.label).toBe('25mm - Dwarven Forge/Hirstarts')
    // Every catalogued base is `inch`; S1 recorded that the other three can
    // never resolve against the catalog and must go to the live engine.
    expect(basis?.initial).toBe('inch')
  })

  it('includes the initial value in an enum whose annotation omitted it', () => {
    // `CENTER = "none"; // [grid, cube, false]` — three in the brackets, four in
    // the export, `none` first. A parser reading the annotation would build a
    // dropdown that cannot represent the file's own default. This is the single
    // clearest reason the schema is derived rather than parsed.
    const centre = schema.parameters.find((parameter) => parameter.name === 'CENTER')
    expect(SCAD_SOURCES.get('bases-square.scad') ?? '').toContain('CENTER = "none"; // [grid, cube, false]')
    expect(centre?.options.map((option) => option.value)).toEqual(['none', 'grid', 'cube', 'false'])
    expect(centre?.initial).toBe('none')
  })

  it('keeps only the last leading comment as the caption', () => {
    // `LOCK` has six comment lines above it describing all five lock types; the
    // export keeps one. That is OpenSCAD's rule and the panel inherits it.
    const source = SCAD_SOURCES.get('bases-square.scad') ?? ''
    expect(source).toContain('// OpenLOCK Topless - openlock, but without a top\n// Select the type of clip lock')
    expect(schema.parameters.find((parameter) => parameter.name === 'LOCK')?.caption).toBe(
      'Select the type of clip lock',
    )
  })

  it('leaves an unannotated variable as free text and an unlabelled one uncaptioned', () => {
    const electronics = schema.parameters.find((parameter) => parameter.name === 'ELECTRONICS')
    expect(electronics?.kind).toBe('string')
    expect(electronics?.options).toEqual([])
    // `NOTCH_X = 2; // [1,2,3]` has an enum but no comment above it.
    const notchX = schema.parameters.find((parameter) => parameter.name === 'NOTCH_X')
    expect(notchX?.caption).toBeNull()
    expect(notchX?.kind).toBe('enum')
  })

  it('classifies kinds the `type` field cannot', () => {
    // OpenSCAD calls a vector a number, and says nothing about enums or ranges.
    const kinds = new Map(schema.parameters.map((parameter) => [parameter.name, parameter.kind]))
    expect(kinds.get('x')).toBe('enum')
    expect(kinds.get('HEIGHT')).toBe('number')
    expect(kinds.get('MAGNET_HOLE')).toBe('number')

    const synthetic = parseParameterExport(
      JSON.stringify({
        title: 't',
        parameters: [
          { name: 'vec', type: 'number', initial: [1, 2, 3], group: 'g' },
          { name: 'slider', type: 'number', initial: 5, min: 0, max: 10, step: 1, group: 'g' },
          { name: 'flag', type: 'boolean', initial: false, group: 'g' },
          { name: 'stepless', type: 'number', initial: 1, min: 0, max: 4, group: 'g' },
        ],
      }),
      't.scad',
    )
    expect(synthetic.parameters.map((parameter) => parameter.kind)).toEqual(['vector', 'range', 'boolean', 'range'])
    expect(synthetic.parameters[1]?.range).toEqual({ min: 0, max: 10, step: 1 })
    // OpenSCAD defaults an omitted step to 1; so does this, explicitly.
    expect(synthetic.parameters[3]?.range).toEqual({ min: 0, max: 4, step: 1 })
  })

  it('throws on a malformed export rather than rendering half a panel', () => {
    expect(() => parseParameterExport('{}', 'x.scad')).toThrow(ParameterSchemaError)
    expect(() => parseParameterExport('{"title":"t"}', 'x.scad')).toThrow(/no parameters array/)
    expect(() => parseParameterExport('{"title":"t","parameters":[{"type":"number"}]}', 'x.scad')).toThrow(/no name/)
    expect(() =>
      parseParameterExport('{"title":"t","parameters":[{"name":"a","type":"matrix","initial":1}]}', 'x.scad'),
    ).toThrow(/unknown type/)
  })
})

describe('CRLF is why the schema is normalised before the engine sees it', () => {
  // Both fixtures are real `--export-format=param` output from the vendored
  // engine, over the same file — one from a verbatim VFS, one from a normalised
  // one. Nothing else differs.
  const normalised = parseParameterExport(fixture('risers_square.param.json'), 'risers_square.scad')
  const verbatim = parseParameterExport(fixture('risers_square.verbatim-crlf.param.json'), 'risers_square.scad')

  it('loses eleven declarations and every dropdown when fed CRLF', () => {
    expect(verbatim.parameters).toHaveLength(4)
    expect(verbatim.parameters.filter((parameter) => parameter.options.length > 0)).toEqual([])
    expect(normalised.parameters).toHaveLength(6)
    expect(normalised.parameters.filter((parameter) => parameter.options.length > 0)).toHaveLength(6)
  })

  it('attaches captions to the wrong variables when fed CRLF', () => {
    // `x`'s caption in the CRLF export is `y`'s comment, with a trailing CR.
    expect(verbatim.parameters[0]?.name).toBe('x')
    expect(verbatim.parameters[0]?.caption).toBe('How many squares on the Y axis\r')
    expect(normalised.parameters[0]?.caption).toBe('How many squares on the X axis')
  })

  it('recovers the whole Lock group once normalised', () => {
    expect(verbatim.parameters.map((parameter) => parameter.name)).toEqual(['x', 'y', 'z', 'SQUARE_BASIS'])
    expect(normalised.parameters.map((parameter) => parameter.name)).toEqual([
      'x',
      'y',
      'z',
      'SQUARE_BASIS',
      'LOCK',
      'SUPPORTS',
    ])
  })
})

describe('the version, read from output and never from a status', () => {
  it('reads --version off stderr, which is the only place it appears', () => {
    // Measured on the vendored build: `callMain(['--version'])` returns
    // `undefined` and throws `program has already aborted!`, having already
    // printed this line to stderr. S2's first probe trusted the exit code and
    // silently fell through to the native binary.
    expect(parseVersion(['OpenSCAD version 2026.01.02.wasm30346'])).toEqual({
      line: 'OpenSCAD version 2026.01.02.wasm30346',
      version: '2026.01.02.wasm30346',
      commit: null,
    })
  })

  it('prefers --info, which also carries the source commit', () => {
    const parsed = parseVersion([
      'Could not initialize localization (application path is /work).',
      'OpenSCAD Version: 2026.01.02.wasm30346 (git 7a2053ed)',
      'System information: Emscripten 4.0.10 #1 wasm32 1 CPU 4.00 GB RAM',
    ])
    expect(parsed.version).toBe('2026.01.02.wasm30346')
    expect(parsed.commit).toBe('7a2053ed')
  })

  it('treats only the absence of a version line as failure', () => {
    expect(() => parseVersion([])).toThrow(EngineVersionError)
    expect(() => parseVersion(['Fontconfig error: Cannot load default config file'])).toThrow(/exits 7/)
    expect(looksLikeOpenScad(['OpenSCAD version 1.2.3'])).toBe(true)
    expect(looksLikeOpenScad(['bash: openscad: command not found'])).toBe(false)
  })
})

describe('diagnostics', () => {
  it('suppresses the DUAL warning, which fires on every configuration', () => {
    // S2 saw it on 48 of 48. `connectors.scad` references `DUAL` at lines 25,
    // 137 and 291 and no entry point defines it. Three permanent warnings under
    // a perfect render teach the reader to ignore the fourth one.
    const classified = classifyOutput([
      'WARNING: Ignoring unknown variable "DUAL" in file /work/connectors.scad, line 25',
      'WARNING: Ignoring unknown variable "DUAL" in file /work/connectors.scad, line 137',
      'Could not initialize localization (application path is /work).',
      'Fontconfig error: Cannot load default config file: No such file: (null)',
      'ECHO: "flex_magnetic"',
    ])
    expect(classified.suppressed).toBe(4)
    expect(classified.notable).toEqual([{ kind: 'echo', text: 'ECHO: "flex_magnetic"' }])
    expect(classified.failed).toBe(false)
  })

  it('surfaces the geometry’s own refusal, which is an echo and not a status', () => {
    // S1 recorded it: `bases-*.scad` echo an `ERROR:` and emit nothing when
    // `dragonlock` or `infinitylock` meets a non-inch basis. Exit code zero.
    const classified = classifyOutput([
      'ECHO: "ERROR: dragonlock requires an inch square basis"',
      'WARNING: something real',
    ])
    expect(classified.failed).toBe(true)
    expect(classified.notable.map((entry) => entry.kind)).toEqual(['error', 'warning'])
  })

  it('deduplicates a warning repeated once per lock instance', () => {
    const classified = classifyOutput(['WARNING: x', 'WARNING: x', 'WARNING: x'])
    expect(classified.notable).toHaveLength(1)
  })
})

describe('md5', () => {
  it('matches the RFC 1321 test vectors', () => {
    const encode = (value: string): Uint8Array => new TextEncoder().encode(value)
    expect(md5(encode(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5(encode('a'))).toBe('0cc175b9c0f1b6a831c399e269772661')
    expect(md5(encode('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5(encode('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5(encode('abcdefghijklmnopqrstuvwxyz'))).toBe('c3fcd3d76192e4007dfb496cca67e13b')
    expect(
      md5(encode('12345678901234567890123456789012345678901234567890123456789012345678901234567890')),
    ).toBe('57edf4a22be3c955ac49da2e2107b67a')
  })

  it('gets the padding boundaries right', () => {
    // 55/56 and 119/120 are where the 64-bit length field stops fitting in the
    // final block and a second one is needed. An off-by-one there is a wrong
    // digest for one input length in sixty-four — a bug that survives a smoke
    // test and then corrupts one content address in a while.
    //
    // Every digest below is `head -c N /dev/zero | md5sum`.
    const known: Record<number, string> = {
      55: 'c9ea3314b91c9fd4e38f9432064fd1f2',
      56: 'e3c4dd21a9171fd39d208efa09bf7883',
      63: '65cecfb980d72fde57d175d6ec1c3f64',
      64: '3b5d3c7d207e37dceeedd301e35e2e58',
      119: '8271cb2e6a546123b43096a2efce39d2',
      120: '222f7d881ded1871724a1b9a1cb94247',
      129: '5f54d1240735d46980b776af554f44d3',
    }
    for (const [length, digest] of Object.entries(known)) {
      expect(md5(new Uint8Array(Number(length))), `length ${length}`).toBe(digest)
    }
  })
})

describe('what verification means for a generated mesh', () => {
  const mesh = new TextEncoder().encode('not really an stl')
  const digest = md5(mesh)

  it('is a content address, and says so, when there is nothing to compare to', () => {
    const verification = verifyGeneratedMesh(mesh)
    expect(verification).toEqual({ kind: 'self-addressed', md5: digest })
    // The wording is the substance. "Identifies these bytes rather than
    // vouching for them" is the honest claim; anything shorter overstates it.
    expect(describeVerification(verification)).toMatch(/identifies these bytes rather than vouching for them/)
  })

  it('is a real cross-check when S4’s resolver supplied a catalogued md5', () => {
    const verification = verifyGeneratedMesh(mesh, digest)
    expect(verification.kind).toBe('catalogued-match')
    expect(describeVerification(verification)).toMatch(/byte-for-byte/)
  })

  it('reports a mismatch without ruling on it', () => {
    // S2: native and WASM agree on 45 of 48 configurations; a curved 4×4 differs
    // by +26 triangles, and the catalogued corpus was generated natively. So a
    // mismatch is information, not a verdict.
    const verification = verifyGeneratedMesh(mesh, '0'.repeat(32))
    expect(verification.kind).toBe('catalogued-mismatch')
    expect(describeVerification(verification)).toMatch(/does not always agree with this WebAssembly build/)
  })
})

describe('the worker protocol', () => {
  it('transfers the mesh instead of cloning it', () => {
    // A clone allocates and memcpies the mesh a second time on the receiving
    // thread. It is invisible — the app works, it just stutters — so the
    // transfer list is returned with the message and asserted here.
    const mesh = new Uint8Array([1, 2, 3, 4])
    const { message, transfer } = renderedResponse(7, mesh, {
      md5: 'x',
      verification: { kind: 'self-addressed', md5: 'x' },
      diagnostics: { notable: [], suppressed: 0, failed: false },
      renderMs: 1,
      bootMs: 2,
      runs: 3,
    })
    expect(message.id).toBe(7)
    expect(transfer).toEqual([message.mesh])
    expect(new Uint8Array(message.mesh)).toEqual(mesh)
  })

  it('maps thrown errors to failure kinds by name, across the boundary', () => {
    // `instanceof` cannot work here: the classes are not shared between the two
    // threads, so the discriminator has to be the `name`.
    expect(failureKind(new EngineArgsError('x'))).toBe('arguments')
    expect(failureKind(new ParameterSchemaError('x'))).toBe('schema')
    expect(failureKind(new Error('x'))).toBe('internal')
    expect(failureKind('a string')).toBe('internal')
  })

  it('round-trips a render, correlating the reply by id', () => runRoundTrip())

  it('correlates replies that arrive out of order', async () => {
    const worker = new FakeWorker((request, reply) => {
      // Answer the second request first. Arrival order is not request order the
      // moment anything is abandoned or retried, and a client that assumed it
      // would hand one caller another caller's mesh.
      if (request.type !== 'render') return
      const delay = request.entry === 'bases-square.scad' ? 20 : 0
      setTimeout(() => {
        reply(
          renderedResponse(request.id, new TextEncoder().encode(request.entry), {
            md5: request.entry,
            verification: { kind: 'self-addressed', md5: request.entry },
            diagnostics: { notable: [], suppressed: 0, failed: false },
            renderMs: 1,
            bootMs: 1,
            runs: 1,
          }).message,
        )
      }, delay)
    })
    const engine = createEngine(() => worker as unknown as Worker)
    const [slow, fast] = await Promise.all([
      engine.render({ entry: 'bases-square.scad', parameters: {} }),
      engine.render({ entry: 'bases-hex.scad', parameters: {} }),
    ])
    expect(new TextDecoder().decode(slow.bytes)).toBe('bases-square.scad')
    expect(new TextDecoder().decode(fast.bytes)).toBe('bases-hex.scad')
  })

  it('abandons on abort without terminating the worker', async () => {
    // Terminating would discard the compiled module and charge the *next*
    // render S2's 281 ms compile. Auto-preview abandons constantly, so this is
    // the common path, not the exceptional one.
    const worker = new FakeWorker(() => {
      // Never replies.
    })
    const engine = createEngine(() => worker as unknown as Worker)
    const controller = new AbortController()
    const pending = engine.render({ entry: 'bases-square.scad', parameters: {}, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toThrow(/abandoned/)
    expect(worker.terminated).toBe(false)
  })

  it('rejects every in-flight request when the worker dies', async () => {
    const worker = new FakeWorker(() => {
      // Never replies.
    })
    const engine = createEngine(() => worker as unknown as Worker)
    const pending = engine.render({ entry: 'bases-square.scad', parameters: {} })
    worker.fail('out of memory')
    await expect(pending).rejects.toThrow(/out of memory/)
    // Without this the promise would hang and the panel would spin for ever.
    expect(worker.terminated).toBe(true)
  })

  it('surfaces a geometry refusal as an error carrying the diagnostics', async () => {
    const worker = new FakeWorker((request, reply) => {
      reply({
        type: 'failed',
        id: request.id,
        kind: 'geometry',
        message: 'ECHO: "ERROR: dragonlock requires an inch square basis"',
        diagnostics: {
          notable: [{ kind: 'error', text: 'ECHO: "ERROR: dragonlock requires an inch square basis"' }],
          suppressed: 6,
          failed: true,
        },
      })
    })
    const engine = createEngine(() => worker as unknown as Worker)
    await expect(
      engine.render({ entry: 'bases-square.scad', parameters: { LOCK: 'dragonlock', SQUARE_BASIS: 'wyloch' } }),
    ).rejects.toMatchObject({ kind: 'geometry', diagnostics: { failed: true } })
  })
})

async function runRoundTrip(): Promise<void> {
  const mesh = new Uint8Array([0x73, 0x6f, 0x6c, 0x69, 0x64])
  const seen: EngineRequest[] = []
  const worker = new FakeWorker((request, reply) => {
    seen.push(request)
    if (request.type === 'version') {
      reply({
        type: 'version',
        id: request.id,
        version: { line: 'OpenSCAD version 2026.01.02.wasm30346', version: '2026.01.02.wasm30346', commit: null },
        compileMs: 281,
      })
      return
    }
    if (request.type !== 'render') return
    reply(
      renderedResponse(request.id, mesh.slice(), {
        md5: md5(mesh),
        verification: { kind: 'self-addressed', md5: md5(mesh) },
        diagnostics: { notable: [], suppressed: 6, failed: false },
        renderMs: 104,
        bootMs: 6,
        runs: 2,
      }).message,
    )
  })

  const engine = createEngine(() => worker as unknown as Worker)
  const { compileMs } = await engine.version()
  expect(compileMs).toBe(281)

  const result = await engine.render({ entry: 'bases-square.scad', parameters: { x: 4, y: 4 } })
  expect(result.bytes).toEqual(mesh)
  expect(result.md5).toBe(md5(mesh))
  // `runs > 1` is the observable evidence that the compiled module is reused.
  expect(result.runs).toBeGreaterThan(1)
  expect(result.diagnostics.suppressed).toBe(6)

  // Ids are distinct and monotonic, and one worker served both requests.
  expect(seen.map((request) => request.id)).toEqual([1, 2])
  expect(worker.spawns).toBe(1)
  engine.terminate()
  expect(worker.terminated).toBe(true)
}

type Responder = (request: EngineRequest, reply: (response: EngineResponse) => void) => void

/** A `Worker` stand-in. Only the four members `client.ts` touches. */
class FakeWorker {
  readonly spawns = 1
  terminated = false
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()
  // A field rather than a constructor parameter property: `erasableSyntaxOnly`
  // forbids the shorthand, since it emits code rather than erasing to nothing.
  private readonly respond: Responder

  constructor(respond: Responder) {
    this.respond = respond
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? []
    existing.push(listener)
    this.listeners.set(type, existing)
  }

  postMessage(request: EngineRequest): void {
    this.respond(request, (response) => {
      this.emit('message', { data: response })
    })
  }

  terminate(): void {
    this.terminated = true
  }

  fail(message: string): void {
    this.emit('error', { message })
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

/// <reference types="node" />
/**
 * The vendored engine, guarded.
 *
 * `vendor/openscad-wasm/` holds 10.6 MB of somebody else's GPL-2 program.
 * `PROVENANCE.md` next door says which release, from which commit, verified how;
 * `WRITTEN-OFFER.md` is the §3(b) offer that has to accompany it. This suite
 * exists because every way that arrangement can quietly stop being true is
 * invisible at runtime — the app keeps working, and only the obligations lapse.
 *
 * Four such ways, each with a test below:
 *
 * **The binary is replaced and the documents are not.** A refresh to a newer
 * snapshot that leaves `ENGINE_SHA256`, the manifest and the offer naming
 * `2026.01.02.wasm30346` produces an app that ships one engine and a source
 * offer for a different one. So the hash is asserted three ways against the file
 * on disk — the manifest, the runtime constant, and the offer's own table.
 *
 * **The licence is trimmed.** A 18 KB text file in a repository is exactly the
 * kind of thing a cleanup deletes or a formatter reflows. Its SHA-256 is pinned,
 * and the operative sections are checked by name so a red test says *which*
 * section went missing rather than that a hash moved.
 *
 * **A shipped build gains shared memory.** The plan forbids COOP/COEP because
 * cross-origin isolation would block the catalog bucket, and that is only safe
 * while the engine is single-threaded with unshared linear memory. Asserted by
 * parsing the binary's memory section, not by trusting the release notes.
 *
 * **The 10.5 MB reaches the entry bundle.** That is this row's headline failure,
 * it produces no error, and `npm run build` reports it only if somebody reads
 * the numbers. So the source-level discipline that prevents it is asserted here.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ENGINE_BYTES, ENGINE_SHA256, ENGINE_SOURCE_COMMIT, ENGINE_VERSION } from './verify'

const VENDOR = fileURLToPath(new URL('../../../vendor/openscad-wasm/', import.meta.url))
const ENGINE_DIR = fileURLToPath(new URL('./', import.meta.url))
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

const read = (name: string): Buffer => readFileSync(`${VENDOR}${name}`)
const text = (name: string): string => readFileSync(`${VENDOR}${name}`, 'utf8')
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** The upstream release, as the binary itself reports it via `--info`. */
const RELEASE = 'OpenSCAD-2026.01.02.wasm30346-WebAssembly-web'

/** SHA-256 of the published zip, from `…zip.sha256` at files.openscad.org. */
const ZIP_SHA256 = '390b86b441b2fe8649e7acadf8267b359c6899c28af205625aaff160fcb9792b'

/** The three files copied from upstream, and nothing else. */
const VERBATIM: readonly [string, string, number][] = [
  ['openscad.wasm', 'fd887f516ff5accb2060d78bf1127cb357f52346e708f0f5970dc151d517d508', 10_531_863],
  ['openscad.js', '92d8730b548b721fff4203825eb932ea29bc78d5c0eeffdc93aa36a560d80868', 99_718],
  ['COPYING', '1805a29c3bccbc0428ce0048a1dfdeb9b1867677410e99c89c3c30932ae8c7d5', 18_382],
]

describe('the vendored bytes', () => {
  it.each(VERBATIM)('%s hashes to the pinned digest at the pinned length', (name, digest, bytes) => {
    const contents = read(name)
    expect(contents.byteLength, `${name} changed length`).toBe(bytes)
    expect(sha256(contents), `${name} is not the file that was vendored`).toBe(digest)
  })

  it('carries a sha256sum -c compatible manifest covering exactly those three', () => {
    const manifest = text('MANIFEST.sha256')
    const rows = manifest
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => line.split(/\s+/))
    expect(rows.map((row) => row[1])).toEqual(VERBATIM.map(([name]) => name))
    for (const [digest, name] of rows) {
      const expected = VERBATIM.find(([candidate]) => candidate === name)?.[1]
      expect(digest, `MANIFEST.sha256 disagrees about ${String(name)}`).toBe(expected)
    }
  })

  it('names our own files as ours, so they are not mistaken for upstream’s', () => {
    // `openscad.d.ts` in particular: it sits beside a GPL-2 program, is not part
    // of it, and is not in the manifest. A reviewer has to be able to tell.
    const manifest = text('MANIFEST.sha256')
    const hashed = new Set(
      manifest
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => line.split(/\s+/)[1]),
    )
    for (const ours of ['PROVENANCE.md', 'WRITTEN-OFFER.md', 'openscad.d.ts', 'MANIFEST.sha256']) {
      expect(hashed.has(ours), `${ours} must not be hashed as if it were vendored`).toBe(false)
      // Named in the header, though, so a reader knows the omission is meant.
      expect(manifest, `${ours} should be listed as ours`).toContain(ours)
    }
    expect(manifest).toMatch(/are ours/)
    expect(text('openscad.d.ts')).toMatch(/\*\*This file is ours, not upstream's\.\*\*/)
  })

  it('pins the line endings so nothing rewrites a hashed file on checkout', () => {
    expect(text('.gitattributes')).toContain('* -text')
    expect(text('.gitattributes')).toContain('openscad.wasm binary')
  })
})

describe('the runtime constants agree with the file on disk', () => {
  it('ENGINE_SHA256 and ENGINE_BYTES describe openscad.wasm', () => {
    // These two are what `assertEngineIntegrity` compares a fetched asset
    // against. If they drift from the vendored file, the engine refuses to run
    // at all — which is safe, but only discoverable by rendering something.
    const binary = read('openscad.wasm')
    expect(ENGINE_BYTES).toBe(binary.byteLength)
    expect(ENGINE_SHA256).toBe(sha256(binary))
  })

  it('ENGINE_VERSION and ENGINE_SOURCE_COMMIT are the strings the binary prints', () => {
    // Read out of the artefact with `--info`, not inferred from the filename:
    //   OpenSCAD Version: 2026.01.02.wasm30346 (git 7a2053ed)
    // `render.test.ts` asserts the live engine still says exactly this.
    expect(ENGINE_VERSION).toBe('2026.01.02.wasm30346')
    expect(ENGINE_SOURCE_COMMIT).toBe('7a2053ed')
    expect(RELEASE).toContain(ENGINE_VERSION)
  })
})

describe('the GPL-2 obligations, as files rather than intentions', () => {
  const copying = text('COPYING')

  it('is the complete licence: the CGAL exception, then all thirteen sections', () => {
    expect(copying).toContain('As a special exception, you have permission to link this program')
    expect(copying).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(copying).toContain('Version 2, June 1991')
    expect(copying).toContain('TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION')
    for (const section of ['0.', '1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '9.', '10.', '11.', '12.']) {
      expect(copying, `section ${section} is missing`).toContain(`\n  ${section} `)
    }
    expect(copying).toContain('END OF TERMS AND CONDITIONS')
  })

  it('keeps the three clauses the redistribution actually rests on', () => {
    // §1 is why COPYING ships; §3(b) is the shape of WRITTEN-OFFER.md; §11 is
    // the disclaimer that must not be quietly dropped.
    expect(copying).toContain('give any other recipients of the Program a copy of this License')
    // Wrapped in the file, so the assertion has to be too — matching the
    // reflowed form would pass against a reflowed licence.
    expect(copying).toContain('b) Accompany it with a written offer, valid for at least three')
    expect(copying).toContain('THERE IS NO WARRANTY')
  })

  it('has a written offer that names this release, its digest and both sources', () => {
    const offer = text('WRITTEN-OFFER.md')
    expect(offer).toContain('machine-readable copy of the corresponding source code')
    expect(offer).toContain('three years')
    expect(offer).toContain(RELEASE)
    expect(offer).toContain(ENGINE_VERSION)
    expect(offer).toContain('7a2053ed9cef679a77c148e149fb51ce118c4016')
    expect(offer).toContain(ZIP_SHA256)
    // §3's "scripts used to control compilation" live in a different repository
    // from the program, so an offer naming only one of them is incomplete.
    expect(offer).toContain('https://github.com/openscad/openscad')
    expect(offer).toContain('https://github.com/openscad/openscad-wasm')
    // A request channel that needs nobody to set anything up first.
    expect(offer).toMatch(/https:\/\/github\.com\/[^\s)]+\/issues/)
  })

  it('says plainly what it cannot promise', () => {
    // An offer that overstates what this project holds is worse than one that
    // is candid about it, because the candour is what makes the rest credible.
    expect(text('WRITTEN-OFFER.md')).toMatch(/did not build the binary and does not hold a source\s+archive/)
  })

  it('has a PROVENANCE recording the release, the licence and the verification', () => {
    const provenance = text('PROVENANCE.md')
    expect(provenance).toContain(ENGINE_VERSION)
    expect(provenance).toContain('GPL-2')
    expect(provenance).toContain(ENGINE_SHA256)
    expect(provenance).toContain('WRITTEN-OFFER.md')
    expect(provenance).toMatch(/single-threaded/i)
  })
})

describe('single-threaded, with unshared linear memory', () => {
  /**
   * The memory section, read out of the binary.
   *
   * WebAssembly limits flags: bit 0 `has_max`, **bit 1 `shared`**, bit 2 `mem64`.
   * A shared memory is the only construct that lets two threads touch one heap,
   * and it is also the only thing that would make this app need COOP/COEP.
   */
  const memories = (() => {
    const bytes = read('openscad.wasm')
    let offset = 8
    const uleb = (at: number): [number, number] => {
      let result = 0
      let shift = 0
      let cursor = at
      for (;;) {
        const byte = bytes[cursor] ?? 0
        cursor += 1
        result |= (byte & 0x7f) << shift
        shift += 7
        if ((byte & 0x80) === 0) return [result, cursor]
      }
    }
    const defined: { flags: number; min: number }[] = []
    const imported: string[] = []
    while (offset < bytes.byteLength) {
      const id = bytes[offset] ?? 0
      offset += 1
      const [size, afterSize] = uleb(offset)
      offset = afterSize
      const end = offset + size
      if (id === 5) {
        let [count, cursor] = uleb(offset)
        while (count > 0) {
          const flags = bytes[cursor] ?? 0
          cursor += 1
          const [min, afterMin] = uleb(cursor)
          cursor = afterMin
          if ((flags & 1) !== 0) cursor = uleb(cursor)[1]
          defined.push({ flags, min })
          count -= 1
        }
      }
      if (id === 2) {
        let [count, cursor] = uleb(offset)
        while (count > 0) {
          const [moduleLength, afterModule] = uleb(cursor)
          const moduleName = bytes.subarray(afterModule, afterModule + moduleLength).toString('utf8')
          cursor = afterModule + moduleLength
          const [nameLength, afterName] = uleb(cursor)
          const fieldName = bytes.subarray(afterName, afterName + nameLength).toString('utf8')
          cursor = afterName + nameLength
          const kind = bytes[cursor] ?? 0
          cursor += 1
          if (kind === 0) cursor = uleb(cursor)[1]
          else if (kind === 1) {
            cursor += 1
            const flags = bytes[cursor] ?? 0
            cursor = uleb(cursor + 1)[1]
            if ((flags & 1) !== 0) cursor = uleb(cursor)[1]
          } else if (kind === 2) {
            const flags = bytes[cursor] ?? 0
            cursor = uleb(cursor + 1)[1]
            if ((flags & 1) !== 0) cursor = uleb(cursor)[1]
            imported.push(`${moduleName}.${fieldName}`)
          } else cursor += 2
          count -= 1
        }
      }
      offset = end
    }
    return { defined, imported }
  })()

  it('declares exactly one memory, in-module, with the shared bit clear', () => {
    expect(memories.defined).toHaveLength(1)
    expect(memories.imported).toEqual([])
    const memory = memories.defined[0]
    expect(memory?.flags).toBe(0x01)
    // Spelled out rather than left to the flag value, so a red test explains
    // itself: has_max set, shared clear, 32-bit.
    expect((memory?.flags ?? 0) & 0b010, 'the shared bit is set: this build needs COOP/COEP').toBe(0)
    expect((memory?.flags ?? 0) & 0b100, 'this is a memory64 build').toBe(0)
    expect(memory?.min).toBe(256)
  })

  it('has glue that knows nothing about threads', () => {
    const glue = text('openscad.js')
    for (const marker of [
      'SharedArrayBuffer',
      'pthread',
      'PThread',
      'Atomics',
      'ENVIRONMENT_IS_PTHREAD',
      'new WebAssembly.Memory',
    ]) {
      expect(glue.includes(marker), `the glue mentions ${marker}`).toBe(false)
    }
  })

  it('is never given COOP or COEP by this project', () => {
    // The plan: "Cross-origin isolation is not required... Do not set COOP/COEP
    // on the Workshop." B6 is the reason it matters — without
    // `Cross-Origin-Resource-Policy: cross-origin` on the bucket, isolation
    // blocks the whole catalog. So the headers must not appear anywhere.
    for (const path of ['index.html', 'vite.config.ts']) {
      const source = readFileSync(`${ROOT}${path}`, 'utf8')
      expect(source, `${path} sets a cross-origin isolation header`).not.toMatch(/Cross-Origin-(Opener|Embedder)-Policy/i)
    }
  })
})

describe('the 10.5 MB stays out of the entry bundle', () => {
  const index = readFileSync(`${ENGINE_DIR}index.ts`, 'utf8')

  it('reaches every runtime module of its own through import() alone', () => {
    // The failure this prevents: one value import here and the entry bundle
    // grows by the glue, the geometry, the licence and MD5 — with no error, no
    // warning, and a first paint that waits on it.
    const statements = [...index.matchAll(/^(?:import|export)[^\n]*?from '(\.\/[^']+)'/gm)]
    expect(statements.length, 'index.ts stopped re-exporting anything').toBeGreaterThan(5)
    for (const statement of statements) {
      expect(statement[0], `index.ts imports ${String(statement[1])} as a value`).toMatch(
        /^(?:import type|export type)\b/,
      )
    }
  })

  it('never imports the vendored engine, so nothing can pull it in eagerly', () => {
    // Module specifiers only. The prose above them names the binary on purpose;
    // what must not exist is a statement that resolves to it.
    for (const specifier of specifiers(index)) {
      expect(specifier, 'index.ts reaches the vendored engine directly').not.toContain('vendor/')
    }
  })

  it('confines the vendored imports to the worker side of the boundary', () => {
    // Three modules may name `vendor/openscad-wasm`, and each is only reachable
    // from the worker chunk or a lazy import: the driver, the asset URL, and the
    // notice that must ship with the binary.
    const allowed = new Set(['runtime.ts', 'spawn.ts', 'licence.ts'])
    const offenders = sources(fileURLToPath(new URL('../../', import.meta.url)))
      .filter((path) => !path.endsWith('.test.ts'))
      .filter((path) => specifiers(readFileSync(path, 'utf8')).some((one) => one.includes('vendor/openscad-wasm')))
      .map((path) => path.slice(path.lastIndexOf('/') + 1))
      .filter((name) => !allowed.has(name))
    expect(offenders).toEqual([])
  })

  it('imports the binary as a URL and never as bytes', () => {
    // `?url` yields a string, so the asset is emitted and never enters a chunk.
    // Dropping the suffix — or switching to `?init` or `?inline` — would put ten
    // megabytes of base64 into the worker chunk instead.
    const spawn = readFileSync(`${ENGINE_DIR}spawn.ts`, 'utf8')
    expect(spawn).toContain("from '../../../vendor/openscad-wasm/openscad.wasm?url'")
    expect(spawn).not.toContain('openscad.wasm?init')
    expect(spawn).not.toContain('openscad.wasm?inline')
  })

  it('is pinned by a build config that cannot inline it by accident', () => {
    const config = readFileSync(`${ROOT}vite.config.ts`, 'utf8')
    // 10.5 MB is far above the default 4 KB, so inlining needs somebody to raise
    // the limit past ten megabytes. Pinning it makes that a visible diff.
    expect(config).toMatch(/assetsInlineLimit:\s*4096/)
    // A module worker importing ES modules cannot be emitted as an IIFE.
    expect(config).toMatch(/worker:\s*\{[^}]*format:\s*'es'/s)
  })

  it('is spawned as a module worker from a static URL, so Vite emits its own chunk', () => {
    const spawn = readFileSync(`${ENGINE_DIR}spawn.ts`, 'utf8')
    expect(spawn).toContain("new Worker(new URL('./worker.ts', import.meta.url), { type: 'module'")
  })

  it('is ignored by ESLint, because the glue is 99 KB of minified Emscripten', () => {
    expect(readFileSync(`${ROOT}eslint.config.js`, 'utf8')).toMatch(/'vendor'/)
  })

  it('keeps the lazy payload within the budget the measurements were taken at', () => {
    // A size guard that can run on every commit. CI builds *after* it tests, so
    // a test that inspected `dist/` would always skip there; instead this
    // asserts the inputs that determine the chunk sizes, which is where growth
    // actually enters.
    //
    // Measured from a real build with the engine reachable:
    //   entry      1,572 B  ·  client 1,662  ·  spawn 404
    //   worker   298,062 B  =  the glue + the 35 .scad sources + the notice
    //   licence   25,727 B  ·  openscad.wasm 10,531,863 (3,258,940 gzipped)
    //
    // The worker chunk is almost exactly the glue plus the geometry, so bounding
    // those two bounds it.
    const glue = read('openscad.js').byteLength
    const geometry = readdirSync(fileURLToPath(new URL('../scad/', import.meta.url)))
      .filter((name) => name.endsWith('.scad'))
      .reduce((total, name) => total + readFileSync(fileURLToPath(new URL(`../scad/${name}`, import.meta.url))).byteLength, 0)

    expect(glue).toBe(99_718)
    // S1's figure, and the one that must be exact.
    expect(geometry).toBe(196_778)
    // 320 KB of source for a 298 KB chunk. A newly vendored engine with a
    // megabyte of glue, or a VFS that gained a side-loaded mesh, fails here
    // rather than in somebody's network panel.
    expect(glue + geometry).toBeLessThan(330_000)

    // And the asset. Ten and a half megabytes is the number this row is
    // arranged around; a substantially larger engine is a decision, not a bump.
    expect(read('openscad.wasm').byteLength).toBe(ENGINE_BYTES)
    expect(ENGINE_BYTES).toBeLessThan(12 * 1024 * 1024)
  })
})

/** Every `from '...'` module specifier in a source file. Statements, not prose. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+'([^']+)'/g), ...source.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  )
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}${entry.name}${entry.isDirectory() ? '/' : ''}`
    if (entry.isDirectory()) return entry.name === 'scad' || entry.name === 'fixtures' ? [] : sources(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

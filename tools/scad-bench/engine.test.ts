/**
 * The missing-engine path, tested on a machine that has no engine.
 *
 * This is the assertion that matters most in CI. The failure mode row S2 must
 * never have is emitting a plausible latency figure with nothing installed — the
 * plan already contains estimates, and a second set carrying a benchmark's
 * authority would be a regression rather than a measurement. So: no engine means
 * a throw, and the throw has to be actionable.
 *
 * `resolveEngine` takes injectable `exists` and `probe` so these run identically
 * on a developer laptop that *does* have OpenSCAD in `.engines/`.
 */
import { describe, expect, it, vi } from 'vitest'

import { ENGINE_CACHE, ENGINE_DIR, missingEngineMessage, probeVersion, resolveEngine } from './engine'

const TOOL_DIR = '/repo/tools/scad-bench'
const REPO_ROOT = '/repo'
const NONE = {
  toolDir: TOOL_DIR,
  repoRoot: REPO_ROOT,
  exists: () => false,
  probe: () => Promise.reject(new Error('absent')),
  env: {},
}

/** The rejection, as an Error. `resolveEngine` never resolves with no engine. */
async function refusal(): Promise<Error> {
  try {
    await resolveEngine(NONE)
  } catch (thrown) {
    return thrown as Error
  }
  throw new Error('resolveEngine returned an engine when none exists')
}

describe('with no engine anywhere', () => {
  it('throws rather than returning an estimate', async () => {
    await expect(resolveEngine(NONE)).rejects.toThrow(/No OpenSCAD engine found/)
  })

  it('says it will not estimate, in as many words', async () => {
    await expect(resolveEngine(NONE)).rejects.toThrow(/will not estimate/)
  })

  it('lists everywhere it looked', async () => {
    const error = await refusal()
    expect(error.message).toContain(`${ENGINE_CACHE}/wasm-node/openscad.cjs`)
    expect(error.message).toContain(`${ENGINE_CACHE}/squashfs-root/AppRun`)
    expect(error.message).toContain(`${ENGINE_DIR}/wasm-node/openscad.cjs`)
    expect(error.message).toContain('openscad on PATH')
  })

  it('carries commands that actually fetch an engine, with a checksum step', async () => {
    const error = await refusal()
    expect(error.message).toContain('files.openscad.org/snapshots/')
    expect(error.message).toContain('sha256sum -c')
  })

  it('warns about the .cjs rename, which is the first thing that goes wrong', async () => {
    const error = await refusal()
    expect(error.message).toContain('openscad.cjs')
    expect(error.message).toMatch(/CommonJS/)
  })

  it('records that nothing is vendored, so B4 is not pre-empted by a fix', () => {
    const message = missingEngineMessage(REPO_ROOT, [])
    expect(message).toContain('ignored by git and by ESLint')
    expect(message).toMatch(/blocker B4/)
  })

  it('points the fetch commands at the cache directory ESLint already ignores', () => {
    expect(missingEngineMessage(REPO_ROOT, [])).toContain(`${REPO_ROOT}/${ENGINE_CACHE}`)
  })

  it('offers the environment-variable route for an engine already installed', () => {
    const message = missingEngineMessage(REPO_ROOT, [])
    expect(message).toContain('OPENSCAD=')
    expect(message).toContain('OPENSCAD_WASM=')
  })
})

describe('resolution order', () => {
  const version = 'OpenSCAD version 2026.01.02.ai30348'

  it('prefers WASM over native among the conventional paths, because S4 ships WASM', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: {},
      node: '/usr/bin/node',
    })
    expect(engine.kind).toBe('wasm')
    expect(engine.prefix[0]).toContain('openscad.cjs')
    expect(engine.command).toBe('/usr/bin/node')
  })

  it('lets --engine win over everything', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      explicit: '/opt/openscad',
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: { OPENSCAD: '/usr/bin/openscad' },
    })
    expect(engine.kind).toBe('native')
    expect(engine.command).toBe('/opt/openscad')
    expect(engine.source).toContain('--engine')
  })

  it('infers wasm from a .cjs path and native from a bare one', async () => {
    const glue = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      explicit: '/x/openscad.cjs',
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: {},
      node: '/usr/bin/node',
    })
    expect(glue.kind).toBe('wasm')
    const native = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      explicit: '/x/openscad',
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: {},
    })
    expect(native.kind).toBe('native')
  })

  it('honours an explicit kind over the extension', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      explicit: '/x/openscad.cjs',
      explicitKind: 'native',
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: {},
    })
    expect(engine.kind).toBe('native')
  })

  it('takes $OPENSCAD_WASM ahead of $OPENSCAD', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      exists: () => true,
      probe: () => Promise.resolve(version),
      env: { OPENSCAD: '/usr/bin/openscad', OPENSCAD_WASM: '/w/openscad.cjs' },
      node: '/usr/bin/node',
    })
    expect(engine.prefix[0]).toBe('/w/openscad.cjs')
  })

  it('skips a path that exists but does not answer --version', async () => {
    const probe = vi
      .fn<(command: string, args: readonly string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error('not openscad'))
      .mockResolvedValue(version)
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      exists: () => true,
      probe,
      env: {},
      node: '/usr/bin/node',
    })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(engine.kind).toBe('native')
    expect(engine.command).toContain('AppRun')
  })

  it('records the version verbatim, first line only', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      exists: () => true,
      probe: () => Promise.resolve(`${version}\nsome trailing noise\n`),
      env: {},
      node: '/usr/bin/node',
    })
    expect(engine.version).toBe(version)
  })

  it('falls through to PATH without requiring the file to exist', async () => {
    const engine = await resolveEngine({
      toolDir: TOOL_DIR,
      repoRoot: REPO_ROOT,
      exists: () => false,
      probe: (command) => (command === 'openscad' ? Promise.resolve(version) : Promise.reject(new Error('no'))),
      env: {},
    })
    expect(engine.command).toBe('openscad')
    expect(engine.source).toBe('openscad on PATH')
  })
})

/**
 * The real probe, against Node standing in for an engine.
 *
 * Needs no OpenSCAD: what is being tested is that the probe reads a version off
 * *stderr* and does not treat a non-zero exit as absence. The 2026.01.02 WASM
 * `-node` build exits 7 on `--version`, and a probe that trusted the exit code
 * skipped it and silently fell through to the native build — which would have
 * reported native latency under a WASM heading.
 */
describe('probeVersion against a stand-in', () => {
  const node = process.execPath

  it('reads the version off stderr', async () => {
    const script = 'process.stderr.write("OpenSCAD version 2026.01.02.wasm30347\\n")'
    await expect(probeVersion(node, ['-e', script])).resolves.toBe('OpenSCAD version 2026.01.02.wasm30347')
  })

  it('accepts it despite a non-zero exit, as the WASM build produces', async () => {
    const script = 'process.stderr.write("OpenSCAD version 2026.01.02.wasm30347\\n"); process.exit(7)'
    await expect(probeVersion(node, ['-e', script])).resolves.toMatch(/wasm30347/)
  })

  it('reads it off stdout too, rather than insisting on stderr', async () => {
    const script = 'process.stdout.write("OpenSCAD version 2026.01.02.ai30348\\n")'
    await expect(probeVersion(node, ['-e', script])).resolves.toMatch(/ai30348/)
  })

  it('rejects something that is not an OpenSCAD, even on a clean exit', async () => {
    await expect(probeVersion(node, ['-e', 'process.stdout.write("git version 2.43\\n")'])).rejects.toThrow(
      /not an OpenSCAD/,
    )
  })

  it('rejects a command that does not exist rather than hanging', async () => {
    await expect(probeVersion('/nonexistent/openscad', ['--version'])).rejects.toThrow(/not an OpenSCAD/)
  })
})

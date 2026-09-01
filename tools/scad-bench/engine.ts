/**
 * Finding an OpenSCAD, and refusing to invent one.
 *
 * Row S2 exists because no machine in this project had ever had OpenSCAD
 * installed, so every latency figure in the architecture plan was extrapolated
 * from triangle counts. The one failure mode that would make this harness worse
 * than useless is emitting a plausible number when there is no engine: the plan
 * already has estimates, and a second set of estimates wearing a benchmark's
 * formatting is a regression. So `resolveEngine` either returns a real binary
 * whose `--version` it has read, or it throws with the commands to fix it.
 *
 * Two engine kinds, and the difference is not cosmetic.
 *
 * - **`native`** — a platform build, invoked directly. Fast, and *not* what S4
 *   ships. Any native figure in a report has to be labelled as an upper bound on
 *   the browser's performance, never as the browser's performance.
 * - **`wasm`** — OpenSCAD's own WebAssembly build. The `-node` snapshot from
 *   files.openscad.org runs under Node as a CLI, and it is the *same compute
 *   kernel* the `-web` snapshot ships. That was checked rather than assumed: the
 *   base64-embedded module in `OpenSCAD-2026.01.02.wasm30347-WebAssembly-node`
 *   and the standalone `openscad.wasm` in `…wasm30346-WebAssembly-web` are both
 *   **10,531,863 bytes**, and differ in **517 bytes (0.0049%)** spread over 36
 *   runs of one or two bytes each, with no differing string data — the signature
 *   of shifted import indices between the two Emscripten environment targets,
 *   not of different geometry code. So a figure measured here is the browser's
 *   kernel doing the browser's work.
 *
 *   What it is *not* is the browser. Node's V8 is not a tab's V8, there is no
 *   worker boundary, no `postMessage` of the result, and no compositor competing
 *   for the core. And it is a fresh process per render, so it pays for compiling
 *   a 10.5 MB module every time where a browser worker holding a compiled
 *   `WebAssembly.Module` pays once — which is why `startupFloor` is measured and
 *   reported separately instead of being folded into the headline.
 *
 * **Nothing here is vendored.** No engine enters git, `vendor/`, `src/` or the
 * bundle: the engine lives in `ENGINE_CACHE`, which git and ESLint both already
 * ignore. That is deliberate, because blocker **B4** — whether the GPL-2 WASM
 * engine may be bundled *inside this app* — is S3's question and this row must
 * not pre-empt it. Running OpenSCAD locally to time it conveys nothing to anyone.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Where a fetched engine lives, relative to the repo root.
 *
 * `node_modules/.cache/` rather than a directory beside this file, for a boring
 * but real reason: the WASM build is a 14 MB minified CommonJS glue file, and a
 * flat ESLint config's `ignores` does not read `.gitignore`, so a gitignored
 * directory full of Emscripten output is still linted — about 200 errors' worth.
 * `node_modules/` is ignored by ESLint and git alike, so an engine here is
 * invisible to both without any config change. It is also wiped by `npm ci`,
 * which is correct: the engine is re-fetchable and is not an input this
 * repository keeps.
 *
 * `eslint.config.js` now carries an ignore for `.engines` directories as well,
 * so `ENGINE_DIR` is safe too. This stays the documented default because it needs
 * no config entry in order to hold.
 */
export const ENGINE_CACHE = 'node_modules/.cache/scad-bench/engines'

/**
 * A second, hand-managed location beside this file, kept because somebody will
 * put a binary there. A *native* binary is fine; a `.cjs`/`.js` glue here will be
 * linted, so `ENGINE_CACHE` is what the instructions point at.
 */
export const ENGINE_DIR = '.engines'

export type EngineKind = 'native' | 'wasm'

export interface Engine {
  readonly kind: EngineKind
  /** The executable actually spawned — the binary, or the Node that runs the glue. */
  readonly command: string
  /** Arguments that precede the OpenSCAD argv. Empty for native; the glue path for wasm. */
  readonly prefix: readonly string[]
  /** `OpenSCAD version 2026.01.02.ai30348`, verbatim from `--version`. */
  readonly version: string
  /** How this engine was found, for the reproducibility header. */
  readonly source: string
}

/** Conventional locations, in preference order. `base` is the directory root. */
interface Candidate {
  readonly kind: EngineKind
  readonly base: 'cache' | 'tool'
  readonly relative: string
  readonly note: string
}

const CANDIDATES: readonly Candidate[] = [
  { kind: 'wasm', base: 'cache', relative: 'wasm-node/openscad.cjs', note: 'extracted -WebAssembly-node snapshot' },
  { kind: 'native', base: 'cache', relative: 'squashfs-root/AppRun', note: 'extracted AppImage' },
  { kind: 'native', base: 'cache', relative: 'openscad', note: 'a native binary dropped in by hand' },
  { kind: 'wasm', base: 'tool', relative: 'wasm-node/openscad.cjs', note: 'hand-managed; will be linted' },
  { kind: 'native', base: 'tool', relative: 'squashfs-root/AppRun', note: 'hand-managed' },
  { kind: 'native', base: 'tool', relative: 'openscad', note: 'hand-managed' },
]

/** Native names to try on `PATH`, last. */
const PATH_NAMES = ['openscad', 'openscad-nightly'] as const

export interface ResolveOptions {
  /** `--engine <path>`. A `.cjs`/`.js` path is treated as the WASM glue. */
  readonly explicit?: string
  /** `--engine-kind`, when an explicit path's extension does not settle it. */
  readonly explicitKind?: EngineKind
  /** Absolute path of `tools/scad-bench`. */
  readonly toolDir: string
  /** Absolute path of the repo root, for `ENGINE_CACHE`. Defaults to `toolDir/../..`. */
  readonly repoRoot?: string
  /** Node executable used to run the WASM glue. Defaults to this process's own. */
  readonly node?: string
  /** Injectable for the tests, which must run with no OpenSCAD anywhere. */
  readonly probe?: (command: string, args: readonly string[]) => Promise<string>
  /** Injectable existence check, for the same reason. */
  readonly exists?: (path: string) => boolean
  /** `process.env` by default. */
  readonly env?: Readonly<Record<string, string | undefined>>
}

/**
 * The first engine that exists and answers `--version`.
 *
 * Order: `--engine`, then `$OPENSCAD_WASM`, then `$OPENSCAD`, then the
 * conventional paths under `ENGINE_CACHE` and `.engines/`, then `PATH`. WASM is preferred over
 * native among the conventional paths because it is the engine S4 ships; a
 * native run is the comparison, not the answer.
 */
export async function resolveEngine(options: ResolveOptions): Promise<Engine> {
  const exists = options.exists ?? existsSync
  const probe = options.probe ?? probeVersion
  const env = options.env ?? process.env
  const node = options.node ?? process.execPath
  const searched: string[] = []

  const repoRoot = options.repoRoot ?? join(options.toolDir, '..', '..')
  for (const attempt of attempts(options, { env, node, exists, searched, repoRoot })) {
    if (attempt.mustExist && !exists(attempt.path)) continue
    const version = await probe(attempt.command, [...attempt.prefix, '--version']).catch(() => undefined)
    if (version === undefined) continue
    return {
      kind: attempt.kind,
      command: attempt.command,
      prefix: attempt.prefix,
      version: version.trim().split('\n')[0] ?? version.trim(),
      source: attempt.source,
    }
  }

  throw new Error(missingEngineMessage(repoRoot, searched))
}

interface Attempt {
  readonly kind: EngineKind
  readonly command: string
  readonly prefix: readonly string[]
  readonly path: string
  readonly mustExist: boolean
  readonly source: string
}

interface AttemptContext {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly node: string
  readonly exists: (path: string) => boolean
  readonly searched: string[]
  readonly repoRoot: string
}

function attempts(options: ResolveOptions, context: AttemptContext): Attempt[] {
  const list: Attempt[] = []
  const push = (attempt: Attempt): void => {
    context.searched.push(attempt.source)
    list.push(attempt)
  }

  if (options.explicit !== undefined) {
    push(described(options.explicit, options.explicitKind, context.node, '--engine'))
  }
  const fromWasmEnv = context.env.OPENSCAD_WASM
  if (fromWasmEnv !== undefined && fromWasmEnv !== '') {
    push(described(fromWasmEnv, 'wasm', context.node, '$OPENSCAD_WASM'))
  }
  const fromEnv = context.env.OPENSCAD
  if (fromEnv !== undefined && fromEnv !== '') {
    push(described(fromEnv, options.explicitKind, context.node, '$OPENSCAD'))
  }
  for (const candidate of CANDIDATES) {
    const root = candidate.base === 'cache' ? join(context.repoRoot, ENGINE_CACHE) : join(options.toolDir, ENGINE_DIR)
    const label = candidate.base === 'cache' ? ENGINE_CACHE : ENGINE_DIR
    push(
      described(
        join(root, candidate.relative),
        candidate.kind,
        context.node,
        `${label}/${candidate.relative} (${candidate.note})`,
      ),
    )
  }
  for (const name of PATH_NAMES) {
    push({ kind: 'native', command: name, prefix: [], path: name, mustExist: false, source: `${name} on PATH` })
  }
  return list
}

/** Extension decides the kind when nothing else does: glue is `.cjs`/`.js`/`.mjs`. */
function described(path: string, kind: EngineKind | undefined, node: string, source: string): Attempt {
  const looksLikeGlue = /\.(cjs|mjs|js)$/.test(path)
  const resolved: EngineKind = kind ?? (looksLikeGlue ? 'wasm' : 'native')
  if (resolved === 'wasm') {
    return { kind: 'wasm', command: node, prefix: [path], path, mustExist: true, source: `${source} → ${path}` }
  }
  return { kind: 'native', command: path, prefix: [], path, mustExist: true, source: `${source} → ${path}` }
}

/**
 * `--version`, tolerating two engine quirks that a naive probe fails on.
 *
 * 1. **The version goes to stderr, not stdout.** Both builds.
 * 2. **The WASM build exits non-zero.** Measured: the 2026.01.02 `-node`
 *    snapshot prints `OpenSCAD version 2026.01.02.wasm30347` on stderr and then
 *    **exits 7**, where the native AppImage exits 0. `execFile` rejects on a
 *    non-zero exit, so a probe that only reads the resolved value silently skips
 *    the WASM engine and quietly falls through to native — which is the one
 *    substitution this row must never make without saying so. So the output is
 *    inspected either way, and only the *absence* of a version string is a
 *    failure.
 */
export async function probeVersion(command: string, args: readonly string[]): Promise<string> {
  const options = { timeout: 60_000, maxBuffer: 8 << 20 }
  const text = await run(command, [...args], options).then(
    ({ stdout, stderr }) => `${stdout}${stderr}`,
    (error: unknown) => {
      const failure = error as { stdout?: string; stderr?: string }
      return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
    },
  )
  const line = text.split('\n').find((candidate) => /OpenSCAD version/i.test(candidate))
  if (line === undefined) throw new Error(`not an OpenSCAD: ${command}`)
  return line
}

/**
 * The message a maintainer with no OpenSCAD sees.
 *
 * It has to be actionable, so it carries the exact fetch commands rather than a
 * pointer to a document. The `-node` snapshot must be renamed to `.cjs`: the
 * build is CommonJS, the repo is `"type": "module"`, and a `.js` under this tree
 * therefore fails with `require is not defined in ES module scope` — a
 * confusing error to hit while trying to get a benchmark to run at all.
 */
export function missingEngineMessage(repoRoot: string, searched: readonly string[]): string {
  const dir = join(repoRoot, ENGINE_CACHE)
  return [
    'No OpenSCAD engine found, and this harness will not estimate.',
    '',
    'Searched, in order:',
    ...searched.map((entry) => `  - ${entry}`),
    '',
    'Install one. The WASM build is the engine row S4 ships, so prefer it:',
    '',
    `  mkdir -p ${dir} && cd ${dir}`,
    '  V=OpenSCAD-2026.01.02.wasm30347-WebAssembly-node',
    '  curl -sSLO https://files.openscad.org/snapshots/$V.zip',
    '  curl -sSLO https://files.openscad.org/snapshots/$V.zip.sha256',
    '  sha256sum -c $V.zip.sha256',
    '  unzip -q $V.zip -d wasm-node',
    '  # the build is CommonJS and this repo is "type": "module"',
    '  mv wasm-node/openscad.js wasm-node/openscad.cjs',
    '',
    'A native build, for the native-versus-WASM comparison only:',
    '',
    '  A=OpenSCAD-2026.01.02.ai30348-x86_64.AppImage',
    '  curl -sSLO https://files.openscad.org/snapshots/$A',
    '  curl -sSLO https://files.openscad.org/snapshots/$A.sha256',
    '  sha256sum -c $A.sha256 && chmod +x $A && ./$A --appimage-extract',
    '',
    'Or point at one you already have:',
    '',
    '  OPENSCAD=/usr/bin/openscad npm run scad-bench',
    '  OPENSCAD_WASM=/path/to/openscad.cjs npm run scad-bench',
    '',
    `Nothing is vendored: ${ENGINE_CACHE}/ is ignored by git and by ESLint. No`,
    'engine enters git, src/, vendor/ or the bundle — bundling the GPL-2 WASM engine is',
    'blocker B4 and row S3.',
  ].join('\n')
}

/**
 * Roughly what fraction of a run is fixed cost rather than geometry.
 *
 * The WASM engine pays for compiling a 10.5 MB module on every process start,
 * and a browser worker that keeps a compiled `WebAssembly.Module` around does
 * not. Reporting a raw wall-clock per render without this decomposition
 * overstates the browser's cost, so the sweep always measures a near-empty model
 * and the report subtracts it.
 */
export const STARTUP_FLOOR_SOURCE = 'cube(0.01);\n'

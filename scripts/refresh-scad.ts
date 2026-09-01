#!/usr/bin/env tsx
/**
 * Verify — and, deliberately, refresh — the vendored OpenSCAD geometry.
 *
 *     npm run refresh:scad                     # offline: hash disk against the manifest
 *     npm run refresh:scad -- --fetch          # network: diff upstream@SHA against disk
 *     npm run refresh:scad -- --head           # network: has upstream master left the pin?
 *     npm run refresh:scad -- --fetch --write  # adopt upstream: write files, rewrite manifest
 *     npm run refresh:scad -- --fetch --sha=<sha>   # diff against some other commit
 *
 * `src/generator/scad/` is 35 files copied byte-for-byte from `MasterworkTools/
 * openforge-bases` at a pinned commit. `src/generator/PROVENANCE.md` says where from
 * and why; this script is the mechanism that keeps that document from becoming
 * fiction.
 *
 * ## Two things it refuses to do
 *
 * **It does not touch the network unless asked.** The default mode — no arguments,
 * which is what CI runs — recomputes SHA-256 over the files on disk and compares
 * them to `MANIFEST.sha256`. That catches the failure that actually happens: a
 * well-meant reformat, an editor stripping trailing whitespace, an EOL
 * normalisation on a Windows checkout. Catching it needs no token, no rate limit,
 * no GitHub outage to survive, and no third-party host in the build's trust path.
 * A refresh script whose *verify* step calls out over HTTP is a build that fails
 * for reasons unrelated to the code.
 *
 * **It does not overwrite on `--fetch`.** `--fetch` prints a per-file unified diff
 * and exits non-zero. Adopting an upstream change is a decision — the customizer
 * annotations in those files are S3's parameter schema and their defaults are what
 * S4's resolver hashes against the catalogued corpus, so an upstream edit can
 * change the meaning of an unset parameter. That belongs in a diff a human reads,
 * not in a working tree that silently moved. `--write` is the separate, explicit
 * verb.
 *
 * ## How drift is detected, by kind
 *
 * | Kind | Caught by | Network |
 * | --- | --- | --- |
 * | our copy edited | default mode; `scad.test.ts` | no |
 * | our copy reformatted / EOL-normalised | default mode, and named as such | no |
 * | upstream moved past the pin | `--head` | yes, opt-in |
 * | upstream changed a file we vendor | `--fetch` | yes, opt-in |
 * | upstream added a file we do not vendor | `--fetch` | yes, opt-in |
 *
 * Only the first two are in CI. The others are questions somebody asks on purpose.
 *
 * Fetching is per-file over `raw.githubusercontent.com` (~197 KB) plus one call to
 * the tree API, rather than the release tarball — that tarball is **48 MB**, almost
 * all of it the blank texture STLs and example renders `PROVENANCE.md` explains we
 * do not want. `GITHUB_TOKEN` is used if present, purely for the rate limit.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'MasterworkTools/openforge-bases'

/**
 * The pinned commit. Changing this constant is not a refresh — run `--fetch
 * --write` and update `PROVENANCE.md`'s table in the same commit, or the document
 * and the bytes disagree.
 */
const PINNED_SHA = 'e6dbbffc40e937fd5e7ddf13562c021c15b98034'

const SCAD_DIR = fileURLToPath(new URL('../src/generator/scad/', import.meta.url))
const MANIFEST = 'MANIFEST.sha256'

/**
 * Written for this copy rather than fetched, so `--fetch` must not look for them
 * upstream and `--write` must not delete them. `PROVENANCE.md` explains both.
 */
const OURS = new Set(['NOTICE', '.gitattributes', MANIFEST])

/**
 * Upstream `.scad` files we do not vendor, with the reason, so `--fetch` can report
 * "excluded on purpose" instead of "missing". Adding a name here without a matching
 * section in `PROVENANCE.md` is how an exclusion becomes folklore.
 */
const EXCLUDED = new Map([
  [
    'bases-wall-primary.scad',
    'textured primary walls — import()s 82.9 MiB of blank texture STLs; nothing includes it',
  ],
])

// GitHub rejects API requests without one. Unrelated to the Cloudflare 403 on
// objects.openforge.tools that tools/thumbnails/fetch.ts documents; this host has
// its own rule.
const USER_AGENT = 'openforge-workshop refresh-scad (+https://github.com/MasterworkTools)'

interface Options {
  fetchUpstream: boolean
  head: boolean
  write: boolean
  sha: string
}

function parseArgs(argv: readonly string[]): Options {
  const sha = argv.find((arg) => arg.startsWith('--sha='))?.slice('--sha='.length)
  const unknown = argv.filter(
    (arg) => !['--fetch', '--head', '--write'].includes(arg) && !arg.startsWith('--sha='),
  )
  if (unknown.length > 0) {
    throw new Error(`unknown argument(s): ${unknown.join(', ')}\nSee the header of ${'scripts/refresh-scad.ts'}.`)
  }
  return {
    fetchUpstream: argv.includes('--fetch'),
    head: argv.includes('--head'),
    write: argv.includes('--write'),
    sha: sha && sha.length > 0 ? sha : PINNED_SHA,
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** `sha256sum -c` format, so a reviewer can verify with the shell and no Node. */
function readManifest(): Map<string, string> {
  const text = readFileSync(join(SCAD_DIR, MANIFEST), 'utf8')
  const entries = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line)
    if (!match?.[1] || !match[2]) throw new Error(`${MANIFEST}: unparseable line: ${line}`)
    entries.set(match[2], match[1])
  }
  return entries
}

function writeManifest(files: ReadonlyMap<string, Uint8Array>): void {
  const lines = [...files.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => `${sha256(files.get(name) as Uint8Array)}  ${name}`)
  writeFileSync(join(SCAD_DIR, MANIFEST), `${lines.join('\n')}\n`)
}

/** Everything on disk that claims to be vendored — i.e. everything but our own additions. */
function vendoredOnDisk(): string[] {
  return readdirSync(SCAD_DIR)
    .filter((name) => !OURS.has(name))
    .sort()
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KiB`
}

function eolProfile(bytes: Uint8Array): { crlf: number; lf: number } {
  const text = Buffer.from(bytes).toString('utf8')
  const crlf = (text.match(/\r\n/g) ?? []).length
  return { crlf, lf: (text.match(/\n/g) ?? []).length - crlf }
}

// ---------------------------------------------------------------- verify (offline)

interface VerifyResult {
  ok: boolean
  lines: string[]
}

function verify(): VerifyResult {
  const manifest = readManifest()
  const disk = vendoredOnDisk()
  const lines: string[] = []
  let bad = 0
  let total = 0

  for (const name of disk) {
    if (!manifest.has(name)) {
      lines.push(`  ${name}: on disk but not in ${MANIFEST} — vendored without a checksum?`)
      bad += 1
    }
  }

  for (const [name, expected] of [...manifest].sort()) {
    let bytes: Uint8Array
    try {
      bytes = readFileSync(join(SCAD_DIR, name))
    } catch {
      lines.push(`  ${name}: MISSING`)
      bad += 1
      continue
    }
    total += bytes.byteLength
    const actual = sha256(bytes)
    if (actual === expected) continue
    bad += 1
    lines.push(`  ${name}: CHANGED`)
    lines.push(`      expected ${expected}`)
    lines.push(`      actual   ${actual}  (${formatBytes(bytes.byteLength)})`)
    lines.push(`      ${describeLocalChange(name, bytes)}`)
  }

  if (bad === 0) {
    lines.push(
      `  ${String(manifest.size)} files, ${formatBytes(total)} — every checksum matches ${MANIFEST}`,
    )
  }
  return { ok: bad === 0, lines }
}

/**
 * Why a hash moved, when the answer is boring. A reformat or an EOL rewrite is by
 * far the likeliest cause and the one whose diff is least readable, so it is worth
 * saying out loud rather than leaving a reviewer to stare at 64 hex digits.
 */
function describeLocalChange(name: string, bytes: Uint8Array): string {
  const eol = eolProfile(bytes)
  if (eol.crlf > 0 && eol.lf > 0) {
    return `mixed line endings on disk (${String(eol.crlf)} CRLF, ${String(eol.lf)} LF) — partial normalisation?`
  }
  const expectedCrlf = CRLF_UPSTREAM.has(name)
  if (expectedCrlf && eol.crlf === 0) {
    return 'this file is CRLF upstream and is now LF — line endings were normalised, see scad/.gitattributes'
  }
  if (!expectedCrlf && eol.crlf > 0) {
    return 'this file is LF upstream and is now CRLF — a Windows checkout without scad/.gitattributes'
  }
  return 'content differs; run with --fetch to see it against upstream'
}

/** The twelve files that are CRLF at the pinned commit. Duplicated in scad.test.ts, which asserts it. */
const CRLF_UPSTREAM = new Set([
  'connectors.scad',
  'impl_curved.scad',
  'impl_hex.scad',
  'impl_square.scad',
  'lock_dragonlock.scad',
  'lock_flex_magnetic.scad',
  'lock_infinitylock.scad',
  'lock_magnetic.scad',
  'lock_openlock.scad',
  'lock_openlock_topless.scad',
  'risers_curved.scad',
  'risers_square.scad',
])

// ---------------------------------------------------------------- fetch (network)

async function get(url: string, accept: string): Promise<Uint8Array> {
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!response.ok) {
    const hint =
      response.status === 403 || response.status === 429
        ? ' — rate limited; set GITHUB_TOKEN'
        : response.status === 404
          ? ' — wrong SHA, or the file is gone upstream'
          : ''
    throw new Error(`${String(response.status)} ${response.statusText} for ${url}${hint}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function resolveHead(): Promise<string> {
  const body: unknown = JSON.parse(
    Buffer.from(await get(`https://api.github.com/repos/${REPO}/commits/HEAD`, 'application/vnd.github+json')).toString('utf8'),
  )
  const sha = (body as { sha?: unknown }).sha
  if (typeof sha !== 'string') throw new Error('commits/HEAD returned no sha')
  return sha
}

/** Root-level blob names at `sha`. One call, so `--fetch` can spot files added upstream. */
async function upstreamRootNames(sha: string): Promise<string[]> {
  const body: unknown = JSON.parse(
    Buffer.from(
      await get(`https://api.github.com/repos/${REPO}/git/trees/${sha}`, 'application/vnd.github+json'),
    ).toString('utf8'),
  )
  const tree = (body as { tree?: unknown }).tree
  if (!Array.isArray(tree)) throw new Error(`git/trees/${sha} returned no tree`)
  return tree
    .filter((entry): entry is { path: string; type: string } => {
      const e = entry as { path?: unknown; type?: unknown }
      return typeof e.path === 'string' && e.type === 'blob'
    })
    .map((entry) => entry.path)
}

async function fetchVendored(sha: string, names: readonly string[]): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  // Serial on purpose: 36 small files, and a burst of parallel requests is the
  // fastest way to meet the unauthenticated rate limit.
  for (const name of names) {
    files.set(name, await get(`https://raw.githubusercontent.com/${REPO}/${sha}/${name}`, 'text/plain'))
  }
  return files
}

// ---------------------------------------------------------------- diff

/**
 * Unified diff over lines, LCS by dynamic programming. No dependency: the whole
 * point of this script is that reviewing 197 KB of somebody else's geometry needs
 * nothing but Node.
 */
function unifiedDiff(before: string, after: string, context = 2): string[] {
  const a = before.split('\n')
  const b = after.split('\n')
  if (a.length > 5000 || b.length > 5000) {
    const at = a.findIndex((line, i) => line !== b[i])
    return [`    (${String(a.length)} → ${String(b.length)} lines, too large to diff; first difference at line ${String(at + 1)})`]
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    const row = lcs[i] as number[]
    const next = lcs[i + 1] as number[]
    for (let j = b.length - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number)
    }
  }

  const ops: { sign: ' ' | '-' | '+'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ sign: ' ', text: a[i] as string })
      i += 1
      j += 1
    } else if ((lcs[i + 1] as number[])[j]! >= (lcs[i] as number[])[j + 1]!) {
      ops.push({ sign: '-', text: a[i] as string })
      i += 1
    } else {
      ops.push({ sign: '+', text: b[j] as string })
      j += 1
    }
  }
  for (; i < a.length; i += 1) ops.push({ sign: '-', text: a[i] as string })
  for (; j < b.length; j += 1) ops.push({ sign: '+', text: b[j] as string })

  // Keep changed lines plus `context` unchanged ones either side; elide the rest.
  const keep = new Set<number>()
  ops.forEach((op, index) => {
    if (op.sign === ' ') return
    for (let k = index - context; k <= index + context; k += 1) if (k >= 0 && k < ops.length) keep.add(k)
  })

  const out: string[] = []
  let elided = false
  ops.forEach((op, index) => {
    if (!keep.has(index)) {
      if (!elided) out.push('    ...')
      elided = true
      return
    }
    elided = false
    out.push(`    ${op.sign}${op.text}`)
  })
  return out
}

/** Byte-level first, because an EOL-only change is invisible in a line diff. */
function compare(name: string, ours: Uint8Array, theirs: Uint8Array): string[] {
  if (Buffer.from(ours).equals(Buffer.from(theirs))) return []
  const ourText = Buffer.from(ours).toString('utf8')
  const theirText = Buffer.from(theirs).toString('utf8')
  if (ourText.replace(/\r\n/g, '\n') === theirText.replace(/\r\n/g, '\n')) {
    const o = eolProfile(ours)
    const t = eolProfile(theirs)
    return [
      `  ${name}: LINE ENDINGS ONLY (ours ${String(o.crlf)} CRLF/${String(o.lf)} LF, upstream ${String(t.crlf)} CRLF/${String(t.lf)} LF)`,
      '      Text is identical. Do not adopt this: it is a checkout artefact, not an upstream edit.',
    ]
  }
  const annotationRisk = /^\s*(\/\*\s*\[|\/\/)/m
  const touchesAnnotations =
    unifiedDiff(ourText, theirText)
      .filter((line) => line.startsWith('    -') || line.startsWith('    +'))
      .some((line) => annotationRisk.test(line.slice(5)) || /;\s*\/\/\s*\[/.test(line))
  return [
    `  ${name}: CHANGED (${formatBytes(ours.byteLength)} → ${formatBytes(theirs.byteLength)})`,
    ...(touchesAnnotations
      ? ['      NOTE: the diff touches comment lines — these carry the customizer parameter schema.']
      : []),
    ...unifiedDiff(ourText, theirText),
  ]
}

// ---------------------------------------------------------------- modes

async function runHead(): Promise<number> {
  const head = await resolveHead()
  if (head === PINNED_SHA) {
    process.stdout.write(`upstream ${REPO} master is still at the pin ${PINNED_SHA}\n`)
    return 0
  }
  process.stdout.write(
    [
      `upstream ${REPO} master has moved`,
      `  pinned  ${PINNED_SHA}`,
      `  master  ${head}`,
      '',
      'This is information, not a failure — the pin is deliberate. To see what changed:',
      `  npm run refresh:scad -- --fetch --sha=${head}`,
      '',
    ].join('\n'),
  )
  return 0
}

async function runFetch(options: Options): Promise<number> {
  const manifest = readManifest()
  const names = [...manifest.keys()].sort()
  process.stdout.write(`fetching ${String(names.length)} files from ${REPO}@${options.sha}\n`)

  const rootNames = await upstreamRootNames(options.sha)
  const theirs = await fetchVendored(options.sha, names)

  const report: string[] = []
  let changed = 0
  for (const name of names) {
    const ours = readFileSync(join(SCAD_DIR, name))
    const lines = compare(name, ours, theirs.get(name) as Uint8Array)
    if (lines.length > 0) {
      changed += 1
      report.push(...lines)
    }
  }

  const known = new Set([...names, ...EXCLUDED.keys()])
  const added = rootNames.filter((name) => name.endsWith('.scad') && !known.has(name))
  const gone = names.filter((name) => !rootNames.includes(name))

  for (const name of added) {
    report.push(`  ${name}: NEW UPSTREAM FILE, not vendored — decide, then add it or list it in EXCLUDED`)
  }
  for (const name of gone) {
    report.push(`  ${name}: no longer exists upstream at this SHA`)
  }
  for (const [name, why] of EXCLUDED) {
    if (rootNames.includes(name)) process.stdout.write(`  ${name}: still excluded — ${why}\n`)
  }

  if (report.length === 0) {
    process.stdout.write(
      `\nno drift: all ${String(names.length)} vendored files are byte-identical to ${REPO}@${options.sha}\n`,
    )
    return 0
  }

  process.stdout.write(`\n${report.join('\n')}\n`)
  if (!options.write) {
    process.stdout.write(
      [
        '',
        `${String(changed)} changed, ${String(added.length)} added upstream, ${String(gone.length)} removed upstream. Nothing was written.`,
        '',
        'Adopting this is a decision, not a formality — the comment annotations above are',
        'S3’s parameter schema and the defaults are what S4’s resolver hashes against the',
        '1,962 catalogued bases. Read the diff. If you want it:',
        '',
        `  npm run refresh:scad -- --fetch --sha=${options.sha} --write`,
        '',
        'then update PINNED_SHA in this file and the table in src/generator/PROVENANCE.md.',
        '',
      ].join('\n'),
    )
    return 1
  }

  if (gone.length > 0) {
    process.stdout.write(
      `\nrefusing to --write: ${gone.join(', ')} no longer exist upstream. Remove them here by hand and say why in PROVENANCE.md.\n`,
    )
    return 1
  }

  for (const [name, bytes] of theirs) writeFileSync(join(SCAD_DIR, name), bytes)
  writeManifest(theirs)
  process.stdout.write(
    [
      '',
      `wrote ${String(theirs.size)} files and regenerated ${MANIFEST}.`,
      '',
      'Still to do, by hand:',
      `  - PINNED_SHA in scripts/refresh-scad.ts  →  ${options.sha}`,
      '  - the table, sizes and counts in src/generator/PROVENANCE.md',
      '  - CRLF_UPSTREAM here and in src/generator/scad.test.ts, if line endings moved',
      '  - npx vitest run src/generator',
      '',
    ].join('\n'),
  )
  return 0
}

function runVerify(): number {
  const { ok, lines } = verify()
  process.stdout.write(`${ok ? 'vendored geometry verified' : 'VENDORED GEOMETRY HAS DRIFTED'}\n`)
  process.stdout.write(`${lines.join('\n')}\n`)
  if (!ok) {
    process.stdout.write(
      [
        '',
        'These files are byte-for-byte copies; nothing in this repository may edit them.',
        'Either restore them (git checkout -- src/generator/scad) or, if upstream really',
        'did change, adopt it deliberately:',
        '',
        '  npm run refresh:scad -- --fetch          # read the diff first',
        '  npm run refresh:scad -- --fetch --write',
        '',
      ].join('\n'),
    )
  }
  return ok ? 0 : 1
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2))
  if (options.write && !options.fetchUpstream) {
    process.stdout.write('--write only means something with --fetch: there is nothing local to write.\n')
    return 1
  }
  if (options.head) return await runHead()
  if (options.fetchUpstream) return await runFetch(options)
  return runVerify()
}

process.exitCode = await main()

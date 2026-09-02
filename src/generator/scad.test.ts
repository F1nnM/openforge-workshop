/// <reference types="node" />
/**
 * The vendored geometry, guarded.
 *
 * `scad/` is 35 byte-for-byte copies of somebody else's OpenSCAD sources —
 * `PROVENANCE.md` next door says whose, from which commit, and under what licence.
 * Nothing imports them yet: S3 wires the WASM engine, S4 the parameter panel. This
 * suite exists because by the time either of those rows lands, the ways this copy
 * can be quietly wrong will all have had months to happen.
 *
 * Three of them are worth naming, because none looks like a bug:
 *
 * **A dangling include.** S3's virtual filesystem is a flat map from bare filename
 * to source text. OpenSCAD resolves `include <impl_square.scad>` against it, and a
 * target that is absent — or that names a subdirectory the flat map has no concept
 * of — surfaces in the browser as a parse failure whose message does not mention
 * the missing file. So every one of the 39 statements is resolved here, at build
 * time, against the set that actually ships.
 *
 * **A reformat.** The `//` and `/* [ ... ] *\/` comments in these files are not
 * comments. S3 derives its parameter schema from OpenSCAD's own
 * `--export-format=param`, which reads that syntax as data: group headings,
 * descriptions, enum domains, option labels. Normalise the whitespace before a
 * `//`, reflow a long enum, strip a trailing space, and the file still compiles
 * while a parameter silently loses its dropdown. The whole-file SHA-256 assertions
 * catch any of it; the annotation spot-checks below say *why* it matters, in terms
 * a reviewer looking at a red test can act on.
 *
 * **A line-ending normalisation.** Twelve of these files are CRLF upstream and
 * fifteen have no trailing newline. `scad/.gitattributes` pins `* -text`, but the
 * CRLF split is asserted here too, so a normalisation fails as "these twelve files
 * should be CRLF" rather than as thirty-six unexplained hash mismatches.
 *
 * The numbers in the tables below are quoted in `PROVENANCE.md` and in the PR
 * series' S1 row, which is the other half of the point: a refresh that changes them
 * has to change the documents too.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

const SCAD_DIR = fileURLToPath(new URL('./scad/', import.meta.url))
const GENERATOR_DIR = fileURLToPath(new URL('./', import.meta.url))

/** Upstream `MasterworkTools/openforge-bases`, "created dual connector walls". */
const PINNED_SHA = 'e6dbbffc40e937fd5e7ddf13562c021c15b98034'

/** Row S1's facts. `196,778` is the one that must be exact. */
const EXPECTED_SCAD_FILES = 35
const EXPECTED_TOTAL_BYTES = 196_778

/** Files this directory holds that are *not* copies: written here, so not in the manifest. */
const OURS = ['.gitattributes', 'MANIFEST.sha256', 'NOTICE']

/**
 * Deliberately not vendored. `bases-wall-primary.scad` `import()`s one of 36 blank
 * texture STLs totalling 82.9 MiB for nine of its ten `TEXTURE` values, and takes
 * 30–180 s per compile. Nothing includes it, so excluding it breaks no chain —
 * which is the condition under which excluding it was allowed at all.
 */
const EXCLUDED = 'bases-wall-primary.scad'

/**
 * CRLF at the pinned commit. Mirrored from `scripts/refresh-scad.ts`, and the last
 * test in this file asserts the two lists agree — a stale copy of this set would
 * make that script's diagnostics wrong exactly when they are needed.
 */
const CRLF_UPSTREAM = [
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
]

/**
 * The 16 customizer entry points: nothing includes them, and each carries its own
 * parameter block. `bases.scad` is the legacy monolith — copied for the `alcove`
 * and `external_*` geometry the split files never got, and not a peer of the rest.
 */
const ENTRY_POINTS = [
  'bases-curved-inverted.scad',
  'bases-curved-radial.scad',
  'bases-curved.scad',
  'bases-diagonal.scad',
  'bases-hallway.scad',
  'bases-hex-corner.scad',
  'bases-hex.scad',
  'bases-portal.scad',
  'bases-square-corner.scad',
  'bases-square-internal_corner.scad',
  'bases-square-wall.scad',
  'bases-square.scad',
  'bases.scad',
  'risers_curved.scad',
  'risers_square.scad',
  'risers_walls.scad',
]

const INCLUDE_STATEMENT = /^[ \t]*(include|use)[ \t]*<([^>]*)>/gm

interface ScadFile {
  name: string
  bytes: Buffer
  text: string
}

function scadFiles(): ScadFile[] {
  return readdirSync(SCAD_DIR)
    .filter((name) => name.endsWith('.scad'))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(SCAD_DIR, name))
      return { name, bytes, text: bytes.toString('utf8') }
    })
}

function includesIn(text: string): { keyword: string; target: string }[] {
  // Comment-only lines are excluded by the anchor: `// include <x>` does not match,
  // and impl_diagonal.scad line 2 is exactly that.
  return [...text.matchAll(INCLUDE_STATEMENT)].map((match) => ({
    keyword: match[1] as string,
    target: match[2] as string,
  }))
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

const FILES = scadFiles()
const NAMES = new Set(FILES.map((file) => file.name))

describe('the vendored set', () => {
  it(`is ${String(EXPECTED_SCAD_FILES)} .scad files`, () => {
    expect(FILES.map((file) => file.name)).toHaveLength(EXPECTED_SCAD_FILES)
  })

  it(`totals exactly ${EXPECTED_TOTAL_BYTES.toLocaleString('en-GB')} bytes`, () => {
    const total = FILES.reduce((sum, file) => sum + file.bytes.byteLength, 0)
    expect(total).toBe(EXPECTED_TOTAL_BYTES)
  })

  it('compresses to about 18 KiB as one payload', () => {
    // A band, not a number: zlib's output is stable for a given zlib build but not
    // guaranteed across Node versions, and this figure only ever has to answer
    // "is shipping the sources to the browser cheap". It is: ~19 KB over the wire.
    const gzipped = gzipSync(Buffer.concat(FILES.map((file) => file.bytes)), { level: 9 })
    expect(gzipped.byteLength).toBeGreaterThan(16_000)
    expect(gzipped.byteLength).toBeLessThan(21_000)
  })

  it('holds nothing but the copies, the licence, and our own three files', () => {
    const unexpected = readdirSync(SCAD_DIR).filter(
      (name) => !name.endsWith('.scad') && name !== 'LICENSE' && !OURS.includes(name),
    )
    expect(unexpected).toEqual([])
  })

  it('excludes the textured primary walls, and nothing misses them', () => {
    expect(NAMES.has(EXCLUDED)).toBe(false)
    const referrers = FILES.filter((file) => file.text.includes('wall-primary'))
    expect(referrers.map((file) => file.name)).toEqual([])
  })

  it('needs no side-loaded meshes: not one import() in the set', () => {
    // The single `import()` upstream was in the excluded file. This is what lets
    // S3's virtual filesystem be 35 strings and nothing else — no 82.9 MiB of
    // blank STLs to materialise before a compile.
    const importers = FILES.filter((file) => /\bimport[ \t]*\(/.test(file.text))
    expect(importers.map((file) => file.name)).toEqual([])
  })
})

describe('include resolution — what S3’s flat virtual filesystem depends on', () => {
  const statements = FILES.flatMap((file) =>
    includesIn(file.text).map((statement) => ({ from: file.name, ...statement })),
  )

  it('is 39 statements', () => {
    expect(statements).toHaveLength(39)
  })

  it('uses include throughout, never use — so included scope is shared', () => {
    // Entry points set SQUARE_BASIS and friends and rely on connectors.scad seeing
    // them. `use <>` would import modules without variables and break that.
    expect(statements.filter((statement) => statement.keyword !== 'include')).toEqual([])
  })

  it.each(statements.map((statement) => [`${statement.from} → ${statement.target}`, statement]))(
    '%s resolves to a sibling',
    (_label, statement) => {
      expect(statement.target).not.toMatch(/[/\\]/)
      expect(statement.target).not.toContain('..')
      expect(NAMES.has(statement.target)).toBe(true)
    },
  )

  it('resolves to 19 distinct targets', () => {
    expect(new Set(statements.map((statement) => statement.target)).size).toBe(19)
  })

  it('ignores commented-out includes', () => {
    // impl_diagonal.scad line 2 is `// include <connectors.scad>`. If the regex
    // ever stops anchoring, this file's include count jumps and the total above
    // fails — but the failure would read as a real include, so assert it directly.
    const diagonal = FILES.find((file) => file.name === 'impl_diagonal.scad')
    expect(diagonal?.text).toContain('// include <connectors.scad>')
    expect(includesIn(diagonal?.text ?? '')).toHaveLength(1)
  })

  it('has 16 entry points, each with its own parameter block', () => {
    const included = new Set(statements.map((statement) => statement.target))
    const roots = FILES.filter((file) => !included.has(file.name)).map((file) => file.name)
    expect(roots).toEqual(ENTRY_POINTS)
    // A customizer group heading is what makes a file an entry point in the UI's
    // sense, so the two definitions must not diverge.
    const withGroups = FILES.filter((file) => /\/\*[ \t]*\[[^\]]+\][ \t]*\*\//.test(file.text))
    expect(withGroups.map((file) => file.name)).toEqual(ENTRY_POINTS)
  })
})

describe('customizer annotations survive byte-for-byte', () => {
  const manifest = readFileSync(join(SCAD_DIR, 'MANIFEST.sha256'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
      expect(match).not.toBeNull()
      return { hash: match?.[1] as string, name: match?.[2] as string }
    })

  it('covers all 35 sources plus the licence', () => {
    expect(manifest).toHaveLength(EXPECTED_SCAD_FILES + 1)
    expect(manifest.map((entry) => entry.name).filter((name) => OURS.includes(name))).toEqual([])
  })

  it.each(manifest.map((entry) => [entry.name, entry]))('%s is unmodified', (_name, entry) => {
    expect(sha256(readFileSync(join(SCAD_DIR, entry.name)))).toBe(entry.hash)
  })

  /**
   * Spot-checks against a *plausible* cleanup rather than against corruption. Each
   * of these lines is exactly what a formatter, a lint rule, or a helpful reviewer
   * would tidy, and each tidy silently costs a parameter its UI. The hash
   * assertions above already fail; these say what broke.
   */
  const CANARIES: [string, string][] = [
    // No space before `//`, none after the commas. Both are "wrong" and both are load-bearing.
    ['bases-square.scad', 'LOCK = "openlock";// [openlock,triplex,infinitylock,dragonlock,none]'],
    // A leading space before the group heading, in eight files. Trim it and the group vanishes.
    ['bases-square.scad', '\n /* [Magnets] */\n'],
    // `value:Label` pairs, with parentheses, slashes and fractions inside the labels.
    [
      'bases-square.scad',
      'SQUARE_BASIS = "inch"; // [25mm:25mm - Dwarven Forge/Hirstarts, inch:inch (25.4) - OpenLOCK/Dragonlock/Dungeonworks, wyloch:1 1/4 inch (31.75) - Wyloch, drc:1 1/2 inch (38.1) - Dragon\'s Rest]',
    ],
    // A description comment on the line above the variable it describes.
    ['bases-square.scad', '// How many squares on the X axis\nx = 2; //[2,3,4,5,6,7,8]'],
    // The riser entry points take a z, and S4 spells it platform/low/medium/high.
    ['risers_square.scad', 'include <impl_square.scad>'],
  ]

  it.each(CANARIES)('%s still contains its exact annotation', (name, fragment) => {
    const file = FILES.find((candidate) => candidate.name === name)
    expect(file, `${name} is missing from the vendored set`).toBeDefined()
    expect(file?.text.replace(/\r\n/g, '\n')).toContain(fragment)
  })

  it('keeps the defaults S4’s resolver hashes against', () => {
    // A change to any of these changes what an un-set parameter means, and the
    // resolver's parameter hashes stop matching the 1,962 catalogued bases.
    const square = FILES.find((file) => file.name === 'bases-square.scad')?.text ?? ''
    for (const line of [
      'x = 2; //[2,3,4,5,6,7,8]',
      'y = 2; //[2,3,4,5,6,7,8]',
      'HEIGHT = 6; // 6 is default',
      'SQUARE_BASIS = "inch";',
      'LOCK = "openlock";',
      'TOPLESS = "true";',
      'SUPPORTS = "true";',
      'MAGNETS = "flex_magnetic";',
      'MAGNET_HOLE = 6;',
      'ELECTRONICS = "false";',
      'PRIORITY = "lock";',
      'NOTCH = "false";',
      'CENTER = "none";',
    ]) {
      expect(square, `bases-square.scad default changed: ${line}`).toContain(line)
    }
  })
})

describe('line endings', () => {
  it('is CRLF in exactly the twelve files upstream made CRLF', () => {
    const crlf = FILES.filter((file) => file.text.includes('\r\n')).map((file) => file.name)
    expect(crlf).toEqual(CRLF_UPSTREAM)
  })

  it('has no file that mixes the two', () => {
    // Partial normalisation is the failure mode a whole-file check would report as
    // "content differs" and leave a reviewer hunting for.
    const mixed = FILES.filter((file) => {
      const crlf = (file.text.match(/\r\n/g) ?? []).length
      const lf = (file.text.match(/\n/g) ?? []).length - crlf
      return crlf > 0 && lf > 0
    })
    expect(mixed.map((file) => file.name)).toEqual([])
  })

  it('is pinned against normalisation by scad/.gitattributes', () => {
    expect(readFileSync(join(SCAD_DIR, '.gitattributes'), 'utf8')).toMatch(/^\* -text$/m)
  })
})

describe('the licence', () => {
  const licence = readFileSync(join(SCAD_DIR, 'LICENSE'), 'utf8')

  it('is the Apache License 2.0, unmodified', () => {
    // GitHub's licence-chooser rendering of the canonical text: identical to
    // apache.org's LICENSE-2.0.txt but for one leading blank line. Verified by
    // diff when vendored; the hash is asserted above, so this is the readable
    // statement of what that hash is.
    expect(readFileSync(join(SCAD_DIR, 'LICENSE')).byteLength).toBe(11_357)
    expect(licence).toContain('Apache License')
    expect(licence).toContain('Version 2.0, January 2004')
    expect(licence).toContain('TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION')
    expect(licence).toContain('WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND')
    // §4(d): a NOTICE in the distribution must be propagated. Upstream has none,
    // so ours is the only one — and it must not be the only place the licence is
    // named, hence the LICENSE file itself sitting beside it.
    expect(licence).toContain('If the Work includes a "NOTICE" text file')
  })

  it('is accompanied by a NOTICE that attributes the work', () => {
    const notice = readFileSync(join(SCAD_DIR, 'NOTICE'), 'utf8')
    expect(notice).toContain('Devon Jones')
    expect(notice).toContain('Apache License, Version 2.0')
    expect(notice).toContain('https://github.com/MasterworkTools/openforge-bases')
  })

  it('is not restated inside the sources, because upstream states it nowhere', () => {
    // §4(c) is about *retaining* notices. There were none to retain, and adding a
    // per-file header would modify files this row promises not to modify.
    const annotated = FILES.filter((file) => /copyright|Apache License/i.test(file.text))
    expect(annotated.map((file) => file.name)).toEqual([])
  })
})

describe('the documents agree with the bytes', () => {
  const provenance = readFileSync(join(GENERATOR_DIR, 'PROVENANCE.md'), 'utf8')
  const refresh = readFileSync(
    fileURLToPath(new URL('../../scripts/refresh-scad.ts', import.meta.url)),
    'utf8',
  )

  it('pins the same commit in PROVENANCE.md, refresh-scad.ts and here', () => {
    expect(provenance).toContain(PINNED_SHA)
    expect(refresh).toContain(`const PINNED_SHA = '${PINNED_SHA}'`)
  })

  it('quotes the file count and byte total that are actually on disk', () => {
    expect(provenance).toContain(EXPECTED_TOTAL_BYTES.toLocaleString('en-GB'))
    expect(provenance).toContain(`${String(EXPECTED_SCAD_FILES)} files`)
  })

  it('records the exclusion, so the UI never implies every base is parametric', () => {
    expect(provenance).toContain(EXCLUDED)
    expect(provenance).toMatch(/never imply that every base is parametric/i)
  })

  it('keeps refresh-scad.ts’s CRLF list in step with this one', () => {
    // The script uses it to explain *why* a hash moved. A stale copy gives the
    // wrong explanation at the one moment somebody is relying on it.
    for (const name of CRLF_UPSTREAM) {
      expect(refresh, `refresh-scad.ts CRLF_UPSTREAM is missing ${name}`).toContain(`'${name}',`)
    }
    const listed = /const CRLF_UPSTREAM = new Set\(\[([\s\S]*?)\]\)/.exec(refresh)?.[1] ?? ''
    expect([...listed.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual(CRLF_UPSTREAM)
  })

  it('reaches the bundle only through the engine, and only lazily', () => {
    // This assertion used to read "nothing in src/ imports it yet", matched by
    // grepping for the literal `generator/scad/`. S3 then wired the geometry in
    // with the natural relative glob — `import.meta.glob('../scad/*.scad')` —
    // which does not contain that literal, so the guard kept passing while the
    // property it named had deliberately stopped being true. A guard that cannot
    // fail is worse than no guard, so it now asserts the property that actually
    // matters: exactly one module reads the geometry, and it is the engine's
    // virtual filesystem, which the entry bundle reaches only through a dynamic
    // import.
    //
    // The zero-eager-cost half is proved where it can be proved — by building
    // with `src/generator/` present and with it moved aside and comparing the
    // entry bundle, which `vendor.test.ts` guards at source level.
    //
    // **Row S5 split this in two, and narrowed it.** It matched any *occurrence*
    // of the text, so a module that merely named the directory in a comment
    // counted as a reader; and it did not distinguish the geometry from the two
    // licensing files beside it. S5 imports `LICENSE` and `NOTICE` as `?raw`,
    // because a generated STL is a derivative of these sources and Apache-2.0
    // section 4(a) asks that the licence ride with it — which is a different
    // property from the one this guard is about. Both are now asserted
    // separately, over import *specifiers* rather than over prose, so neither
    // can be loosened without a red test.
    const importers = (pattern: RegExp): string[] =>
      sources(fileURLToPath(new URL('../', import.meta.url)))
        .filter((path) => {
          // Tests never ship, and two of the engine's own read the geometry to
          // check it. The property is about production modules reaching the
          // bundle.
          if (/\.test\.tsx?$/.test(path)) return false
          return specifiers(readFileSync(path, 'utf8')).some((specifier) => pattern.test(specifier))
        })
        .map((path) => path.slice(path.indexOf('src/')))

    // The geometry itself: exactly one reader, and it is the engine's VFS.
    expect(importers(/(?:\.\.|generator)\/scad\/[^'"`]*\.scad/)).toEqual(['src/generator/engine/vfs.ts'])
    // The licensing files: exactly one reader, and it is the module the download
    // pack loads dynamically when it has a generated mesh to licence.
    expect(importers(/(?:\.\.|generator)\/scad\/(?:LICENSE|NOTICE)/)).toEqual([
      'src/generator/placement/notice.ts',
    ])
  })
})

/**
 * Every `import`/`export … from` specifier in a module, and `import.meta.glob`'s
 * first argument.
 *
 * Row S5 added this so the guard above reads code rather than prose: matching
 * any occurrence of `generator/scad/` counted a docblock that named the
 * directory as a module that imports from it.
 */
function specifiers(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/(?:^|[^\w$])(?:import|from|import\.meta\.glob\()\s*\(?\s*'([^']+)'/gm)) {
    if (match[1] !== undefined) found.push(match[1])
  }
  return found
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'scad' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

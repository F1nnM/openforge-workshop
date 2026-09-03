/**
 * Tests for the OpenLOCK tessellation table.
 *
 * The table is a **transcription**, so these tests are mostly about
 * transcription failure modes rather than about logic:
 *
 *   - the vocabulary is closed at 38 and every code appears exactly once;
 *   - the dimensions land on the 0.5-unit grid wherever the research says they
 *     do, and the ones that do not are a named, justified list rather than a
 *     typo nobody noticed;
 *   - the confidence tally is 35 / 2 / 1, because a later row has to be able to
 *     refuse an unmeasured footprint and that only works if the labels survive;
 *   - the table and `docs/openlock-tessellation.json` agree field by field, which
 *     is the test that stops the two copies drifting apart;
 *   - the `col+` namespace and the single-letter namespace do not collide at
 *     lookup time, which is the one place the vocabulary is genuinely unsafe.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type {
  ArcBand,
  ColumnToken,
  PortTopology,
  RectSize,
  TessellationCode,
  TessellationSize,
} from './tessellation'
import {
  ARC_BAND_RULES,
  COLUMN_FOOTPRINT_UNITS,
  COLUMN_TOKENS,
  COLUMN_TOKEN_PREFIX,
  CURVE_CODES,
  CURVE_SWEEP_ANGLES_DEG,
  GRID_UNIT_MM,
  JUNCTION_LETTER,
  JUNCTION_PORT_COUNT,
  NON_SWEEP_ANGLES_DEG,
  TESSELLATION_BY_CODE,
  TESSELLATION_CODES,
  WALL_THICKNESS_MM,
  WALL_THICKNESS_UNITS,
  arcBandFor,
  arcBandSideOfRadius,
  arcSectorExtent,
  boundingBoxUnits,
  isMeasured,
  resolveTessellation,
} from './tessellation'

/* --------------------------------------------------------------- expectations */

/**
 * The closed vocabulary, spelled out. Written from the research note's §3 table
 * rather than read back off the module, so a code silently added or dropped
 * fails here.
 */
const EXPECTED_CODES = [
  'A', 'A+S', 'AS', 'AxG', 'BA', 'BAxG', 'D', 'D+SA', 'E', 'EA', 'F', 'G', 'GA', 'I', 'IA', 'II',
  'IL', 'IO', 'IT', 'IX', 'L', 'O', 'P', 'PA', 'PB', 'PC', 'Q', 'QxG', 'R', 'S', 'SA', 'SB', 'T',
  'U', 'V', 'VxE', 'X', 'XA',
]

/** §7 contradiction 10 and "The `G` datum": the two rows nobody measured. */
const UNMEASURED_CODES = ['G', 'T']

/** §4: `GA`, the 45° counterpart of `G`, by argument alone. */
const INFERRED_CODES = ['GA']

/**
 * The measured extents, in millimetres, that §1 says every plain untextured base
 * lands on: exact multiples of the half unit, "to the last digit the STL stores".
 */
const MEASURED_MM_LADDER = [12.7, 25.4, 38.1, 50.8, 76.2, 101.6, 152.4]

/**
 * The rows whose dimensions do **not** sit on the 0.5-unit grid, with the reason
 * the research gives. Nothing here is a rounding of a clean number; each is a
 * measurement quoted as-is, which is why they are enumerated rather than fudged.
 */
const OFF_GRID_CODES: Readonly<Record<string, string>> = {
  // §7.1: interface cuts of unknown intent — 1.991 against a nominal 2, 1.547
  // against a nominal 1.5. "Whether the xG lengths are intentional or drift" is
  // explicitly open.
  AxG: 'interface cut, 1.991 vs nominal 2',
  BAxG: 'interface cut, 1.547 vs nominal 1.5',
  // §7.6: one sample each, both protruding bodies (a chimney, a fireplace).
  // Nominal depth for these two is unverified.
  'A+S': 'n=1 protruding body, depth 1.753 vs nominal 1.5',
  'D+SA': 'n=1 protruding body, depth 1.892 vs nominal 1.5',
  // §6: textured samples run 0.1-1.0 mm off nominal because the surface
  // displacement moves the extreme vertex.
  II: 'textured sample only',
  IO: 'textured sample only',
  IX: 'textured sample only',
  L: 'textured sample only',
  // §7 "What I could not determine": P = 2.5*sqrt(2) and PA = 2*sqrt(2) are
  // solid and irrational, so they cannot sit on the grid; PB is 2*sqrt(2) within
  // noise; PC's 3.334 does not reduce.
  P: 'diagonal run 2.5*sqrt(2), irrational',
  PA: 'diagonal run 2*sqrt(2), irrational',
  PB: 'diagonal run ~2*sqrt(2), textured sample',
  PC: 'diagonal run 3.334, unresolved',
  // §3: the only plain base that does not land clean — [3.984, 4.489] against
  // the [4, 4.5] band §4 resolves it to.
  XA: 'measured band 0.016 off the [4, 4.5] rule',
}

/** §1: the `I`-cell suffixes and the column letters. Everything else is pictorial or unrecorded. */
const JUNCTION_CODES: Readonly<Record<string, string>> = {
  IO: 'none',
  II: 'opposite',
  IL: 'corner',
  IT: 'tee',
  IX: 'cross',
  L: 'corner',
  T: 'tee',
}

/** §7.4 / §7.5: the codes whose tag value covers more than one footprint. */
const AMBIGUOUS_CODES = ['I', 'O', 'U', 'X']

/* -------------------------------------------------------------------- helpers */

/** On the 0.5-unit grid. Exact integer arithmetic: every half unit is exact in binary. */
function onHalfUnitGrid(units: number): boolean {
  return Number.isInteger(units * 2)
}

function dimensionsOf(row: Pick<TessellationCode, 'size'>): number[] {
  return row.size.kind === 'rect'
    ? [row.size.widthUnits, row.size.depthUnits]
    : [
        row.size.interfaceRadiusUnits,
        row.size.innerRadiusUnits,
        row.size.outerRadiusUnits,
        row.size.bandWidthUnits,
      ]
}

/**
 * Ports, flattened for comparison.
 *
 * The JSON attaches prose `note`s to five rows' ports (`AS`'s dual-sided
 * difference from `A`, `IO`'s "none" vs Printable Scenery's "End", the `L`/`T`
 * letter reuse, `IL`'s 90/270 corner markers). The table carries none of that
 * prose, on purpose — it is documentation, not data, and duplicating it would
 * only give the two copies something extra to drift on. So the shape is
 * compared and the notes are not.
 */
function portsSummary(ports: PortTopology): string {
  return ports.kind === 'junction' ? `junction:${ports.junction}:${String(ports.portCount)}` : ports.kind
}

/* --------------------------------------------------------------- the JSON side */

interface JsonPorts {
  kind: string
  junction?: string
  portCount?: number
  note?: string
}

interface JsonArc {
  innerRadiusUnits: number
  outerRadiusUnits: number
  angleDeg: number
  bandWidthUnits: number
  band: ArcBand
  interfaceRadiusUnits: number
}

interface JsonCode {
  code: string
  shape: string
  liveTiles: number
  filenameTokenCount: number
  onCheatSheet: boolean
  confidence: string
  ambiguous: boolean
  scannerNominalWidthUnits: number | null
  scannerNominalDepthUnits: number | null
  widthUnits?: number
  depthUnits?: number
  widthMm?: number
  depthMm?: number
  arc?: JsonArc
  ports: JsonPorts
  measuredFrom?: string
  derivedFrom?: string
}

interface JsonColumnToken {
  token: string
  letter: string
  liveTiles: number | null
  confidence: string
  widthUnits: number
  depthUnits: number
  widthMm: number
  depthMm: number
  ports: JsonPorts
  measuredFrom?: string
  derivedFrom?: string
}

interface JsonDoc {
  _meta: { unitMm: number; confidenceValues: string[] }
  primitives: {
    unitMm: number
    wallThicknessUnits: number
    columnFootprintUnits: number[]
    arcConventions: { name: string; band: string; confidence: string }[]
  }
  codes: JsonCode[]
  columnTokens: JsonColumnToken[]
}

const RESEARCH = JSON.parse(
  readFileSync(new URL('../docs/openlock-tessellation.json', import.meta.url), 'utf8'),
) as JsonDoc

/** The JSON stores millimetres to two decimals; the table stores units only. */
function mm(units: number): number {
  return Math.round(units * GRID_UNIT_MM * 100) / 100
}

/* ---------------------------------------------------------------------- tests */

describe('the vocabulary', () => {
  it('is closed at 38 codes', () => {
    expect(TESSELLATION_CODES).toHaveLength(38)
    expect(EXPECTED_CODES).toHaveLength(38)
  })

  it('holds every expected code exactly once, in order', () => {
    expect(TESSELLATION_CODES.map((row) => row.code)).toEqual(EXPECTED_CODES)
    expect(new Set(EXPECTED_CODES).size).toBe(EXPECTED_CODES.length)
    expect(TESSELLATION_BY_CODE.size).toBe(38)
  })

  it('has no `col+` token hiding in the tile namespace', () => {
    for (const code of TESSELLATION_CODES) expect(code.code.startsWith(COLUMN_TOKEN_PREFIX)).toBe(false)
  })

  it('marks exactly the four overloaded codes ambiguous', () => {
    const ambiguous = TESSELLATION_CODES.filter((row) => row.ambiguous).map((row) => row.code)
    expect(ambiguous).toEqual(AMBIGUOUS_CODES)
  })

  it('records the two codes with zero live tiles', () => {
    const zero = TESSELLATION_CODES.filter((row) => row.liveTiles === 0).map((row) => row.code)
    expect(zero).toEqual(['G', 'GA'])
    // 36 codes on 4,030 live tiles: §5.
    const live = TESSELLATION_CODES.reduce((sum, row) => sum + row.liveTiles, 0)
    expect(live).toBe(4030)
  })
})

describe('confidence', () => {
  it('tallies 35 measured / 2 unmeasured / 1 inferred', () => {
    const tally = { measured: 0, unmeasured: 0, inferred: 0 }
    for (const row of TESSELLATION_CODES) tally[row.confidence] += 1
    expect(tally).toEqual({ measured: 35, unmeasured: 2, inferred: 1 })
  })

  it('names the two unmeasured rows and the one inferred row', () => {
    const by = (want: string) =>
      TESSELLATION_CODES.filter((row) => row.confidence === want).map((row) => row.code)
    expect(by('unmeasured')).toEqual(UNMEASURED_CODES)
    expect(by('inferred')).toEqual(INFERRED_CODES)
  })

  it('refuses those three rows and no others', () => {
    const refused = TESSELLATION_CODES.filter((row) => !isMeasured(row)).map((row) => row.code)
    expect(refused).toEqual([...UNMEASURED_CODES, ...INFERRED_CODES].sort((a, b) => a.localeCompare(b)))
  })

  it('still carries dimensions for all three — the label is a judgement, not a gap', () => {
    for (const code of [...UNMEASURED_CODES, ...INFERRED_CODES]) {
      const row = TESSELLATION_BY_CODE.get(code)
      expect(row, code).toBeDefined()
      for (const dimension of dimensionsOf(row!)) expect(Number.isFinite(dimension)).toBe(true)
    }
  })

  it('derives its evidence from a citation wherever it is not measured', () => {
    for (const row of TESSELLATION_CODES) {
      expect(row.evidence.kind, row.code).toBe(isMeasured(row) ? 'measured_stl' : 'derived')
      expect(row.evidence.source.length, row.code).toBeGreaterThan(0)
    }
  })
})

describe('the unit and the two constants', () => {
  it('is one inch, exactly', () => {
    expect(GRID_UNIT_MM).toBe(25.4)
  })

  it('makes a wall half a unit thick', () => {
    expect(WALL_THICKNESS_UNITS).toBe(0.5)
    expect(WALL_THICKNESS_MM).toBe(12.7)
    expect(WALL_THICKNESS_UNITS * GRID_UNIT_MM).toBe(WALL_THICKNESS_MM)
  })

  it('makes a column one wall-thickness square', () => {
    expect(COLUMN_FOOTPRINT_UNITS).toEqual({ kind: 'rect', widthUnits: 0.5, depthUnits: 0.5 })
    expect(COLUMN_FOOTPRINT_UNITS.widthUnits).toBe(WALL_THICKNESS_UNITS)
    expect(COLUMN_FOOTPRINT_UNITS.depthUnits).toBe(WALL_THICKNESS_UNITS)
  })

  it('puts every wall run on a 0.5 depth', () => {
    const runs = TESSELLATION_CODES.filter((row) => row.shape === 'wall_run')
    expect(runs.map((row) => row.code)).toEqual(['A', 'AS', 'AxG', 'BA', 'BAxG', 'D', 'IA', 'Q', 'QxG'])
    for (const row of runs) {
      expect(row.size.kind).toBe('rect')
      if (row.size.kind === 'rect') expect(row.size.depthUnits, row.code).toBe(WALL_THICKNESS_UNITS)
    }
  })

  it('puts every column on the column footprint, texture noise aside', () => {
    const columns = TESSELLATION_CODES.filter((row) => row.shape === 'column')
    expect(columns.map((row) => row.code)).toEqual(['L', 'T'])
    const named: [string, RectSize | TessellationSize][] = [
      ...columns.map((row): [string, TessellationSize] => [row.code, row.size]),
      ...COLUMN_TOKENS.map((token): [string, RectSize] => [token.token, token.size]),
    ]
    for (const [name, size] of named) {
      const box = boundingBoxUnits(size)
      expect(box.widthUnits, name).toBeCloseTo(0.5, 2)
      expect(box.depthUnits, name).toBeCloseTo(0.5, 2)
    }
  })
})

describe('dimensions land on the grid', () => {
  it('puts every dimension of 25 of the 38 rows on an exact half unit', () => {
    const offGrid = TESSELLATION_CODES.filter((row) => !dimensionsOf(row).every(onHalfUnitGrid))
    expect(offGrid.map((row) => row.code)).toEqual(Object.keys(OFF_GRID_CODES).sort((a, b) => a.localeCompare(b)))
    expect(TESSELLATION_CODES.length - offGrid.length).toBe(25)
  })

  it('draws every on-grid millimetre value from the measured ladder', () => {
    for (const value of MEASURED_MM_LADDER) expect(value / WALL_THICKNESS_MM).toBeCloseTo(Math.round(value / WALL_THICKNESS_MM), 9)
    const observed = new Set<number>()
    for (const row of TESSELLATION_CODES) {
      if (row.code in OFF_GRID_CODES || row.size.kind !== 'rect') continue
      observed.add(mm(row.size.widthUnits))
      observed.add(mm(row.size.depthUnits))
    }
    // 152.40 is on the ladder because the corpus contains 6-unit *tokens*; no
    // *code* reaches it, so this is a subset check and the observed set is
    // pinned separately.
    for (const value of observed) expect(MEASURED_MM_LADDER, `${String(value)} mm`).toContain(value)
    expect([...observed].sort((a, b) => a - b)).toEqual([12.7, 25.4, 38.1, 50.8, 76.2, 101.6])
  })

  it('keeps every off-grid row within a millimetre of its nominal, or explains why not', () => {
    // The only row whose measurement is a whole unit away from its nominal is
    // QxG (§7.1) — and QxG is *on* the grid at 3.000, so nothing here should be
    // further out than texture noise plus a mitre.
    for (const [code, reason] of Object.entries(OFF_GRID_CODES)) {
      const row = TESSELLATION_BY_CODE.get(code)
      expect(row, code).toBeDefined()
      expect(reason.length).toBeGreaterThan(0)
      expect(row!.confidence, code).toBe('measured')
    }
  })

  it('keeps QxG on the grid while its tag disagrees by a whole unit', () => {
    const row = TESSELLATION_BY_CODE.get('QxG')
    expect(row?.nominalWidthUnits).toBe(4)
    expect(row?.size).toEqual({ kind: 'rect', widthUnits: 3, depthUnits: 0.5 })
  })
})

describe('port topology', () => {
  it('names a junction wherever the letter encodes one, and nowhere else', () => {
    const junctions = Object.fromEntries(
      TESSELLATION_CODES.filter((row) => row.ports.kind === 'junction').map((row) => [
        row.code,
        row.ports.kind === 'junction' ? row.ports.junction : '',
      ]),
    )
    expect(junctions).toEqual(JUNCTION_CODES)
  })

  it('derives the port count from the junction, per the plumbing-fitting convention', () => {
    expect(JUNCTION_PORT_COUNT).toEqual({ none: 0, opposite: 2, corner: 2, tee: 3, cross: 4 })
    for (const row of [...TESSELLATION_CODES, ...COLUMN_TOKENS]) {
      if (row.ports.kind !== 'junction') continue
      expect(row.ports.portCount).toBe(JUNCTION_PORT_COUNT[row.ports.junction])
    }
  })

  it('ends every junction code with the letter that names the junction', () => {
    for (const [code, junction] of Object.entries(JUNCTION_CODES)) {
      expect(code.at(-1), code).toBe(JUNCTION_LETTER[junction as keyof typeof JUNCTION_LETTER])
    }
    for (const token of COLUMN_TOKENS) {
      if (token.ports.kind !== 'junction') throw new Error(`${token.token} has no junction`)
      expect(token.letter).toBe(JUNCTION_LETTER[token.ports.junction])
    }
  })

  it('splits the rest on whether the cheat sheet drew them', () => {
    for (const row of TESSELLATION_CODES) {
      if (row.code in JUNCTION_CODES) continue
      expect(row.ports.kind, row.code).toBe(row.onCheatSheet ? 'pictorial' : 'unrecorded')
    }
    const kinds = TESSELLATION_CODES.map((row) => row.ports.kind)
    expect(kinds.filter((kind) => kind === 'junction')).toHaveLength(7)
    expect(kinds.filter((kind) => kind === 'pictorial')).toHaveLength(24)
    expect(kinds.filter((kind) => kind === 'unrecorded')).toHaveLength(7)
  })
})

describe('curves', () => {
  it('names the seven curved codes', () => {
    expect(CURVE_CODES).toEqual(['F', 'G', 'GA', 'V', 'VxE', 'X', 'XA'])
  })

  it('resolves every curved row to a band rule that reproduces its measurement', () => {
    for (const row of TESSELLATION_CODES) {
      if (row.size.kind !== 'arc') continue
      const rule = arcBandFor(row.size.band, row.size.interfaceRadiusUnits)
      // XA is the loosest at 0.016; every other row is inside 0.002.
      expect(rule.innerRadiusUnits, row.code).toBeCloseTo(row.size.innerRadiusUnits, 1)
      expect(rule.outerRadiusUnits, row.code).toBeCloseTo(row.size.outerRadiusUnits, 1)
      expect(row.size.outerRadiusUnits - row.size.innerRadiusUnits).toBeCloseTo(row.size.bandWidthUnits, 3)
      expect(CURVE_SWEEP_ANGLES_DEG).toContain(row.size.angleDeg)
      expect(NON_SWEEP_ANGLES_DEG).not.toContain(row.size.angleDeg)
    }
  })

  it('puts only the concave band outside its interface radius', () => {
    const outside = (Object.keys(ARC_BAND_RULES) as ArcBand[]).filter(
      (band) => arcBandSideOfRadius(band) === 'outside',
    )
    expect(outside).toEqual(['concave'])
  })

  it('degenerates the radial floor band to a quarter disc at radius 2', () => {
    expect(arcBandFor('radial', 2)).toEqual({ innerRadiusUnits: 0, outerRadiusUnits: 2 })
    expect(arcBandFor('radial', 4)).toEqual({ innerRadiusUnits: 2, outerRadiusUnits: 4 })
    expect(arcBandFor('disc', 4)).toEqual({ innerRadiusUnits: 0, outerRadiusUnits: 4 })
    expect(arcBandFor('convex', 4)).toEqual({ innerRadiusUnits: 3.5, outerRadiusUnits: 4 })
    expect(arcBandFor('concave', 4)).toEqual({ innerRadiusUnits: 4, outerRadiusUnits: 4.5 })
    expect(arcBandFor('s2w_radial', 6)).toEqual({ innerRadiusUnits: 4.5, outerRadiusUnits: 6 })
  })

  it('keeps V and VxE apart, which their tags cannot', () => {
    const v = TESSELLATION_BY_CODE.get('V')
    const vxe = TESSELLATION_BY_CODE.get('VxE')
    expect(v?.size).toEqual({
      kind: 'arc',
      interfaceRadiusUnits: 4,
      band: 'disc',
      innerRadiusUnits: 0,
      outerRadiusUnits: 4,
      angleDeg: 90,
      bandWidthUnits: 4,
    })
    expect(vxe?.size).toEqual({
      kind: 'arc',
      interfaceRadiusUnits: 4,
      band: 'radial',
      innerRadiusUnits: 2,
      outerRadiusUnits: 4,
      angleDeg: 90,
      bandWidthUnits: 2,
    })
  })

  it('degenerates a 90 degree sector bbox to Rout x Rout', () => {
    const extent = arcSectorExtent(4, 4.5, 90)
    expect(extent.widthUnits).toBeCloseTo(4.5, 9)
    expect(extent.depthUnits).toBeCloseTo(4.5, 9)
    expect(boundingBoxUnits({ kind: 'rect', widthUnits: 2, depthUnits: 1 })).toEqual({
      widthUnits: 2,
      depthUnits: 1,
    })
  })

  it('measures a 45 degree band by the two-equation formula', () => {
    // XA: Rout - Rin*cos45 = 4.489 - 3.984*0.70711, Rout*sin45 = 4.489*0.70711.
    const extent = arcSectorExtent(3.984, 4.489, 45)
    expect(extent.widthUnits).toBeCloseTo(1.67189, 4)
    expect(extent.depthUnits).toBeCloseTo(3.1742, 4)
  })
})

describe('the colliding namespaces', () => {
  it('holds five column tokens, all one wall-thickness square', () => {
    expect(COLUMN_TOKENS).toHaveLength(5)
    expect(COLUMN_TOKENS.map((token) => token.token)).toEqual([
      'col+I',
      'col+L',
      'col+O',
      'col+T',
      'col+X',
    ])
    expect(COLUMN_TOKENS.map((token) => token.letter)).toEqual(['I', 'L', 'O', 'T', 'X'])
  })

  it('resolves a bare letter to the tile and the gated letter to the column', () => {
    for (const token of COLUMN_TOKENS) {
      const tile = resolveTessellation(token.letter)
      expect(tile?.namespace, token.letter).toBe('tile')
      const column = resolveTessellation(token.letter, { column: true })
      expect(column?.namespace, token.letter).toBe('column')
      expect(column?.entry).toBe(token)
    }
  })

  it('resolves a `col+` token to the column with or without the gate', () => {
    for (const token of COLUMN_TOKENS) {
      for (const options of [{}, { column: true }, { column: false }]) {
        const found = resolveTessellation(token.token, options)
        expect(found?.namespace, token.token).toBe('column')
        expect(found?.entry).toBe(token)
      }
    }
  })

  it('gives X two different footprints in the two namespaces', () => {
    const tile = resolveTessellation('X')
    const column = resolveTessellation('X', { column: true })
    expect(tile?.namespace).toBe('tile')
    expect(column?.namespace).toBe('column')
    expect(boundingBoxUnits((tile as { entry: TessellationCode }).entry.size).widthUnits).toBeCloseTo(4.5, 9)
    expect((column as { entry: ColumnToken }).entry.size.widthUnits).toBe(0.5)
  })

  it('invents no column for a letter that has none', () => {
    expect(resolveTessellation('Q', { column: true })).toBeUndefined()
    expect(resolveTessellation('col+Q')).toBeUndefined()
    expect(resolveTessellation('col+')).toBeUndefined()
    expect(resolveTessellation('nonsense')).toBeUndefined()
  })

  it('measures four of the five columns and derives col+T', () => {
    const unmeasured = COLUMN_TOKENS.filter((token) => !isMeasured(token))
    expect(unmeasured.map((token) => token.token)).toEqual(['col+T'])
    expect(unmeasured[0]?.evidence.kind).toBe('derived')
  })
})

describe('the table and docs/openlock-tessellation.json agree', () => {
  it('shares the unit and the wall thickness', () => {
    expect(RESEARCH._meta.unitMm).toBe(GRID_UNIT_MM)
    expect(RESEARCH.primitives.unitMm).toBe(GRID_UNIT_MM)
    expect(RESEARCH.primitives.wallThicknessUnits).toBe(WALL_THICKNESS_UNITS)
    expect(RESEARCH.primitives.columnFootprintUnits).toEqual([
      COLUMN_FOOTPRINT_UNITS.widthUnits,
      COLUMN_FOOTPRINT_UNITS.depthUnits,
    ])
    expect([...RESEARCH._meta.confidenceValues].sort((a, b) => a.localeCompare(b))).toEqual([
      'inferred',
      'measured',
      'unmeasured',
    ])
  })

  it('shares the arc band rules', () => {
    const byName = new Map(RESEARCH.primitives.arcConventions.map((rule) => [rule.name, rule]))
    expect(byName.size).toBe(Object.keys(ARC_BAND_RULES).length)
    for (const rule of Object.values(ARC_BAND_RULES)) {
      const json = byName.get(rule.name)
      expect(json, rule.name).toBeDefined()
      expect(json?.band).toBe(rule.expression)
      expect(json?.confidence).toBe(rule.confidence)
    }
  })

  it('shares every code, field by field', () => {
    expect(RESEARCH.codes.map((row) => row.code)).toEqual(TESSELLATION_CODES.map((row) => row.code))
    for (const [index, json] of RESEARCH.codes.entries()) {
      const row = TESSELLATION_CODES[index]
      expect(row, json.code).toBeDefined()
      if (row === undefined) continue
      const where = json.code
      expect(row.shape, where).toBe(json.shape)
      expect(row.liveTiles, where).toBe(json.liveTiles)
      expect(row.filenameTokenCount, where).toBe(json.filenameTokenCount)
      expect(row.onCheatSheet, where).toBe(json.onCheatSheet)
      expect(row.confidence, where).toBe(json.confidence)
      expect(row.ambiguous, where).toBe(json.ambiguous)
      expect(row.nominalWidthUnits, where).toBe(json.scannerNominalWidthUnits)
      expect(row.nominalDepthUnits, where).toBe(json.scannerNominalDepthUnits)
      expect(portsSummary(row.ports), where).toBe(portsSummary(json.ports as PortTopology))
      expect(row.evidence.source, where).toBe(json.measuredFrom ?? json.derivedFrom)
      expect(row.evidence.kind, where).toBe(json.measuredFrom === undefined ? 'derived' : 'measured_stl')
      if (row.size.kind === 'rect') {
        expect(json.arc, where).toBeUndefined()
        expect(row.size.widthUnits, where).toBe(json.widthUnits)
        expect(row.size.depthUnits, where).toBe(json.depthUnits)
        // The JSON carries millimetres and the table does not; this is the
        // check that keeps the derived copy honest.
        expect(mm(row.size.widthUnits), where).toBe(json.widthMm)
        expect(mm(row.size.depthUnits), where).toBe(json.depthMm)
      } else {
        expect(json.widthUnits, where).toBeUndefined()
        expect(json.arc, where).toBeDefined()
        expect(row.size.interfaceRadiusUnits, where).toBe(json.arc?.interfaceRadiusUnits)
        expect(row.size.band, where).toBe(json.arc?.band)
        expect(row.size.innerRadiusUnits, where).toBe(json.arc?.innerRadiusUnits)
        expect(row.size.outerRadiusUnits, where).toBe(json.arc?.outerRadiusUnits)
        expect(row.size.angleDeg, where).toBe(json.arc?.angleDeg)
        expect(row.size.bandWidthUnits, where).toBe(json.arc?.bandWidthUnits)
      }
    }
  })

  it('shares every column token, field by field', () => {
    expect(RESEARCH.columnTokens.map((token) => token.token)).toEqual(
      COLUMN_TOKENS.map((token) => token.token),
    )
    for (const [index, json] of RESEARCH.columnTokens.entries()) {
      const token = COLUMN_TOKENS[index]
      expect(token, json.token).toBeDefined()
      if (token === undefined) continue
      const where = json.token
      expect(token.letter, where).toBe(json.letter)
      expect(token.liveTiles, where).toBe(json.liveTiles)
      expect(token.confidence, where).toBe(json.confidence)
      expect(token.size.widthUnits, where).toBe(json.widthUnits)
      expect(token.size.depthUnits, where).toBe(json.depthUnits)
      expect(mm(token.size.widthUnits), where).toBe(json.widthMm)
      expect(mm(token.size.depthUnits), where).toBe(json.depthMm)
      expect(portsSummary(token.ports), where).toBe(portsSummary(json.ports as PortTopology))
      expect(token.evidence.source, where).toBe(json.measuredFrom ?? json.derivedFrom)
    }
  })
})

/**
 * The lock table, and why it is a table.
 *
 * `src/generator/PROVENANCE.md` records three traps in upstream's `bases.py`.
 * This file is trap 1:
 *
 * > **The filename's lock name is not the `-D LOCK` value.** In `connections()`
 * > the entry whose filename says `openlock` is generated with
 * > `-D LOCK="triplex"`, and the one that says `openlock+unsupported` is
 * > generated with `-D LOCK="openlock"` (plus `SUPPORTS="false"`). In
 * > `curved_connections()` those two are **the other way round**. So the mapping
 * > is per-generator, it looks like an upstream slip, and it cannot be inferred
 * > from the name. S4 must carry the table, not a rule.
 *
 * S2 carries it for a narrower reason than S4 will. A benchmark that prints
 * "openlock: 61 ms" without saying which `-D LOCK` produced it is unreadable,
 * because two different rows of the catalog are called `openlock` and they are
 * different meshes. Every configuration this harness runs therefore records
 * *both* names, and `report.ts` prints both.
 *
 * Only the entries upstream actually documents are here. `confidence` says which
 * ones rest on `PROVENANCE.md`'s reading of `bases.py` and which are the
 * unambiguous identity mappings; nothing is guessed to fill the table out.
 */

/** A `-D LOCK` value. The five the `.scad` customizer enum offers. */
export type LockValue = 'openlock' | 'triplex' | 'infinitylock' | 'dragonlock' | 'none'

/** The five values, in the order `bases-square.scad`'s enum lists them. */
export const LOCK_VALUES: readonly LockValue[] = [
  'openlock',
  'triplex',
  'infinitylock',
  'dragonlock',
  'none',
] as const

/**
 * Which `bases.py` generator function a row came from. The swap is per-function,
 * so this is the axis the table is keyed on and not a detail.
 */
export type LockFamily = 'square' | 'curved'

export interface LockRow {
  /** What the catalogued filename's option list calls it. Not a `-D` value. */
  readonly label: string
  /** Which `bases.py` generator emits this row. */
  readonly family: LockFamily
  /** The actual `-D LOCK` value. This is the one that reaches OpenSCAD. */
  readonly lock: LockValue
  /** `-D SUPPORTS`, when the row sets it away from the `.scad` default of `"true"`. */
  readonly supports?: 'true' | 'false'
  /** `-D TOPLESS`, when the row's label pins it. */
  readonly topless?: 'true' | 'false'
  /**
   * `documented` — `PROVENANCE.md` states this mapping explicitly, quoting
   * `bases.py`. `identity` — label and `-D` value coincide and nothing upstream
   * says otherwise.
   */
  readonly confidence: 'documented' | 'identity'
}

/**
 * The rows. Note `openlock` and `openlock+unsupported`: the `square` pair and
 * the `curved` pair are mirror images, which is the whole point of the table.
 */
export const LOCK_TABLE: readonly LockRow[] = [
  // Trap 1, square side. `connections()`.
  { label: 'openlock', family: 'square', lock: 'triplex', confidence: 'documented' },
  {
    label: 'openlock+unsupported',
    family: 'square',
    lock: 'openlock',
    supports: 'false',
    confidence: 'documented',
  },
  // Trap 1, curved side. `curved_connections()` — "the other way round".
  { label: 'openlock', family: 'curved', lock: 'openlock', confidence: 'documented' },
  {
    label: 'openlock+unsupported',
    family: 'curved',
    lock: 'triplex',
    supports: 'false',
    confidence: 'documented',
  },
  // The rows the swap does not touch.
  {
    label: 'openlock+topless',
    family: 'square',
    lock: 'openlock',
    topless: 'true',
    confidence: 'identity',
  },
  {
    label: 'openlock+topless',
    family: 'curved',
    lock: 'openlock',
    topless: 'true',
    confidence: 'identity',
  },
  { label: 'dragonlock', family: 'square', lock: 'dragonlock', confidence: 'identity' },
  { label: 'dragonlock', family: 'curved', lock: 'dragonlock', confidence: 'identity' },
  { label: 'infinitylock', family: 'square', lock: 'infinitylock', confidence: 'identity' },
  { label: 'infinitylock', family: 'curved', lock: 'infinitylock', confidence: 'identity' },
  { label: 'none', family: 'square', lock: 'none', confidence: 'identity' },
  { label: 'none', family: 'curved', lock: 'none', confidence: 'identity' },
] as const

/**
 * The `-D` values for a filename label in one generator family.
 *
 * Throws on an unknown pair rather than falling back to `label as LockValue`,
 * which is exactly the inference trap 1 exists to forbid.
 */
export function lockRow(label: string, family: LockFamily): LockRow {
  const row = LOCK_TABLE.find((candidate) => candidate.label === label && candidate.family === family)
  if (row === undefined) {
    const known = LOCK_TABLE.filter((candidate) => candidate.family === family)
      .map((candidate) => candidate.label)
      .join(', ')
    throw new Error(
      `no lock row for label "${label}" in the ${family} family. ` +
        `The filename label is not the -D LOCK value (PROVENANCE.md trap 1), so there is ` +
        `no fallback. Known ${family} labels: ${known}`,
    )
  }
  return row
}

/**
 * Every filename label that maps to this `-D LOCK` value, as `family:label`.
 *
 * Read the other way round: what a reader of a catalogued filename would have
 * called the run. `report.ts` prints this beside each lock so a figure cannot be
 * mistaken for the label that names a different mesh.
 */
export function labelsFor(lock: LockValue): string[] {
  return LOCK_TABLE.filter((row) => row.lock === lock).map((row) => `${row.family}:${row.label}`)
}

/**
 * The two labels the swap makes ambiguous, and what each resolves to.
 *
 * Exported because it is the one fact in this file worth printing in a report
 * header: a reader who does not know about the swap will mistrust the numbers
 * rather than the naming.
 */
export function swappedLabels(): { label: string; square: LockValue; curved: LockValue }[] {
  const labels = ['openlock', 'openlock+unsupported']
  return labels.map((label) => ({
    label,
    square: lockRow(label, 'square').lock,
    curved: lockRow(label, 'curved').lock,
  }))
}

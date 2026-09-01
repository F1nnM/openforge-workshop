/**
 * The licence and the attribution table — §10's launch gate, inside the archive.
 *
 * *"Attribution must ride inside the download. A page footer does not travel
 * with a zip. Ship `LICENSE.txt` and a per-file `ATTRIBUTION.csv` in every
 * archive."* That is an obligation of CC BY-NC-SA 4.0, not a nicety, and it is
 * enforced structurally: `plan.ts` puts both entries in front of the models on
 * every archive it builds, and there is no option to leave them out.
 *
 * Both are written **first** in the archive, which matters for a reason beyond
 * tidiness — an interrupted download still carries the licence and the
 * attribution for whatever models did arrive.
 *
 * The CSV is per *file*, one row per archive entry, and it carries the three
 * fields §11 names — md5, catalog path, source URL — plus what a human actually
 * needs six months later: the entry name it maps to, how many copies the room
 * asked for, and the attribution string itself, so the row is usable without
 * reading `LICENSE.txt` first.
 */

/** The licence the whole corpus is distributed under. §10, first line. */
export const CORPUS_LICENCE = {
  id: 'CC BY-NC-SA 4.0',
  name: 'Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International',
  deed: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  legalCode: 'https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode',
} as const

/**
 * The BY line — who must be credited.
 *
 * §10: the corpus is scanned from the OpenForge Dropbox, and the project's own
 * statement is that everything distributed there is non-commercial *even where
 * the same design is BY-SA on Thingiverse*. So this credits the Dropbox
 * distribution, which is what these files are.
 */
export const CORPUS_ATTRIBUTION = {
  creator: 'Devon Jones / Masterwork Tools',
  work: 'OpenForge',
  home: 'https://www.patreon.com/masterworktools',
} as const

/** Where this archive came from, for the reader who finds it unlabelled later. */
export const TOOL_NAME = 'OpenForge Workshop'
export const TOOL_HOME = 'https://openforge.tools'

/** One row of `ATTRIBUTION.csv`. One per model entry in the archive. */
export interface AttributionRow {
  /** The entry's path inside this archive — the join key back to the files. */
  entry: string
  /** The content address. Also the join key into the catalog. */
  md5: string
  /**
   * Every catalog path carrying this md5 *in this bill*.
   *
   * Plural because 171 md5s are shared by 520 catalog rows: the same physical
   * STL is filed under two folders, and naming only one of them would misreport
   * where the file came from.
   */
  catalogPaths: readonly string[]
  /** The R2 URL the bytes were streamed from. */
  sourceUrl: string
  /** Size in bytes, as the index recorded it. */
  bytes: number
  /** Copies the room asked for. The file is in the archive once regardless. */
  copies: number
}

/** The CSV header, in order. Exported so a test can assert the shape without restating it. */
export const ATTRIBUTION_COLUMNS = [
  'entry',
  'md5',
  'catalog_paths',
  'source_url',
  'bytes',
  'copies',
  'licence',
  'attribution',
] as const

/**
 * `ATTRIBUTION.csv`.
 *
 * RFC 4180 quoting on every field, unconditionally, and that is not
 * belt-and-braces: **catalog filenames contain commas.**
 * `plain#base+angled.2x+60°.dragonlock,magnetic+flex.stl` is a real corpus path,
 * so an unquoted writer would silently shift every column after it. CRLF line
 * endings, also per RFC 4180, because the file is opened in Excel more often
 * than in anything else.
 */
export function attributionCsv(rows: readonly AttributionRow[]): string {
  const licence = CORPUS_LICENCE.id
  const attribution = `${CORPUS_ATTRIBUTION.work} by ${CORPUS_ATTRIBUTION.creator} (${CORPUS_ATTRIBUTION.home}), licensed ${licence}`

  const lines = [ATTRIBUTION_COLUMNS.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.entry,
        row.md5,
        row.catalogPaths.join('; '),
        row.sourceUrl,
        String(row.bytes),
        String(row.copies),
        licence,
        attribution,
      ]
        .map(csvField)
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/** What {@link licenceText} needs to know about the archive it is describing. */
export interface LicenceContext {
  /** Distinct files in the archive. */
  files: number
  /** Total bytes of models. */
  bytes: number
  /** When the archive was generated. */
  generatedAt: Date
}

/**
 * `LICENSE.txt`.
 *
 * Four things it must say, and the reason each is in there rather than on a page:
 *
 *   1. **The licence and the BY line**, because the recipient of a zip has no
 *      footer to read.
 *   2. **That the meshes are unmodified originals.** §10, obligation 3: a
 *      decimated preview is Adapted Material with its own labelling duty, so an
 *      archive has to state which of the two it holds. This one is always the
 *      former — see `source.ts` for how that is guaranteed rather than claimed.
 *   3. **What ShareAlike asks of the recipient**, in plain words, because "SA"
 *      is the clause people unknowingly breach.
 *   4. **That the tool is not the licensor.** The Workshop assembled the archive;
 *      the licence runs from the creator, and a reader chasing permissions needs
 *      to know where to go.
 *
 * Deliberately not in here: any statement about the licence of the catalog
 * *index*. §10, obligation 4 wants one, and it is a real gap — but the index is
 * not in this archive, and inventing a licence for something the archive does not
 * contain would be worse than the omission.
 */
export function licenceText(context: LicenceContext): string {
  const { creator, work, home } = CORPUS_ATTRIBUTION
  return [
    `${work} — model files`,
    '='.repeat(`${work} — model files`.length),
    '',
    `Licence:     ${CORPUS_LICENCE.id}`,
    `             ${CORPUS_LICENCE.name}`,
    `Deed:        ${CORPUS_LICENCE.deed}`,
    `Legal code:  ${CORPUS_LICENCE.legalCode}`,
    '',
    `Attribution: ${work} by ${creator}`,
    `             ${home}`,
    '',
    'ATTRIBUTION',
    '',
    'If you share these models, or anything you make from them, credit them as:',
    '',
    `    "${work}" by ${creator}, ${home} — licensed ${CORPUS_LICENCE.id}`,
    '',
    `ATTRIBUTION.csv beside this file names every model in the archive: its md5,`,
    'the catalog path it was filed under, and the URL it was downloaded from.',
    '',
    'NONCOMMERCIAL',
    '',
    'You may not use these models primarily for commercial advantage or monetary',
    'compensation. Printing them for your own table, for your group, or as a gift',
    'is fine. Selling prints of them is not.',
    '',
    'SHAREALIKE',
    '',
    'If you distribute a modified model — remixed, rescaled, cut, merged — it must',
    `carry the same licence, ${CORPUS_LICENCE.id}, and the attribution above.`,
    '',
    'WHAT IS IN THIS ARCHIVE',
    '',
    `    ${String(context.files)} model file(s), ${formatBytes(context.bytes)}`,
    `    assembled ${context.generatedAt.toISOString()} by ${TOOL_NAME} (${TOOL_HOME})`,
    '',
    'Every file under models/ is the original mesh, byte-for-byte as published —',
    'not a decimated preview. Decimated meshes are adapted material with their own',
    'labelling obligations, and they are never included in a download.',
    '',
    `${TOOL_NAME} assembled this archive; it is not the licensor. The licence runs`,
    `from ${creator}, and permissions beyond it are theirs to give.`,
    '',
  ].join('\n')
}

/** Decimal, matching every corpus size figure the plan quotes (10.36 MB median, 108.0 GB total). */
function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${String(bytes)} bytes`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1_000
  let unit = 0
  while (value >= 1_000 && unit < units.length - 1) {
    value /= 1_000
    unit += 1
  }
  return `${value.toFixed(2)} ${units[unit] ?? 'TB'}`
}

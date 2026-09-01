/**
 * The numbers this PR exists to move, computed rather than asserted.
 *
 * PR 13 measured the catalog grid against the real bucket and found the app's
 * largest performance problem:
 *
 *   - the first 60 tiles in display order are **42.06 MB** over the wire
 *     (mean 685 KB, max 1001 KB) — worse than the 529 KB corpus average,
 *     because the aztlan floors leading the ordinal order are the heaviest;
 *   - one 1440×900 screenful is 12 cards and **7.1 MB**;
 *   - decoded image memory, as browser RSS delta, is **+358 MB for that one
 *     screenful**, plateauing near **548 MB** under scroll.
 *
 * That last figure is the one that cannot be fixed from the frontend: showing
 * one 512 px frame of a 2560×1024 sheet requires the browser to hold the whole
 * sheet's decode, so `background-position` and a clipped `<img>` cost exactly
 * the same. Only a smaller source image fixes it, which is what this tool
 * produces.
 *
 * Everything below is either measured from the run or clearly labelled as
 * projected from it. The two are kept in separate fields so a report cannot
 * accidentally present one as the other.
 */
import type { SampleReason } from './sample'

/** Corpus-wide inputs, from the index and from PR 13's measurement. */
export interface CorpusInputs {
  /** Live tiles carrying a sheet: 8,701. */
  tiles: number
  /** Distinct sheets after md5 dedupe. */
  sheets: number
  /** PR 13 / plan §2: mean sprite-sheet size across the corpus, 529 KB. */
  meanSheetBytes: number
  /** PR 13: bytes for the first {@link cardRun} cards in display order. */
  cardRunSheetBytes: number
  /** PR 13: cards in that measured run, 60. */
  cardRun: number
  /** PR 13: cards in one 1440×900 viewport, 12. */
  cards: number
}

/**
 * PR 13's measurements, as the documented inputs to the comparison.
 *
 * Held as constants with their provenance rather than re-measured here: this
 * tool does not render the grid, so it cannot re-derive them, and quietly
 * inventing a "before" figure would defeat the point of the comparison.
 */
export const PR13: Pick<CorpusInputs, 'meanSheetBytes' | 'cardRunSheetBytes' | 'cardRun' | 'cards'> = {
  /** 529 KB corpus mean, read as KiB — see the unit note below. */
  meanSheetBytes: Math.round(529 * 1024),
  /** 42.06 MB for the first 60 cards, read as **decimal** MB — see the unit note. */
  cardRunSheetBytes: Math.round(42.06 * 1_000_000),
  cardRun: 60,
  cards: 12,
}

/**
 * The unit note, because getting this wrong quietly inflates the headline by 5%.
 *
 * PR 13's figures mix bases, and which base each one uses is recoverable from
 * its own arithmetic rather than guessed:
 *
 *   - **42.06 MB over 60 cards is decimal.** `42.06e6 / 60 = 684.6 KiB`, which
 *     reproduces PR 13's stated per-card mean of 685 KB to 0.07%. Read as MiB it
 *     would give 735 KiB per card and contradict that mean by 7%.
 *   - **685 KB per card is KiB**, by the same identity.
 *   - **7.1 MB for one screenful is decimal.** This tool measured those same
 *     twelve sheets at 7,120,000 bytes.
 *   - 529 KB corpus mean is taken as KiB, consistent with the per-card mean.
 *     Only the corpus "before" total depends on it.
 *
 * Output through `formatBytes` is 1024-based throughout, matching
 * `pipeline/emit.ts`, so a printed "MB" is a MiB.
 */
export const PR13_UNIT_NOTE = 'PR 13: totals are decimal MB, per-file means are KiB'

/** One derived thumbnail, and the sheet it came from. */
export interface ThumbStat {
  blob: string
  reason: SampleReason
  sheetBytes: number
  thumbBytes: number
}

export interface Spread {
  count: number
  total: number
  mean: number
  median: number
  p95: number
  min: number
  max: number
  /** Population standard deviation — how safe the mean is to multiply by. */
  stdev: number
}

export interface Measurement {
  thumb: Spread
  sheet: Spread
  /** Total sheet bytes ÷ total thumbnail bytes over the sample. */
  reductionOverall: number
  /** Median sheet ÷ median thumbnail — robust against the sample's heavy tail. */
  reductionMedian: number
  /** Exactly the sheets in the `screenful` stratum: measured before and after. */
  screenful: {
    cards: number
    sheetBytes: number
    thumbBytes: number
    reduction: number
    /** True when the stratum holds a full viewport's worth. */
    complete: boolean
  }
  /** The 60-card run PR 13 measured over the wire. Thumbnail side is projected. */
  cardRun: {
    cards: number
    /** PR 13's measurement. */
    sheetBytes: number
    /** `cards × mean thumbnail` — projected. */
    projectedThumbBytes: number
    reduction: number
  }
  /** Whole-corpus storage, projected from the sample mean. */
  corpus: {
    sheets: number
    /** `sheets × mean sheet` from the corpus average, not from this sample. */
    sheetBytes: number
    /** Projected. */
    projectedThumbBytes: number
    reduction: number
  }
  /**
   * Decoded-bitmap cost, which is arithmetic rather than a measurement: an RGBA
   * decode is `w × h × 4` bytes regardless of how well the file compressed.
   */
  decode: {
    /** One 2560×1024 sheet: 10.0 MiB. */
    sheetBytes: number
    /** One 256 px thumbnail: 256 KiB. */
    thumbBytes: number
    factor: number
    screenfulSheetBytes: number
    screenfulThumbBytes: number
  }
  elapsedMs: number
}

export interface MeasureOptions {
  corpus: CorpusInputs
  /** Sheet pixel dimensions, for the decode arithmetic. */
  sheetExtent: { width: number; height: number }
  /** Thumbnail edge length. */
  thumbSize: number
  elapsedMs: number
}

export function measure(stats: readonly ThumbStat[], options: MeasureOptions): Measurement {
  if (stats.length === 0) throw new Error('nothing to measure — no thumbnail was produced')

  const thumb = spread(stats.map((s) => s.thumbBytes))
  const sheet = spread(stats.map((s) => s.sheetBytes))
  const screenfulStats = stats.filter((s) => s.reason === 'screenful')
  const screenfulSheet = sum(screenfulStats.map((s) => s.sheetBytes))
  const screenfulThumb = sum(screenfulStats.map((s) => s.thumbBytes))

  const decodeSheet = options.sheetExtent.width * options.sheetExtent.height * 4
  const decodeThumb = options.thumbSize * options.thumbSize * 4
  const { corpus } = options

  const projectedCardRun = Math.round(corpus.cardRun * thumb.mean)
  const projectedCorpus = Math.round(corpus.sheets * thumb.mean)
  const corpusSheetBytes = corpus.sheets * corpus.meanSheetBytes

  return {
    thumb,
    sheet,
    reductionOverall: sheet.total / thumb.total,
    reductionMedian: sheet.median / thumb.median,
    screenful: {
      cards: screenfulStats.length,
      sheetBytes: screenfulSheet,
      thumbBytes: screenfulThumb,
      reduction: screenfulThumb === 0 ? 0 : screenfulSheet / screenfulThumb,
      complete: screenfulStats.length >= corpus.cards,
    },
    cardRun: {
      cards: corpus.cardRun,
      sheetBytes: corpus.cardRunSheetBytes,
      projectedThumbBytes: projectedCardRun,
      reduction: corpus.cardRunSheetBytes / projectedCardRun,
    },
    corpus: {
      sheets: corpus.sheets,
      sheetBytes: corpusSheetBytes,
      projectedThumbBytes: projectedCorpus,
      reduction: corpusSheetBytes / projectedCorpus,
    },
    decode: {
      sheetBytes: decodeSheet,
      thumbBytes: decodeThumb,
      factor: decodeSheet / decodeThumb,
      screenfulSheetBytes: decodeSheet * corpus.cards,
      screenfulThumbBytes: decodeThumb * corpus.cards,
    },
    elapsedMs: options.elapsedMs,
  }
}

/* ------------------------------------------------------------------ statistics */

export function spread(values: readonly number[]): Spread {
  if (values.length === 0) throw new Error('spread of an empty sample')
  const sorted = [...values].sort((a, b) => a - b)
  const total = sum(sorted)
  const mean = total / sorted.length
  const variance = sum(sorted.map((v) => (v - mean) ** 2)) / sorted.length
  return {
    count: sorted.length,
    total,
    mean,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    stdev: Math.sqrt(variance),
  }
}

/** Linear-interpolated percentile over an already-sorted array. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new Error('percentile of an empty sample')
  if (sorted.length === 1) return sorted[0] as number
  const rank = ((p / 100) * (sorted.length - 1))
  const low = Math.floor(rank)
  const high = Math.ceil(rank)
  const lowValue = sorted[low] as number
  if (low === high) return lowValue
  return lowValue + (rank - low) * ((sorted[high] as number) - lowValue)
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

/** 1024-based, matching `pipeline/emit.ts` so two reports are comparable. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

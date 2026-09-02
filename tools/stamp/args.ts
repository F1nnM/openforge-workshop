/**
 * The CLI's argument surface, split out so it can be tested without running the
 * step. `tools/scad-bench/args.ts` does the same, and for the same reason:
 * `cli.ts` ends in `process.exitCode = main()`, so importing it to check a flag
 * would rebuild the corpus.
 */
import type { ArtefactId } from './report'

export const USAGE = `Regenerate the derived artefacts and stamp them against one index.

usage: tsx tools/stamp/cli.ts [options]

  --dry-run          check only; write neither catalog.json nor stamp.json
  --require LIST     comma-separated artefact ids whose bad status fails the run
                     (index, share and sidecar are always required)
  --relock           re-take the derivation lock over the current tree and exit
  --stamp PATH       stamp.json (default public/catalog/stamp.json)
  --worklist PATH    write the full md5 work lists here
  --summary PATH     append a markdown summary (GITHUB_STEP_SUMMARY)
  --fixtures DIR     fixtures directory
  --sidecar PATH     override tools/measure/measurements.json
  --thumbs PATH      override tools/thumbnails/out/upload-manifest.json
  --lod PATH         override tools/lod/out/upload-manifest.json
  -h, --help
`

export interface Args {
  dryRun: boolean
  relock: boolean
  require: ArtefactId[]
  stamp: string
  worklist?: string
  summary?: string
  fixtures?: string
  sidecar?: string
  thumbs?: string
  lod?: string
}

export const ARTEFACT_IDS: readonly ArtefactId[] = ['index', 'share', 'sidecar', 'thumbs', 'lod']

export function parseArgs(argv: readonly string[]): Args | 'help' {
  const args: Args = { dryRun: false, relock: false, require: [], stamp: 'public/catalog/stamp.json' }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = (): string => {
      const next = argv[i + 1]
      if (next === undefined) throw new Error(`${String(flag)} needs a value`)
      i += 1
      return next
    }

    switch (flag) {
      case '-h':
      case '--help':
        return 'help'
      case '--dry-run':
        args.dryRun = true
        break
      case '--relock':
        args.relock = true
        break
      case '--require':
        for (const id of value().split(',')) {
          const trimmed = id.trim()
          if (trimmed === '') continue
          if (!ARTEFACT_IDS.includes(trimmed as ArtefactId)) {
            throw new Error(`--require: unknown artefact ${trimmed}; expected one of ${ARTEFACT_IDS.join(', ')}`)
          }
          args.require.push(trimmed as ArtefactId)
        }
        break
      case '--stamp':
        args.stamp = value()
        break
      case '--worklist':
        args.worklist = value()
        break
      case '--summary':
        args.summary = value()
        break
      case '--fixtures':
        args.fixtures = value()
        break
      case '--sidecar':
        args.sidecar = value()
        break
      case '--thumbs':
        args.thumbs = value()
        break
      case '--lod':
        args.lod = value()
        break
      default:
        throw new Error(`unknown option ${String(flag)}`)
    }
  }

  return args
}

// @vitest-environment jsdom
/**
 * The generated half of the bill and the download, rendered and pressed.
 *
 * Row S5 built four refusals into the pack and exercised all four against its
 * own functions. What it could not do is show that any of them is **reachable**,
 * because nothing constructed the failing state: *"Drawing is not wired."* A
 * refusal that becomes unreachable because the UI never builds the state is a
 * regression that no unit test can see, so every refusal here is driven through
 * the real `useArchiveDownload`, from a real store scene, with the two seams
 * `@/download` publishes for the purpose injected and nothing else stubbed.
 *
 * The one that matters most is the first: **an incomplete bill fails the download
 * rather than shipping a pack one file short.** A zip written in streaming mode
 * records each entry's size after the data, so a short archive opens cleanly and
 * one mesh inside it is a corrupt STL nobody discovers until the print fails.
 * And it is not an exotic state — *every* generated base comes back unrendered
 * after a reload, because the recipe persists and the mesh does not.
 *
 * ## What is real here
 *
 * The real store (so a base goes through `placeGeneratedBase`'s Zod parse), the
 * real `buildGeneratedBill`, the real `buildGeneratedPack` and
 * `generatedBlobSource` reached through the hook's own dynamic import, the real
 * `buildArchivePlan`, the real `openArchiveStream` and its exact-length guard.
 * Injected: {@link SaveEnvironment} and {@link BlobSource}, which is what lets a
 * download be exercised without a network or a browser that can save a file.
 *
 * ## What these tests cannot prove
 *
 * jsdom rasterises nothing and measures no layout, so nothing here says the
 * section *looks* right — not its position in the bill's scroll area, not
 * whether the provenance is legible at 11.5px, not whether the handle column
 * lines up with the thumbnails above it. What is asserted is text content,
 * attributes and the bytes a real stream produced.
 */
import { TextEncoder as NodeTextEncoder } from 'node:util'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import type { AssemblyIndex } from '@/assembly'
import type { CatalogFile, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { BlobSource, SaveEnvironment } from '@/download'
/**
 * The real md5, from row S3's implementation, not a stub and not a constant.
 *
 * `verifyGeneratedMesh` recomputes the digest over the held bytes and refuses if
 * it does not match, so a fixture with a made-up md5 would fail every test in
 * this file for the wrong reason — and would make the digest refusal below
 * unfalsifiable, because it would already be firing.
 */
import { md5 as md5Of } from '@/generator/engine/md5'
import { buildGeneratedBill } from '@/generator/placement/bill'
import { resolveMaterial } from '@/materials'
import { createSearchEngine } from '@/search'
import type { CatalogIndex } from '@/screens/catalog'
import { aBinaryStl, aGeneratedBase } from '@/store/fixture'
import {
  clearPersistedWorkshopState,
  holdGeneratedMesh,
  placeGeneratedBase,
  placeTile,
  resetWorkshop,
  useGeneratedHoldings,
  useGeneratedMeshes,
  useGeneratedPlacements,
  usePlacements,
} from '@/store'

import { BillPanel } from './BillPanel'
import { FIXTURE_IDS, fixtureCatalogFile } from './fixture'
import { useArchiveDownload } from './useArchiveDownload'

/* ------------------------------------------------------------------ scaffold */

let file: CatalogFile
let index: CatalogIndex
let assembly: AssemblyIndex

/**
 * Node's `TextEncoder`, re-wrapped so its output is allocated with the *global*
 * `Uint8Array`.
 *
 * `panels.test.tsx` carries the full argument: under jsdom the two are different
 * classes and `vendor/client-zip` branches on `instanceof Uint8Array` to decide
 * whether an entry body is bytes or a stream, so without this the writer takes
 * the stream branch for `LICENSE.txt` and dies before any assertion is reached.
 * It is a realm shim, not a stub of anything under test.
 */
class RealmSafeTextEncoder {
  readonly encoding = 'utf-8'

  encode(input = ''): Uint8Array {
    return Uint8Array.from(new NodeTextEncoder().encode(input))
  }

  encodeInto(input: string, destination: Uint8Array): { read: number; written: number } {
    const bytes = this.encode(input)
    const written = Math.min(bytes.length, destination.length)
    destination.set(bytes.subarray(0, written))
    return { read: input.length, written }
  }
}

const saved: { blob: Blob; filename: string }[] = []

beforeEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  saved.length = 0
  file = fixtureCatalogFile()
  const engine = createSearchEngine(file)
  index = {
    file,
    engine,
    tagsFor: (record) => resolveTags(file, record),
    materialOf: (record) => resolveMaterial(resolveTags(file, record), record.file).material,
  }
  assembly = buildAssemblyIndex(file)
  vi.stubGlobal('TextEncoder', RealmSafeTextEncoder)
})

afterEach(() => {
  resetWorkshop()
  clearPersistedWorkshopState()
  vi.unstubAllGlobals()
})

function blobEnvironment(limit?: number): SaveEnvironment {
  return {
    saveBlob: (blob, filename) => {
      saved.push({ blob, filename })
    },
    ...(limit === undefined ? {} : { blobLimitBytes: limit }),
  }
}

function fakeSource(sizes: Map<string, number>): BlobSource {
  return {
    urlFor: (blob) => `https://objects.openforge.tools/models/${blob.slice(0, 6)}/${blob}.stl`,
    open: (blob) =>
      Promise.resolve(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(sizes.get(blob) ?? 0))
            controller.close()
          },
        }),
      ),
  }
}

const sizesOf = (catalogFile: CatalogFile) =>
  new Map(catalogFile.records.map((record) => [record.blob as string, record.bytes]))

/** Place one generated base, and hold bytes for it unless `render` is false. */
function placeBase(options: { x?: number; render?: boolean; triangles?: number; parameters?: Record<string, unknown> } = {}) {
  const base = aGeneratedBase({
    x: options.x ?? 0,
    z: 0,
    ...(options.parameters === undefined ? {} : { parameters: options.parameters as never }),
  })
  const key = placeGeneratedBase(base)
  if (options.render !== false) {
    const bytes = aBinaryStl(options.triangles ?? 4)
    holdGeneratedMesh(base.base, { md5: md5Of(bytes), bytes })
  }
  return { key, base }
}

/* ------------------------------------------------------------------ harness */

function Harness({
  environment,
  source,
}: {
  environment?: SaveEnvironment
  source?: BlobSource
}) {
  const placements = usePlacements()
  const generatedPlacements = useGeneratedPlacements()
  const meshes = useGeneratedMeshes()
  const holdings = useGeneratedHoldings()

  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { lock: 'openlock' }),
    [placements],
  )
  const generatedBill = useMemo(
    () => buildGeneratedBill(generatedPlacements, { meshes }),
    [generatedPlacements, meshes],
  )

  const download = useArchiveDownload({
    bill,
    assets: file.assets,
    generated: { bill: generatedBill, holdings },
    ...(environment === undefined ? {} : { environment }),
    ...(source === undefined ? {} : { source }),
  })

  return (
    <div>
      <BillPanel
        bill={bill}
        placements={placements}
        assets={index.file.assets}
        sheet={index.file.sprite}
        materialOf={index.materialOf}
        download={download}
        generated={{ bill: generatedBill, placements: generatedPlacements }}
      />
      {/* An always-enabled trigger, so a refusal can be reached through the hook
          even in the states where the button is correctly disabled. */}
      <button type="button" onClick={download.start}>
        force download
      </button>
    </div>
  )
}

const failure = async () => waitFor(() => screen.getByRole('alert'))
const section = () => screen.getByRole('region', { name: /bases to print|base to print/ })

/* -------------------------------------------------------------- the section */

describe('the bill’s generated section', () => {
  it('is absent until a base is placed', () => {
    render(<Harness />)
    expect(screen.queryByText(/bases to print|base to print/)).toBeNull()
  })

  it('lists a rendered base with its handle, size, material and mesh facts', () => {
    placeBase({ triangles: 6 })
    render(<Harness />)

    const list = section()
    expect(list).toHaveTextContent('1 base to print, from 1 recipe')
    expect(list).toHaveTextContent('Generated square base')
    expect(list).toHaveTextContent('2 × 2 squares')
    expect(list).toHaveTextContent('rendered here')
    expect(list).toHaveTextContent('6 triangles')
    // Bytes are stated but explicitly kept out of the download verdict: the
    // verdict is about *fetch* cost and these bytes are already in memory.
    expect(list).toHaveTextContent(/Not fetched, so not counted in the download verdict/)
  })

  it('marks an unrendered base as a warning, and says what will happen', () => {
    placeBase({ render: false })
    render(<Harness />)

    const list = section()
    expect(list).toHaveTextContent('1 recipe has no mesh yet')
    expect(list).toHaveTextContent('not rendered')
    expect(list).toHaveTextContent(/On the plan, not in the download/)
    expect(list).toHaveTextContent(/the download will refuse/)
    // The reason a reload lands here, in the panel rather than only in a report.
    expect(list).toHaveTextContent(/the recipe is kept and the mesh is not/)
    // The row itself, not the placement items nested inside it.
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute('data-severity', 'warn')
  })

  it('discloses the provenance verbatim, and never names a published file', () => {
    placeBase()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Generated square base/ }))

    const list = section()
    // Row S5's three sentences: the pinned geometry, why nothing published
    // answered, and what the digest does and does not establish.
    expect(list).toHaveTextContent(/Apache-2\.0 geometry at MasterworkTools\/openforge-bases@e6dbbff/)
    expect(list).toHaveTextContent(/No file this catalog build publishes names these parameters/)
    expect(list).toHaveTextContent(/identifies these bytes rather than vouching for them/)
    // The claim this row is least allowed to get wrong.
    expect(list).not.toHaveTextContent(/\.stl/)
  })

  it('discloses every -D rather than summarising, and expands the placements', () => {
    const { key } = placeBase()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Generated square base/ }))

    const list = section()
    expect(list).toHaveTextContent(/15 parameters, as passed/)
    expect(list).toHaveTextContent('SQUARE_BASIS')
    expect(list).toHaveTextContent('MAGNET_HOLE')
    expect(within(list).getByRole('button', { name: /Remove Generated square base/ })).toBeInTheDocument()
    void key
  })

  it('removes a placed base from the plan, which is also how its mesh is released', () => {
    placeBase()
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Generated square base/ }))
    fireEvent.click(screen.getByRole('button', { name: /Remove Generated square base/ }))

    expect(screen.queryByText(/base to print/)).toBeNull()
  })

  it('groups copies of one recipe into one row and one mesh', () => {
    const { base } = placeBase()
    placeGeneratedBase({ ...base, x: 6 })
    render(<Harness />)

    const list = section()
    expect(list).toHaveTextContent('2 bases to print, from 1 recipe')
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(list).toHaveTextContent('×2')
  })

  it('warns that a non-inch base will not tile, with the basis', () => {
    placeBase({ parameters: { x: 2, y: 2, SQUARE_BASIS: 'wyloch' } })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /Generated square base/ }))

    const list = section()
    expect(list).toHaveTextContent('31.75 mm/square')
    expect(list).toHaveTextContent(/will not tile/)
    expect(within(list).getAllByRole('listitem')[0]).toHaveAttribute('data-severity', 'warn')
    // 2 x 31.75 / 25.4 = 2.5 grid squares. Drawing or billing it at 2 would
    // understate a real object by 25%.
    expect(list).toHaveTextContent('2.5 × 2.5')
  })
})

/* ------------------------------------------------------- the four refusals */

describe('the pack’s refusals, through the real hook', () => {
  it('(1) fails the download rather than shipping a pack one file short', async () => {
    placeBase({ render: false })
    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)

    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'unrendered')
    expect(alert).toHaveTextContent(/One generated base has not been rendered/)
    expect(alert).toHaveTextContent(/one file short and would still open/)
    // Nothing was saved. That is the whole refusal.
    expect(saved).toHaveLength(0)
  })

  it('(2) refuses bytes that are not a whole binary STL', async () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    // 200 bytes: neither `84 + 50n` nor an ASCII header. What a clipped mesh
    // looks like, and the format check *is* the truncation check.
    const clipped = new Uint8Array(200)
    holdGeneratedMesh(base.base, { md5: md5Of(clipped), bytes: clipped })

    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'mesh-refused')
    expect(alert).toHaveTextContent(/200 bytes matching neither the binary layout nor an ASCII header/)
    expect(saved).toHaveLength(0)
  })

  it('(3) refuses a mesh with zero triangles, which OpenSCAD reports as success', async () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    const empty = aBinaryStl(0)
    holdGeneratedMesh(base.base, { md5: md5Of(empty), bytes: empty })

    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'mesh-refused')
    expect(alert).toHaveTextContent(/zero triangles/)
    expect(alert).toHaveTextContent(/no assert\(\) in it/)
    expect(saved).toHaveLength(0)
  })

  it('(4) refuses a digest that does not recompute', async () => {
    const base = aGeneratedBase({ x: 0, z: 0 })
    placeGeneratedBase(base)
    // A well-formed mesh under a digest that is not its own — a hold swapped or
    // clipped between the render and the save.
    holdGeneratedMesh(base.base, { md5: '0'.repeat(32), bytes: aBinaryStl(4) })

    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'mesh-refused')
    expect(alert).toHaveTextContent(/not to the digest the pack named them by/)
    expect(saved).toHaveLength(0)
  })
})

/* ---------------------------------------------------------- the happy paths */

describe('downloading a room with generated bases in it', () => {
  it('streams a mixed room whose length matches the plan to the byte', async () => {
    placeTile({ tileId: FIXTURE_IDS.floor1 as TileId, x: 0, z: 0, rotation: 0 })
    placeBase({ x: 6, triangles: 12 })

    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))

    await waitFor(() => {
      expect(screen.getByText(/^Saved/)).toBeInTheDocument()
    })
    // `stream.ts` fails the download when the total is off by one byte in either
    // direction, so reaching `Saved` at all is the exact-length claim — and it
    // covers the generated entry, which the composed source served from memory.
    expect(saved).toHaveLength(1)
    expect(saved[0]?.blob.size).toBeGreaterThan(1_000_000)
  })

  it('downloads a room built only out of generated bases', async () => {
    // Row S5 made `buildArchivePlan` accept this — "a room built entirely out of
    // generated bases is a real room" — and a button disabled on `files === 0`
    // would have made it unreachable from the UI.
    placeBase({ triangles: 20 })
    render(<Harness environment={blobEnvironment()} source={fakeSource(sizesOf(file))} />)

    expect(screen.getByRole('button', { name: /Download tile pack/ })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))

    await waitFor(() => {
      expect(screen.getByText(/^Saved/)).toBeInTheDocument()
    })
    // LICENSE.txt, ATTRIBUTION.csv, GENERATED.txt and one mesh — kilobytes, not
    // megabytes, because no catalog file is in it.
    expect(saved[0]?.blob.size).toBeGreaterThan(10_000)
    expect(saved[0]?.blob.size).toBeLessThan(1_000_000)
  })

  it('says in the caption that ATTRIBUTION.csv cannot cover a generated mesh', () => {
    placeBase()
    render(<Harness />)
    expect(screen.getByText(/does not and cannot cover them/)).toBeInTheDocument()
  })

  it('discloses what the URL list cannot represent, beside the offer', async () => {
    // §11's degradation path has nothing to offer a mesh that was never
    // published: there is no URL, because the bytes were made in this browser.
    // Row S5's `urlListShortfall` is that sentence and this is the call site.
    placeTile({ tileId: FIXTURE_IDS.big as TileId, x: 0, z: 0, rotation: 0 })
    placeBase({ x: 20 })

    render(<Harness environment={blobEnvironment(1_000_000)} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'too-large')
    expect(within(alert).getByRole('button', { name: /Take the URL list/ })).toBeInTheDocument()
    expect(alert).toHaveTextContent(/The URL list covers the archive's published files only/)
    expect(alert).toHaveTextContent(/1 generated mesh is not in it/)
  })

  it('says nothing about a shortfall when there is none', async () => {
    placeTile({ tileId: FIXTURE_IDS.big as TileId, x: 0, z: 0, rotation: 0 })
    render(<Harness environment={blobEnvironment(1_000_000)} source={fakeSource(sizesOf(file))} />)
    fireEvent.click(screen.getByRole('button', { name: /Download tile pack/ }))
    const alert = await failure()

    expect(alert).toHaveAttribute('data-kind', 'too-large')
    expect(alert).not.toHaveTextContent(/generated mesh/)
  })
})

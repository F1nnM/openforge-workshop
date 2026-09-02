// @vitest-environment jsdom
/**
 * The drawer, rendered — with a stub engine, and no engine at all on a hit.
 *
 * The engine is injected rather than mocked at the module boundary, because
 * `usePreview` takes its three loaders as options precisely so this test can
 * hand it a function that counts calls. That makes the central claim assertable
 * rather than assumed: **on a cache hit the engine is never loaded**, which is
 * the whole of catalog-first resolution and would otherwise be invisible.
 *
 * ## What these tests prove
 *
 *   - The launch button is the only thing mounted until it is pressed.
 *   - A recipe the archive publishes shows the published file and loads nothing.
 *   - A recipe it does not shows the honest strip and reaches the engine once,
 *     after the debounce and not before.
 *   - The form draws all fifteen of `bases-square.scad`'s parameters, in eight
 *     groups, with the injected `none` selectable on `CENTER`.
 *   - The refusal the geometry would echo is shown *instead of* a render.
 *   - The GPL-2 notice reaches the screen with the engine.
 *
 * ## What they cannot prove
 *
 * That the mesh is right. Nothing in jsdom renders geometry, and the parameter
 * recovery is checked against the archive in `corpus.test.ts` and against the
 * real binary in `engine.test.ts`.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CatalogAssets, CatalogRecord } from '@/catalog'

import GeneratorDrawer from './GeneratorDrawer'
import { GeneratorPanel } from './GeneratorPanel'
import { canonicalise, recipeKey } from './recipe'
import { replayIndex, splitBaseFilename, joinKey } from './resolve'

const ASSETS: Pick<CatalogAssets, 'models'> = { models: 'https://objects.example/models' }

/**
 * One archived base, built from the sweep rather than typed out.
 *
 * Taking the filename from the replay means this fixture cannot drift from the
 * grammar the resolver joins on: if the tables move, the record moves with them.
 */
function archivedRecord(file: string, blob: string, bytes: number): CatalogRecord {
  const swept = replayIndex().get(joinKey(splitBaseFilename(file)))
  if (swept === undefined) throw new Error(`${file} is not a file the sweep produces`)
  return {
    id: `tiles/bases/${file}`,
    ord: 1,
    blob,
    file,
    bytes,
    sprite: true,
    thumb: false,
    family: 'tiles/bases/plain',
    design: 'd0',
    name: 'Square Base 2x2',
    kinds: ['base'],
    conn: ['openlock', 'magnetic'],
    layer: 'base',
    tags: [],
    foot: { shape: 'rect', w: 2, d: 2 },
  } as unknown as CatalogRecord
}

const RECORDS: readonly CatalogRecord[] = [
  archivedRecord('plain#base+square.2x2.openlock,magnetic+flex.stl', '32466acd0c82292869ae78f3c89fda70', 540_436),
]

/** A stub engine that counts loads and returns a two-triangle mesh. */
function stubEngine() {
  let loads = 0
  let renders = 0
  const mesh = new Uint8Array(84 + 100)
  new DataView(mesh.buffer).setUint32(80, 2, true)
  return {
    get loads() {
      return loads
    },
    get renders() {
      return renders
    },
    options: {
      load: () => {
        loads += 1
        return Promise.resolve({
          version: () => Promise.resolve({ version: { version: '0', commit: null }, compileMs: 0 }),
          schema: () => Promise.reject(new Error('not used')),
          render: () => {
            renders += 1
            return Promise.resolve({
              bytes: mesh,
              md5: 'a'.repeat(32),
              verification: { kind: 'self-addressed' as const, md5: 'a'.repeat(32) },
              diagnostics: { notable: [], suppressed: 0, failed: false },
              renderMs: 101,
              bootMs: 6,
              runs: 1,
            })
          },
          terminate: () => undefined,
        } as never)
      },
      loadLicence: () =>
        Promise.resolve({
          program: 'OpenSCAD',
          version: '2026.01.02.wasm30346',
          spdx: 'GPL-2.0-only',
          text: 'GNU GENERAL PUBLIC LICENSE',
          offer: 'machine-readable copy of the corresponding source code',
          sources: [{ what: 'OpenSCAD, the program', url: 'https://github.com/openscad/openscad', commit: '7a2053ed' }],
        }),
      loadDescriber: () => Promise.resolve(() => 'identifies these bytes rather than vouching for them'),
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the launch button', () => {
  it('is all that mounts until it is pressed', () => {
    render(<GeneratorPanel records={RECORDS} assets={ASSETS} />)
    expect(screen.getByRole('button', { name: /generate a base/i })).toBeTruthy()
    expect(screen.queryByRole('complementary', { name: /generate a base/i })).toBe(null)
  })
})

describe('the drawer on a cache hit', () => {
  it('names the published file and never loads the engine', async () => {
    const engine = stubEngine()
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={engine.options} />)

    // The lead is its own span, so the strip is its paragraph.
    const strip = screen.getByText(/in the archive/i).closest('p')
    expect(strip?.textContent).toContain('plain#base+square.2x2.openlock,magnetic+flex.stl')
    expect(strip?.textContent).toContain('0.52 MB')

    // The debounce would have fired by now if the recipe had missed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(engine.loads).toBe(0)
    expect(engine.renders).toBe(0)
  })

  it('offers the archived object, and does not call it this engine’s output', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    const link = screen.getByRole('link', { name: /download the archived file/i })
    expect(link.getAttribute('href')).toBe(
      'https://objects.example/models/32466a/32466acd0c82292869ae78f3c89fda70.stl',
    )
    expect(screen.getByText(/not the mesh this engine would produce/i)).toBeTruthy()
  })

  it('opens on a recipe that resolves, for the shape it opens on', () => {
    // The same claim `corpus.test.ts` makes against all five entry points; here
    // it is the one the fixture covers, so the drawer's first paint is a hit.
    const recipe = {
      v: 1 as const,
      entry: 'bases-square.scad',
      parameters: canonicalise('bases-square.scad', {
        x: 2,
        y: 2,
        LOCK: 'openlock',
        MAGNETS: 'flex_magnetic',
        MAGNET_HOLE: 6,
        PRIORITY: 'magnets',
        TOPLESS: 'false',
        SUPPORTS: 'true',
      }),
    }
    expect(recipeKey(recipe)).toContain('LOCK="openlock"')
  })
})

describe('the drawer on a miss', () => {
  it('reaches the engine once, after the debounce', async () => {
    const engine = stubEngine()
    render(<GeneratorDrawer records={[]} assets={ASSETS} onClose={() => undefined} preview={engine.options} />)

    expect(screen.getByText(/not in the archive/i)).toBeTruthy()
    expect(engine.loads).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await waitFor(() => {
      expect(engine.renders).toBe(1)
    })
    expect(engine.loads).toBe(1)
  })

  it('shows the digest wording S3 owns rather than one of its own', async () => {
    const engine = stubEngine()
    render(<GeneratorDrawer records={[]} assets={ASSETS} onClose={() => undefined} preview={engine.options} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await waitFor(() => {
      expect(screen.getByText(/identifies these bytes rather than vouching for them/i)).toBeTruthy()
    })
  })

  it('surfaces the GPL-2 notice with the engine', async () => {
    const engine = stubEngine()
    render(<GeneratorDrawer records={[]} assets={ASSETS} onClose={() => undefined} preview={engine.options} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400)
    })
    await waitFor(() => {
      expect(screen.getByText(/GPL-2.0-only/)).toBeTruthy()
    })
    expect(screen.getByText(/machine-readable copy of the corresponding source code/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /openscad\/openscad/ })).toBeTruthy()
  })
})

describe('the form', () => {
  it('draws all fifteen parameters of bases-square.scad in eight groups', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    // Counted as fieldsets rather than by role: the shape picker and the two
    // disclosures are groups too, and the claim here is about the eight
    // `/* [Group] */` headings the export reports.
    expect(document.querySelectorAll('fieldset')).toHaveLength(8)
    for (const name of ['x', 'y', 'HEIGHT', 'SQUARE_BASIS', 'LOCK', 'TOPLESS', 'SUPPORTS', 'MAGNETS', 'MAGNET_HOLE', 'ELECTRONICS', 'PRIORITY', 'NOTCH', 'NOTCH_X', 'NOTCH_Y', 'CENTER']) {
      expect(screen.getByLabelText(name), `${name} must have a control`).toBeTruthy()
    }
  })

  it('renders a two-value string enum as a checkbox, not a dropdown', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    const topless = screen.getByLabelText('TOPLESS')
    expect(topless.getAttribute('type')).toBe('checkbox')
    // The archived tuple this opens on has TOPLESS="false", the string.
    expect((topless as HTMLInputElement).checked).toBe(false)
  })

  it('can select the default OpenSCAD injected into the CENTER enum', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    const center: HTMLSelectElement = screen.getByLabelText('CENTER')
    expect([...center.options].map((option) => option.value)).toEqual(['none', 'grid', 'cube', 'false'])
    expect(center.value).toBe('none')
  })

  it('offers all four SQUARE_BASIS values and notes what the archive holds', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    const basis: HTMLSelectElement = screen.getByLabelText('SQUARE_BASIS')
    expect([...basis.options].map((option) => option.value)).toEqual(['25mm', 'inch', 'wyloch', 'drc'])
    fireEvent.change(basis, { target: { value: 'wyloch' } })
    expect(screen.getByText(/All 1,963 are the inch grid/)).toBeTruthy()
    expect(screen.getByText(/will not tile/)).toBeTruthy()
  })

  it('preflights the geometry’s own refusal instead of rendering', async () => {
    const engine = stubEngine()
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={engine.options} />)
    fireEvent.change(screen.getByLabelText('SQUARE_BASIS'), { target: { value: 'wyloch' } })
    fireEvent.change(screen.getByLabelText('LOCK'), { target: { value: 'dragonlock' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(screen.getByRole('alert').textContent).toContain(
      'ERROR: dragonlock is only compatible with inch basis',
    )
    expect(engine.renders).toBe(0)
  })

  it('says textured bases are not parametric', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    expect(screen.getByText(/hand sculpts with no OpenSCAD path/)).toBeTruthy()
  })

  it('changes shape and takes that shape’s opening state with it', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    fireEvent.click(screen.getByRole('button', { name: 'Riser' }))
    expect(screen.getByLabelText('z')).toBeTruthy()
    // `risers_square.scad` exports six parameters, not the fifteen it assigns.
    expect(screen.queryByLabelText('MAGNETS')).toBe(null)
  })
})

describe('closing', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={onClose} preview={stubEngine().options} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders no placement action until row S5 passes one', () => {
    render(<GeneratorDrawer records={RECORDS} assets={ASSETS} onClose={() => undefined} preview={stubEngine().options} />)
    expect(screen.queryByRole('button', { name: /place in build/i })).toBe(null)
  })
})

// @vitest-environment jsdom
/**
 * The backup panel — the app's only route in and out of `localStorage`.
 *
 * Relocated by row **A0** with the component, from `screens/library/
 * library.test.tsx`'s "export and import" block. What is asserted is unchanged in
 * substance and narrower in setup: these tests used to mount the whole library
 * route to reach two controls at the foot of it, and the panel takes no props and
 * needs no catalog index, so they now render it alone.
 *
 * Four outcomes, and the reason each is here rather than left to
 * `store/transfer.ts`'s own tests: this is the only place the *user-visible*
 * half is checked — that the export reaches a real `Blob`, that a refusal says
 * what was wrong and that nothing changed, and that a salvaged import names every
 * entry it dropped rather than quietly returning a room one tile short.
 *
 * One assertion the block lost with the library: the `salvageLibrary` messages.
 * They belong to a field row A1 deleted, and `store/migrations.test.ts` is where
 * the salvage rules are proved. The placement salvage is the one that survives
 * and is kept, and row **A8** re-aimed it one version forward: it used to import
 * a **file** id where a design belonged (versions 1–4's `tileId`), and it now
 * imports a version 5 placement — one `design` on a cell — which is the shape
 * every room saved before row A1 holds. `migrations.ts#salvageTemplate`
 * recognises it by *field name*, because a `DesignId` parses as a `TemplateId`
 * and no value-shaped check could tell the two apart.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  STORE_VERSION,
  clearPersistedWorkshopState,
  placeTemplate,
  resetWorkshop,
  useWorkshopStore,
} from '@/store'
import { A_TEMPLATE, A_TILE, aTemplateInstance } from '@/store/fixture'

import { BackupPanel } from './BackupPanel'

/** An item id, which is what a version 5 placement held where a template belongs. */
const LEGACY_DESIGN = 'd0000000000a'

beforeEach(() => {
  clearPersistedWorkshopState()
  resetWorkshop()
})

afterEach(() => {
  clearPersistedWorkshopState()
  resetWorkshop()
})

/**
 * Capture what `saveJsonFile` hands the browser.
 *
 * jsdom implements neither `createObjectURL` nor `revokeObjectURL`, so without
 * this the export throws — and the blob is the only observable the export has,
 * since the anchor removes itself.
 */
function stubObjectUrls(): { blobs: Blob[] } {
  const blobs: Blob[] = []
  Object.defineProperty(URL, 'createObjectURL', {
    value: (blob: Blob) => {
      blobs.push(blob)
      return `#exported-${String(blobs.length)}`
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true, writable: true })
  return { blobs }
}

/** The panel's own outcome message, scoped to its region. */
function report(): HTMLElement {
  return within(screen.getByRole('region', { name: 'Backup' })).getByRole('status')
}

function failure(): HTMLElement {
  return within(screen.getByRole('region', { name: 'Backup' })).getByRole('alert')
}

/** Fire a file at the import control and let its async handler settle. */
async function importFile(contents: string, name = 'workshop.json'): Promise<void> {
  const input = screen.getByLabelText('Import JSON', { selector: 'input' })
  const file = new File([contents], name, { type: 'application/json' })
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
    await Promise.resolve()
  })
}

describe('export and import', () => {
  it('round-trips a scene through a file', async () => {
    const urls = stubObjectUrls()
    let first = ''
    act(() => {
      first = placeTemplate(aTemplateInstance({ x: 1.5, z: -2, rotation: 90 }))
      placeTemplate(aTemplateInstance({ x: 0, z: 0, rotation: 0 }))
    })
    render(<BackupPanel />)

    act(() => {
      screen.getByRole('button', { name: 'Export JSON' }).click()
    })
    expect(urls.blobs).toHaveLength(1)
    const exported = await (urls.blobs[0] as Blob).text()

    // Everything gone, as an eviction would leave it.
    act(() => {
      resetWorkshop()
    })
    expect(useWorkshopStore.getState().placements).toEqual({})

    await importFile(exported)

    await waitFor(() => {
      expect(Object.values(useWorkshopStore.getState().placements)).toHaveLength(2)
    })
    // The whole instance, `id` and fill map included: the round trip is only
    // worth anything if what comes back is what a `placeTemplate` produced, and
    // a fill is the one part of it a lossy export would silently flatten.
    expect(Object.values(useWorkshopStore.getState().placements)).toContainEqual({
      id: first,
      template: A_TEMPLATE,
      x: 1.5,
      z: -2,
      rotation: 90,
      fills: { column: { tile: A_TILE, pinned: false } },
      // Round-trips like every other field, which is the claim this test makes.
      filters: [],
    })
    expect(report()).toHaveTextContent('Imported 2 placements.')
  })

  it('reports a file that is not ours, and changes nothing', async () => {
    act(() => {
      placeTemplate(aTemplateInstance())
    })
    render(<BackupPanel />)

    await importFile(JSON.stringify({ kind: 'some-other-app/scene', state: {} }))

    expect(failure()).toHaveTextContent(
      'That file is not an OpenForge Workshop export. Nothing was changed.',
    )
    expect(Object.values(useWorkshopStore.getState().placements)).toHaveLength(1)
  })

  it('reports a file that is not JSON at all, rather than throwing', async () => {
    act(() => {
      placeTemplate(aTemplateInstance())
    })
    render(<BackupPanel />)

    await importFile('<html>this is not a workshop</html>')

    expect(failure()).toHaveTextContent('That file is not valid JSON.')
    expect(Object.values(useWorkshopStore.getState().placements)).toHaveLength(1)
  })

  it('names what it discarded from a partly damaged file', async () => {
    render(<BackupPanel />)

    await importFile(
      JSON.stringify({
        kind: 'openforge-workshop/scene',
        // The current stamp. `importWorkshop` refuses a mismatch outright, so a
        // stale number here would test the version gate and not the salvage.
        version: STORE_VERSION,
        state: {
          placements: {
            '2f8d1e0a-0000-4000-8000-000000000000': {
              template: A_TEMPLATE,
              x: 2,
              z: 0,
              rotation: 0,
              fills: { floor: { tile: A_TILE, pinned: true } },
            },
            // Row A1's case: one **item** on a cell, which is what every
            // placement written before it held. Named and dropped rather than
            // kept as a piece of the room that draws nothing and cannot be
            // removed — a design says nothing about which recipe the user meant,
            // so there is no repair, only a report.
            '2f8d1e0a-1111-4111-8111-111111111111': {
              design: LEGACY_DESIGN,
              x: 0,
              z: 0,
              rotation: 0,
            },
          },
          generated: {},
          lock: 'openlock',
          lockChosen: false,
        },
      }),
    )

    expect(report()).toHaveTextContent('Imported 1 placement.')
    expect(report()).toHaveTextContent('1 entry could not be read')
    expect(report()).toHaveTextContent(
      'placements.2f8d1e0a-1111-4111-8111-111111111111: names an item in the old design field — a ' +
        'placement holds a template now',
    )
    // The readable entry survived, and no phantom placement came with it.
    expect(Object.values(useWorkshopStore.getState().placements)).toEqual([
      {
        id: '2f8d1e0a-0000-4000-8000-000000000000',
        template: A_TEMPLATE,
        x: 2,
        z: 0,
        rotation: 0,
        fills: { floor: { tile: A_TILE, pinned: true } },
        // Defaulted by the salvager: a file written without a position holds an
        // instance that narrows nothing, which is what `[]` means.
        filters: [],
      },
    ])
  })

  it('offers import on an empty room, which is when it matters most', () => {
    render(<BackupPanel />)

    expect(screen.getByLabelText('Import JSON', { selector: 'input' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeInTheDocument()
  })
})

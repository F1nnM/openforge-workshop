// @vitest-environment jsdom
/**
 * The panel: the refusal, the offer, and the fact that nothing loads unasked.
 *
 * `./Viewer` is mocked, and the mock is the point rather than a convenience. The
 * real module pulls three.js, r3f, drei, `postprocessing` and n8ao, and jsdom has
 * no WebGL context for them to create — but the interesting assertion is not
 * "does the canvas render", it is **"is the 3D stack behind a boundary at all"**.
 * A stub standing in for the whole chunk proves the boundary exists and is
 * crossed on the click and not before. What the canvas actually looks like is
 * verified in a browser, which is the only place it can be.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { STL_GATE_BYTES } from './gate'
import { Tile3DPanel } from './Tile3DPanel'

vi.mock('./Viewer', () => ({
  default: ({ record }: { record: { name: string } }) => (
    <div data-testid="viewer">viewer for {record.name}</div>
  ),
}))

const ASSETS = { models: 'https://objects.openforge.tools/models' }

function recordOf(bytes: number) {
  return {
    blob: 'b'.repeat(32),
    bytes,
    file: '4x1.openforge.stl',
    name: 'Dungeon stone floor 4×1',
  } as never
}

describe('when the gate refuses', () => {
  it('offers no control at all, and says why in the tile’s own numbers', () => {
    render(<Tile3DPanel record={recordOf(32_891_184)} tags={[]} assets={ASSETS} />)

    expect(screen.queryByRole('button')).toBe(null)
    expect(screen.getByText(/32\.9 MB/)).toBeInTheDocument()
    expect(screen.getByText(/pre-rendered angles/)).toBeInTheDocument()
  })

  it('points at the sprite fallback rather than at an error', () => {
    render(<Tile3DPanel record={recordOf(108_912_184)} tags={[]} assets={ASSETS} />)

    const refusal = screen.getByText(/108\.9 MB/)
    expect(refusal).toBeInTheDocument()
    expect(refusal.textContent).not.toMatch(/error|failed|sorry/i)
  })

  it('refuses a record the index has no size for', () => {
    render(<Tile3DPanel record={recordOf(0)} tags={[]} assets={ASSETS} />)
    expect(screen.getByText(/no file size/)).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBe(null)
  })

  it('refuses under a tightened limit, which is how the harness forces the path', () => {
    render(
      <Tile3DPanel record={recordOf(10_364_884)} tags={[]} assets={ASSETS} limit={1_000_000} />,
    )
    expect(screen.queryByRole('button')).toBe(null)
  })
})

describe('when the gate passes', () => {
  it('offers the view, with the download size in the label', () => {
    render(<Tile3DPanel record={recordOf(10_364_884)} tags={[]} assets={ASSETS} />)

    const button = screen.getByRole('button', { name: /View in 3D/ })
    expect(button).toBeInTheDocument()
    expect(button.textContent).toContain('10.4 MB')
  })

  it('mounts nothing until the button is pressed', () => {
    render(<Tile3DPanel record={recordOf(10_364_884)} tags={[]} assets={ASSETS} />)
    expect(screen.queryByTestId('viewer')).toBe(null)
  })

  it('crosses the lazy boundary on the press, and reports it', async () => {
    const onOpenChange = vi.fn()
    render(
      <Tile3DPanel
        record={recordOf(10_364_884)}
        tags={['texture|dungeon_stone']}
        assets={ASSETS}
        onOpenChange={onOpenChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /View in 3D/ }))

    expect(await screen.findByTestId('viewer')).toBeInTheDocument()
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('unmounts the whole subtree again on hide', async () => {
    render(<Tile3DPanel record={recordOf(10_364_884)} tags={[]} assets={ASSETS} />)

    fireEvent.click(screen.getByRole('button', { name: /View in 3D/ }))
    await screen.findByTestId('viewer')
    fireEvent.click(screen.getByRole('button', { name: /Hide 3D view/ }))

    expect(screen.queryByTestId('viewer')).toBe(null)
    expect(screen.getByRole('button', { name: /View in 3D/ })).toBeInTheDocument()
  })

  it('offers the view exactly at the limit', () => {
    render(<Tile3DPanel record={recordOf(STL_GATE_BYTES)} tags={[]} assets={ASSETS} />)
    expect(screen.getByRole('button', { name: /View in 3D/ })).toBeInTheDocument()
  })
})

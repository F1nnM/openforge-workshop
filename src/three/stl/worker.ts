/**
 * The parse worker. Vite bundles this as its own chunk from the `new Worker(new
 * URL(...))` in `client.ts`.
 *
 * It imports `parse.ts` and `protocol.ts` and nothing else — no three, no React,
 * no `@/catalog`. That keeps the worker chunk a couple of kilobytes and, more to
 * the point, keeps the *only* thing that ever crosses back to the main thread a
 * `Float32Array` of positions. The source bytes are transferred in, consumed
 * here, and never handed back: there is no reply shape that could deliver
 * printable STL bytes to a caller. §10's obligation 3 is about not letting a
 * preview mesh reach a printer, and this boundary is the reason this viewer
 * cannot become a second download path even by accident.
 */
import { parseStl } from './parse'
import type { ParseRequest } from './protocol'
import { failedResponse, parsedResponse } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
  if (request.type !== 'parse') return

  try {
    const started = performance.now()
    const parsed = parseStl(new Uint8Array(request.bytes))
    const { message, transfer } = parsedResponse(parsed, performance.now() - started)
    scope.postMessage(message, transfer as Transferable[])
  } catch (error) {
    const { message } = failedResponse(error)
    scope.postMessage(message, [])
  }
}

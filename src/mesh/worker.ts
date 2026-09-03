/**
 * The conversion worker. Vite bundles this as its own chunk from the
 * `new Worker(new URL(...))` in `spawn.ts`.
 *
 * It imports `convert.ts` — which reaches `@/three/stl/parse`, `./weld` and
 * `meshoptimizer/simplifier` — and nothing else. No three, no React, no r3f. Two
 * consequences, both of them the point:
 *
 *   - **The main thread never sees an STL.** The corpus's median mesh is 10.77 MB
 *     and 215,314 facets; parsing it costs 5–20 ms and welding it another 3–76 ms
 *     (measured on the starter set), but *simplifying* it costs 18–305 ms, which
 *     is five to eighteen dropped frames on the thread that owns the library
 *     screen's scroll. The bytes are transferred in, consumed here, and never
 *     handed back.
 *   - **This cannot become a download path.** §10's obligation 3 is about a
 *     decimated preview reaching somebody's printer, and `src/three/stl/worker.ts`
 *     makes the same argument: there is no reply shape here that could deliver
 *     printable STL bytes to a caller. What leaves is a welded, decimated,
 *     indexed mesh with the facet normals and the 80-byte header gone — a
 *     5,000-triangle version of a 485,262-triangle file. It is not a mesh
 *     anything would print, and the request buffer is detached the moment it
 *     arrives.
 */
import { convertStl } from './convert'
import type { ConvertRequest } from './protocol'
import { convertFailedResponse, convertedResponse, narrowIndices } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
  if (request.type !== 'convert') return

  void (async () => {
    const started = performance.now()
    try {
      const mesh = await convertStl(new Uint8Array(request.bytes))
      const { message, transfer } = convertedResponse(
        request.blob,
        { ...mesh, indices: narrowIndices(mesh.indices, mesh.vertices) },
        performance.now() - started,
      )
      scope.postMessage(message, transfer as Transferable[])
    } catch (error) {
      const { message } = convertFailedResponse(request.blob, error)
      scope.postMessage(message, [])
    }
  })()
}

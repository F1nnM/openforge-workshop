import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // drei pulls a nested three via stats-gl; two copies break raycasting silently.
    dedupe: ['three'],
  },
  // The OpenSCAD worker is spawned as `{ type: 'module' }` and imports the
  // Emscripten glue, which is an ES module, plus 35 `.scad` sources through
  // `import.meta.glob`. Vite's default worker format for a build is `iife`,
  // which cannot express either — so the worker chunk has to be ES too.
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    // `vendor/openscad-wasm/openscad.wasm` is 10.5 MB and is imported as `?url`,
    // so it is emitted as a hashed asset and fetched by the worker rather than
    // bundled. Pinning the inline threshold makes that structural instead of
    // incidental: raising it past 10 MB in some future tuning pass would
    // base64-inline the engine into a chunk, and nothing would report an error —
    // the app would simply start shipping ten megabytes to every visitor.
    assetsInlineLimit: 4096,
  },
})

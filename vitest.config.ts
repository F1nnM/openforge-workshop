import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    // Node by default: the facet engine, importer, assembly resolver and share
    // codec are all headless. Component tests opt in per file with a docblock:
    //   // @vitest-environment jsdom
    environment: 'node',
    // Only loaded for suites that opt into jsdom; a node-environment suite
    // importing @testing-library would fail on a missing document.
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'pipeline/**/*.test.ts', 'tools/**/*.test.ts'],
  },
})

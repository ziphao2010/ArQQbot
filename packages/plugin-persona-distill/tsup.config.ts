import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  outDir: 'dist',
  bundle: true,
  noExternal: ['@arqqbot/persona-core'],
  external: ['cordis']
})

import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/worker-entry.ts'],
  format: ['cjs'],
  platform: 'node',
  outDir: 'dist',
  bundle: true,
  noExternal: ['@arqqbot/adapter-qq', '@arqqbot/shared', 'cordis', 'ws'],
  external: ['electron', 'bufferutil', 'utf-8-validate']
})

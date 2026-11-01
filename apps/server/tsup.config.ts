import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  bundle: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@arqqbot/shared', '@arqqbot/control']
})

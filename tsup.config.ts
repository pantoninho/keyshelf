import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'bin/keyshelf.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  dts: { entry: 'src/index.ts' },
});

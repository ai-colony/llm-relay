import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  treeshake: true,
  minify: true,
  noExternal: [/.*/],
  // CJS packages bundled into ESM need a require() shim
  banner: { js: `import{createRequire}from'node:module';const require=createRequire(import.meta.url);` },
  onSuccess: async () => {
    // esbuild strips node: prefix from built-in imports; restore it for node:sqlite
    const { readFileSync, writeFileSync } = await import('node:fs');
    const file = 'dist/index.js';
    const patched = readFileSync(file, 'utf8').replaceAll("from'sqlite'", "from'node:sqlite'");
    writeFileSync(file, patched);
  }
});

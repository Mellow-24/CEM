import { defineConfig } from 'tsdown'

/** Build the function plugin, invariant companion, and published operator bin as independent bundles. */
export default defineConfig([
  {
    entry: ['lib/types/index.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/invariant.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
  {
    entry: ['lib/types/bin.js'], outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  },
])

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'style',
    },
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        assetFileNames: '[name][extname]',
      },
    },
  },
}));

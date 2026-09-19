import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/reader.ts'),
      name: 'LorepackReader',
      fileName: (format) => `lorepack-reader.${format}.js`,
      formats: ['es', 'umd'],
    },
    outDir: 'dist/reader',
    emptyOutDir: true,
  },
});

import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'src',              // Serve from src/
  build: {
    outDir: '../dist',      // Output to client/dist/
    emptyOutDir: true,
  },
  envDir: '../',           // Look for .env in client/ (parent of src/)
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@services': path.resolve(__dirname, 'src/services'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@types': path.resolve(__dirname, 'src/types'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@managers': path.resolve(__dirname, 'src/managers')
    }
  }
});

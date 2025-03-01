import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',              // Serve from src/
  build: {
    outDir: '../dist',      // Output to client/dist/
    emptyOutDir: true,
  },
  envDir: '../',           // Look for .env in client/ (parent of src/)
});

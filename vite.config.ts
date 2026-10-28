import { defineConfig } from 'vite';

// Static build for GitHub Pages: relative base so it works under /<repo>/.
export default defineConfig({
  base: './',
  server: { port: 5180, strictPort: true, host: true },
  preview: { port: 4190, strictPort: true, host: true },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: { manualChunks: (id: string) => (id.includes('node_modules/three/') ? 'three' : undefined) },
    },
  },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);

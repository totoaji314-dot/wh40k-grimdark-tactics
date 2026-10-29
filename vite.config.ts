import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Local-only reference assets (e.g. models converted from a game the user owns) are served by the dev
 * server from a folder OUTSIDE the repository. They are not in public/, so `vite build` and GitHub Pages
 * never contain them. Folder: env LOCAL_ASSETS or ../SpaceMarine1_Extracted/_game_assets
 */
function localAssets(): Plugin {
  const root = path.resolve(process.env.LOCAL_ASSETS ?? '../SpaceMarine1_Extracted/_game_assets');
  const types: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.webp': 'image/webp' };
  return {
    name: 'local-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/local-assets/', (req, res, next) => {
        const p = path.join(root, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return next();
        res.setHeader('content-type', types[path.extname(p)] ?? 'application/octet-stream');
        res.setHeader('cache-control', 'no-store');
        fs.createReadStream(p).pipe(res);
      });
    },
  };
}

// Static build for GitHub Pages: relative base so it works under /<repo>/.
export default defineConfig({
  base: './',
  plugins: [localAssets()],
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

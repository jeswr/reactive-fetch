import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Serve `*.jsonld` files from `public/` with `Content-Type: application/ld+json`.
 * Vite's default static middleware uses the extension-derived MIME, which for
 * `.jsonld` is `application/octet-stream` — Solid-OIDC clients and CSS both
 * require the JSON-LD content type on a Client ID Document.
 */
function jsonLdContentType(): Plugin {
  return {
    name: 'reactive-fetch-example:jsonld-content-type',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0]!.endsWith('.jsonld')) {
          res.setHeader('Content-Type', 'application/ld+json');
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.split('?')[0]!.endsWith('.jsonld')) {
          res.setHeader('Content-Type', 'application/ld+json');
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // In CI (GitHub Pages) the app is served under a sub-path like
  // `/reactive-fetch/react/`. Dev and preview default to `/` so local
  // tooling (pnpm dev:testbed, e2e harness) keeps working unchanged.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), jsonLdContentType()],
  // `@uvdsl/solid-oidc-client-browser` spawns a refresh worker via
  // `new URL('./RefreshWorker.js', import.meta.url)`. Vite's dep optimizer
  // pre-bundles the library into `node_modules/.vite/deps/`, which rewrites
  // `import.meta.url` to a path in that directory — but the optimizer does
  // not pull `RefreshWorker.js` in, so the Worker URL 404s and
  // `session.restore()` hangs forever. Excluding the library from
  // pre-bundling keeps `import.meta.url` pointing at the real package, so
  // the sibling worker file loads correctly.
  optimizeDeps: {
    exclude: ['@uvdsl/solid-oidc-client-browser'],
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        callback: resolve(__dirname, 'callback.html'),
      },
    },
  },
});

import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serve `*.jsonld` files from `public/` with `Content-Type: application/ld+json`.
 * Vite's default static middleware uses the extension-derived MIME, which for
 * `.jsonld` defaults to `application/octet-stream` — and Solid OIDC clients /
 * CSS both need the JSON-LD content type to fetch a Client ID Document.
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
  plugins: [jsonLdContentType()],
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 5173,
    strictPort: true,
  },
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
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        callback: resolve(__dirname, 'callback.html'),
      },
    },
  },
});

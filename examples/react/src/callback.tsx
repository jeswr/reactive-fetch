import { mountCallback } from '@jeswr/solid-reactive-fetch/callback';

const APP_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;
const CLIENT_ID = `${APP_URL}solid-client.jsonld`;

// Must match the `allowLocalhost` value passed to createReactiveFetch in
// main.tsx — the issuer filter that enforces HTTPS runs here, inside the
// popup, not in the parent app.
function run(): void {
  void mountCallback({
    clientId: CLIENT_ID,
    allowLocalhost: import.meta.env.DEV,
  }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    document.body.innerHTML = `<p style="color: #b00020">Login failed: ${message}</p>`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run, { once: true });
} else {
  run();
}

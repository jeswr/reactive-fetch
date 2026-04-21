import { mountCallback } from '@jeswr/solid-reactive-fetch/callback';

const CLIENT_ID = 'http://localhost:5174/solid-client.jsonld';

function run(): void {
  void mountCallback({ clientId: CLIENT_ID }).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    document.body.innerHTML = `<p style="color: #b00020">Login failed: ${message}</p>`;
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run, { once: true });
} else {
  run();
}

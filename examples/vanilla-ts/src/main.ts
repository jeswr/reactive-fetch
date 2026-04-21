import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

// Derive URLs from the page's own origin + Vite base path so the same bundle
// works on localhost:5173 (dev) and jeswr.github.io/reactive-fetch/vanilla-ts/
// (GitHub Pages). `import.meta.env.BASE_URL` always ends with `/`.
const APP_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;
const CLIENT_ID = `${APP_URL}solid-client.jsonld`;
const CALLBACK_URL = `${APP_URL}callback.html`;

const PRIVATE_RESOURCE_URL = 'http://localhost:3000/alice/private.txt';

// `allowLocalhost` opts the issuer filter into accepting http://localhost /
// 127.0.0.1 / [::1] so local dev can run against a non-TLS CSS instance.
// Off in production builds (GitHub Pages), where a malicious WebID profile
// could otherwise redirect the popup at whatever happens to be listening on
// a loopback port.
const rf = createReactiveFetch({
  clientId: CLIENT_ID,
  callbackUrl: CALLBACK_URL,
  allowLocalhost: import.meta.env.DEV,
});

const statusEl = document.getElementById('status') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLPreElement;
const webIdDisplayEl = document.getElementById('webid-display') as HTMLElement;
const showWebIdBtn = document.getElementById('show-webid') as HTMLButtonElement;
const fetchPrivateBtn = document.getElementById('fetch-private') as HTMLButtonElement;

type StatusKind = 'idle' | 'loading' | 'ok' | 'error';

function setStatus(text: string, kind: StatusKind): void {
  statusEl.textContent = text;
  statusEl.dataset.status = kind;
}

function setOutput(text: string): void {
  outputEl.textContent = text;
}

function setWebId(webId: string): void {
  webIdDisplayEl.textContent = webId;
}

async function withButtons<T>(fn: () => Promise<T>): Promise<T | undefined> {
  showWebIdBtn.disabled = true;
  fetchPrivateBtn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(message, 'error');
    return undefined;
  } finally {
    showWebIdBtn.disabled = false;
    fetchPrivateBtn.disabled = false;
  }
}

showWebIdBtn.addEventListener('click', () => {
  void withButtons(async () => {
    setStatus('Resolving WebID…', 'loading');
    const webId = await rf.webId;
    setWebId(webId);
    setStatus('Signed in.', 'ok');
  });
});

fetchPrivateBtn.addEventListener('click', () => {
  void withButtons(async () => {
    setStatus(`Fetching ${PRIVATE_RESOURCE_URL}…`, 'loading');
    const response = await rf.fetch(PRIVATE_RESOURCE_URL);
    const body = await response.text();
    setStatus(
      `${response.status} ${response.statusText} — ${PRIVATE_RESOURCE_URL}`,
      response.ok ? 'ok' : 'error',
    );
    setOutput(body || '(empty body)');

    // The reactive fetch logs the user in by the time we reach this point
    // (a 401 on a private resource triggers the popup), so reflect the
    // signed-in WebID once it's available — no extra round-trip.
    try {
      const webId = await rf.webId;
      setWebId(webId);
    } catch {
      /* leave the display untouched if webId resolution failed */
    }
  });
});

// Hydration marker: the app has wired its listeners and createReactiveFetch
// has been invoked, so harnesses can gate on a deterministic DOM signal
// (`[data-testid="ready"]`) instead of timers.
document.body.dataset.testid = 'ready';
document.body.dataset.rfReady = 'true';

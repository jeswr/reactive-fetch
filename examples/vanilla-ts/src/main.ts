import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const CLIENT_ID = 'http://localhost:5173/solid-client.jsonld';
const CALLBACK_URL = 'http://localhost:5173/callback.html';

const PRIVATE_RESOURCE_URL = 'http://localhost:3000/alice/private.txt';

const rf = createReactiveFetch({ clientId: CLIENT_ID, callbackUrl: CALLBACK_URL });

const statusEl = document.getElementById('status') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLPreElement;
const webIdDisplayEl = document.getElementById('webid-display') as HTMLElement;
const showWebIdBtn = document.getElementById('show-webid') as HTMLButtonElement;
const fetchPrivateBtn = document.getElementById('fetch-private') as HTMLButtonElement;

function setStatus(text: string, kind: 'ok' | 'error' = 'ok'): void {
  statusEl.textContent = text;
  if (kind === 'error') {
    statusEl.dataset.status = 'error';
  } else {
    delete statusEl.dataset.status;
  }
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
    setOutput(message);
    return undefined;
  } finally {
    showWebIdBtn.disabled = false;
    fetchPrivateBtn.disabled = false;
  }
}

showWebIdBtn.addEventListener('click', () => {
  void withButtons(async () => {
    setStatus('Resolving WebID…');
    const webId = await rf.webId;
    setWebId(webId);
    setStatus('Signed in.');
    setOutput(webId);
  });
});

fetchPrivateBtn.addEventListener('click', () => {
  void withButtons(async () => {
    setStatus(`Fetching ${PRIVATE_RESOURCE_URL}…`);
    const response = await rf.fetch(PRIVATE_RESOURCE_URL);
    const body = await response.text();
    setStatus(`${response.status} ${response.statusText} — ${PRIVATE_RESOURCE_URL}`);
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

// Hydration marker: signals to Playwright (and any harness) that the app has
// wired up its event listeners and createReactiveFetch has been invoked,
// so tests can wait on a deterministic DOM flag instead of timers.
document.body.dataset.rfReady = 'true';

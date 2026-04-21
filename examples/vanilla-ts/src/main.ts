import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const CLIENT_ID = 'http://localhost:5173/solid-client.jsonld';
const CALLBACK_URL = 'http://localhost:5173/callback.html';

const rf = createReactiveFetch({ clientId: CLIENT_ID, callbackUrl: CALLBACK_URL });

const statusEl = document.getElementById('status') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLPreElement;
const showWebIdBtn = document.getElementById('show-webid') as HTMLButtonElement;
const fetchPrivateBtn = document.getElementById('fetch-private') as HTMLButtonElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setOutput(text: string): void {
  outputEl.textContent = text;
}

async function withButtons<T>(fn: () => Promise<T>): Promise<T | undefined> {
  showWebIdBtn.disabled = true;
  fetchPrivateBtn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Error: ${message}`);
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
    setStatus('Signed in.');
    setOutput(webId);
  });
});

fetchPrivateBtn.addEventListener('click', () => {
  void withButtons(async () => {
    const webId = await rf.webId;
    const podRoot = deriveStorageRoot(webId);
    const target = `${podRoot}private/`;
    setStatus(`Fetching ${target}…`);
    const response = await rf.fetch(target, {
      headers: { Accept: 'text/turtle' },
    });
    const body = await response.text();
    setStatus(`${response.status} ${response.statusText} — ${target}`);
    setOutput(body || '(empty body)');
  });
});

function deriveStorageRoot(webId: string): string {
  const url = new URL(webId);
  const segments = url.pathname.split('/').filter(Boolean);
  const podName = segments[0] ?? '';
  url.hash = '';
  url.search = '';
  url.pathname = podName ? `/${podName}/` : '/';
  return url.toString();
}

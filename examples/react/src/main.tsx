import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { ReactiveFetchProvider } from '@jeswr/solid-reactive-fetch-react';
import { App } from './App.js';

// Derive URLs from the page's own origin + Vite base path so the same bundle
// works on localhost:5174 (dev) and jeswr.github.io/reactive-fetch/react/
// (GitHub Pages). `import.meta.env.BASE_URL` always ends with `/`.
const APP_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;
const CLIENT_ID = `${APP_URL}solid-client.jsonld`;
const CALLBACK_URL = `${APP_URL}callback.html`;

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

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

createRoot(container).render(
  <StrictMode>
    <ReactiveFetchProvider value={rf}>
      <App />
    </ReactiveFetchProvider>
  </StrictMode>,
);

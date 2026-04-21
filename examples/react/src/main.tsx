import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { ReactiveFetchProvider } from '@jeswr/solid-reactive-fetch-react';
import { App } from './App.js';

const CLIENT_ID = 'http://localhost:5174/solid-client.jsonld';
const CALLBACK_URL = 'http://localhost:5174/callback.html';

const rf = createReactiveFetch({ clientId: CLIENT_ID, callbackUrl: CALLBACK_URL });

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing in index.html');

createRoot(container).render(
  <StrictMode>
    <ReactiveFetchProvider value={rf}>
      <App />
    </ReactiveFetchProvider>
  </StrictMode>,
);

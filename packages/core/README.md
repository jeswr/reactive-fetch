# @jeswr/solid-reactive-fetch

Reactive authenticated `fetch` for Solid applications. Authentication is triggered automatically — no explicit `login()` or `logout()`.

```ts
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
});

// Reading webId triggers the login popup if no session is active.
const webId = await rf.webId;

// Fetching a private resource: tries unauthenticated first, retries with DPoP-bound auth on 401.
const res = await rf.fetch('https://pod.example/private-resource');
```

Status: **under construction**. See the repo root for design notes.

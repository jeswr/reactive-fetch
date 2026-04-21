# @jeswr/solid-reactive-fetch-react

[![CI](https://img.shields.io/github/actions/workflow/status/jeswr/reactive-fetch/ci.yml?branch=main)](https://github.com/jeswr/reactive-fetch/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch-react)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch-react)
[![npm downloads](https://img.shields.io/npm/dw/@jeswr/solid-reactive-fetch-react)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch-react)

> [!WARNING]
> **This package has NOT been independently security reviewed.** It is published for **testing and evaluation purposes only** and should not be used to protect production user data. The public API, storage format, and security guarantees may change without notice. Use at your own risk.

React hooks layered on top of [`@jeswr/solid-reactive-fetch`](../core).

**Live demo**: <https://jeswr.github.io/reactive-fetch/react/>

```tsx
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { ReactiveFetchProvider, useWebId, useSolidFetch } from '@jeswr/solid-reactive-fetch-react';
import { Suspense } from 'react';

const rf = createReactiveFetch({ clientId, callbackUrl });

function App() {
  return (
    <ReactiveFetchProvider value={rf}>
      <Suspense fallback={<span>Signing in…</span>}>
        <WebIdBadge />
      </Suspense>
      <PrivateResource />
    </ReactiveFetchProvider>
  );
}

function WebIdBadge() {
  const webId = useWebId(); // Suspends until login completes
  return <span>{webId}</span>;
}

function PrivateResource() {
  const fetch = useSolidFetch();
  const onClick = async () => {
    const res = await fetch('https://pod.example/private');
    console.log(await res.text());
  };
  return <button onClick={onClick}>Fetch</button>;
}
```

The provider value is a `ReactiveFetch` instance from `@jeswr/solid-reactive-fetch`. `useWebId` throws the pending Promise (Suspense semantics) and re-renders with the WebID once login resolves. Concurrent consumers share one login attempt via an internal `WeakMap` keyed by the `ReactiveFetch` instance.

SSR-safe: the hook suspends on the server pass so a server-rendered `<Suspense fallback={...}>` renders the fallback. `createReactiveFetch()` itself must still be called in a client-only code path (see the core package's SSR section).

# @jeswr/solid-reactive-fetch-driver-prompt

[![npm version](https://img.shields.io/npm/v/@jeswr/solid-reactive-fetch-driver-prompt)](https://www.npmjs.com/package/@jeswr/solid-reactive-fetch-driver-prompt)

A [`WebIdDriver`](../shared/) for [`@jeswr/solid-reactive-fetch`](../core/) that uses the OS-native `window.prompt()` to collect a WebID, instead of the popup's built-in form.

```ts
import { createReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { promptDriver } from '@jeswr/solid-reactive-fetch-driver-prompt';

const rf = createReactiveFetch({
  clientId: 'https://myapp.example/solid-client.jsonld',
  callbackUrl: 'https://myapp.example/reactive-fetch-callback',
  driver: promptDriver(),
});
```

`window.prompt()` is synchronous, so the user-gesture budget survives across the call and the subsequent popup is not blocked by browsers.

## When to use this driver

- **Kiosk apps** that forbid the extra DOM the in-popup form ships.
- **Strict CSPs** where the extra UI is a maintenance burden.
- **Accessibility tooling stacks** that prefer the OS-native dialog.
- **Tests** that want a single-line stub for the WebID-entry step.

For everything else, omit the `driver` option and use the popup's built-in form (zero-config default).

## API

```ts
function promptDriver(options?: { message?: string }): WebIdDriver;
```

- `message` — text shown in the prompt. Defaults to `'Enter your WebID URL'`.

The driver returns the user's input as a string, or `null` if they cancel. A cancel surfaces as a `WebIdPromptCancelledError` to the caller of `rf.webId` / `rf.fetch` / `rf.solid.login`.

## Writing your own driver

The driver contract is one type:

```ts
type WebIdDriver = (ctx: { allowLocalhost: boolean }) =>
  string | null | Promise<string | null>;
```

Anything that can synchronously (or close enough) acquire a WebID can be a driver — a styled modal, a saved-WebID dropdown, an Electron IPC dialog, …. See the [shared package's `WebIdDriver` documentation](../shared/src/driver.ts) for the full contract.

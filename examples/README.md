# reactive-fetch examples

Runnable demos for [`@jeswr/solid-reactive-fetch`](../packages/core). The
examples dogfood the public API — there are no login or logout buttons because
the whole point of reactive-fetch is that auth is triggered automatically.

## One-command dev testbed

From the repo root:

```sh
pnpm install
pnpm build
pnpm dev:testbed
```

That single command:

1. Starts a [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
   on `http://localhost:3000`, with its data in `./.css-data/` (git-ignored).
2. Seeds two accounts:

   | Account | WebID | Email | Password |
   |---|---|---|---|
   | alice | `http://localhost:3000/alice/profile/card#me` | `alice@example.com` | `password123` |
   | bob   | `http://localhost:3000/bob/profile/card#me`   | `bob@example.com`   | `password123` |

3. Starts the `vanilla-ts` example dev server on `http://localhost:5173`.
4. Prints the URLs + credentials, then opens the browser.
5. Tears everything down cleanly on `Ctrl+C`.

### Trying it out

1. Click **Show my WebID**.
2. A popup opens at `http://localhost:5173/callback.html` asking for a WebID.
   Paste `http://localhost:3000/alice/profile/card#me`.
3. The popup sends you to CSS, where you log in as `alice@example.com` /
   `password123` and consent to the app.
4. CSS redirects back into the popup, the popup closes, and the parent page
   shows Alice's WebID.
5. Click **Fetch private resource from my pod** to make a DPoP-authenticated
   request against Alice's private container.

Subsequent clicks reuse the session that the underlying client library
persisted in IndexedDB — no popup needed.

## Using a third-party WebID instead

You can skip the local CSS and sign in against a hosted Solid provider
(e.g. [solidcommunity.net](https://solidcommunity.net),
[inrupt.com](https://inrupt.com/)). Just run the example without the testbed:

```sh
pnpm --filter @jeswr/example-vanilla-ts dev
```

Then in the popup, paste your hosted WebID (e.g. `https://you.solidcommunity.net/profile/card#me`).
The popup will resolve the issuer from your WebID profile and redirect you
there to sign in.

> Third-party providers require your Client ID Document to be reachable over
> HTTPS. The example ships with one at `http://localhost:5173/solid-client.jsonld`,
> which works for the local CSS; for hosted IDPs you'll need to serve the
> document from a public HTTPS URL and update `CLIENT_ID` in `src/main.ts` and
> `src/callback.ts`.

## Pointing at a different CSS instance

The orchestrator reads `CSS_PORT` from the environment if you want to avoid a
port clash:

```sh
CSS_PORT=3100 pnpm dev:testbed
```

If you want to point the example app at an already-running CSS elsewhere,
skip `pnpm dev:testbed`, start the app manually, and enter whatever WebID
belongs to that server in the popup.

## Examples

- [`vanilla-ts/`](./vanilla-ts) — minimal HTML + TypeScript + Vite demo.
  Two buttons: _Show my WebID_ and _Fetch private resource_.

A React example may land later; for now the vanilla-ts demo is the
authoritative reference for how to wire the library into an app.

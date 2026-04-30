// Callback page for the prompt-flavoured factory. Compared to the
// popup-flavoured `mountCallback`, this one drops the WebID-input form and
// the cached-WebIDs list — the parent collects the WebID via
// `window.prompt()` and forwards it through the `?webId=` query parameter.
//
// Three branches (in order):
//   1. If the URL has `?code=…&state=…`, run the OIDC redirect handler,
//      postMessage completion to the opener, close the window. (Same as core.)
//   2. If the URL has `?webId=…`, validate the WebID synchronously, fetch
//      its profile, and either redirect to the IDP (single issuer) or show
//      the issuer picker (multiple). The validator rejects anything that
//      isn't `https:` (or `http:` localhost iff `allowLocalhost` is true)
//      so a hostile callback URL with `?webId=javascript:…` can't reach
//      the IDP redirect.
//   3. Otherwise render a minimal "missing WebID" error message — the
//      parent should never open the callback without `?webId=`, so this is
//      a debugging aid rather than a real user surface.

import {
  createCard,
  driveLoginFromWebId,
  ensurePopupLayout,
  ensureStylesInjected,
  readWebIdFromQueryStrict,
  runOidcRedirectIfPresent,
} from '@jeswr/solid-reactive-fetch-shared/callback';
import {
  InvalidWebIdError,
  ReactiveFetchError,
  type SharedCallbackOptions,
} from '@jeswr/solid-reactive-fetch-shared';

export interface MountCallbackOptions extends SharedCallbackOptions {
  root?: HTMLElement;
}

export async function mountCallback(options: MountCallbackOptions = {}): Promise<void> {
  if (await runOidcRedirectIfPresent(options)) return;

  const parent = options.root ?? document.body;

  let webId: string;
  try {
    webId = readWebIdFromQueryStrict(window.location.search, {
      allowLocalhost: options.allowLocalhost ?? false,
    });
  } catch (err) {
    showFatalError(parent, describeFatal(err));
    return;
  }

  await driveLoginFromWebId(options, parent, webId, {
    onLoginStart: () => { /* no UI to dispose for the prompt flavour */ },
    onError: (message) => {
      showFatalError(parent, message);
    },
    // Re-validate on cancel so the static error matches what would have
    // been shown if `?webId=` had been missing entirely.
    onIssuerPickerCancelled: () => {
      showFatalError(
        parent,
        'Sign-in cancelled. Close this window and try again.',
      );
    },
  });
}

function describeFatal(err: unknown): string {
  if (err instanceof InvalidWebIdError) {
    return `Cannot sign in: ${err.message}`;
  }
  if (err instanceof ReactiveFetchError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Unexpected error during sign-in.';
}

function showFatalError(parent: HTMLElement, message: string): void {
  ensureStylesInjected();
  ensurePopupLayout(parent);

  const card = createCard();
  const root = document.createElement('section');
  root.setAttribute('data-reactive-fetch', 'prompt-fatal');

  const heading = document.createElement('h1');
  heading.setAttribute('data-reactive-fetch', 'heading');
  heading.textContent = 'Could not sign in';

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'alert');
  status.dataset['kind'] = 'error';
  status.textContent = message;

  root.append(heading, status);
  card.append(root);
  parent.append(card);
}

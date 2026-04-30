import { InvalidWebIdError } from '@jeswr/solid-reactive-fetch-shared';
import {
  type CachedWebId,
  driveLoginFromWebId,
  forgetWebId,
  getCachedWebIds,
  readWebIdFromQueryOrNull,
  runOidcRedirectIfPresent,
  validateWebIdSyncStrict,
  type SharedCallbackOptions,
} from '@jeswr/solid-reactive-fetch-shared/callback';
import { renderCachedWebIdsList, renderPromptUi, type CachedWebIdsUi } from './ui.js';

export interface MountCallbackOptions extends SharedCallbackOptions {
  root?: HTMLElement;
  /**
   * Accept `http://localhost` / `127.0.0.1` / `[::1]` as valid OIDC issuers
   * in addition to HTTPS. Defaults to `false` — a WebID profile declaring a
   * localhost issuer is rejected with `InvalidIssuerError`, preventing a
   * hostile profile from redirecting a user's popup at a local port.
   *
   * Set to `true` only in local dev builds. This flag MUST match the
   * `allowLocalhost` passed to `createReactiveFetch` in the parent app;
   * otherwise the parent-vs-popup view of which issuers are acceptable will
   * diverge (practically harmless — the parent's flag is informational
   * today — but the two sides are meant to be kept in sync).
   */
  allowLocalhost?: boolean;
}

export async function mountCallback(options: MountCallbackOptions = {}): Promise<void> {
  if (await runOidcRedirectIfPresent(options)) return;

  // Parity with the prompt-flavoured callback: if the popup was opened with
  // a `?webId=` query (e.g. by a future iteration of `solid.login(webId)`
  // that wants to skip the prompt), short-circuit straight to discovery.
  const queryWebId = (() => {
    try {
      return readWebIdFromQueryOrNull(window.location.search, {
        allowLocalhost: options.allowLocalhost ?? false,
      });
    } catch {
      // A malformed or unsafe webId param falls through to the manual form
      // so the user can correct it. The validation error is surfaced via
      // the form's normal error handling on submit.
      return null;
    }
  })();

  if (queryWebId) {
    const parent = options.root ?? document.body;
    await driveLoginFromWebId(options, parent, queryWebId, {
      onLoginStart: () => { /* no UI to dispose */ },
      onError: (message) => {
        showWebIdForm(options, queryWebId, message);
      },
      onIssuerPickerCancelled: () => {
        const cached = getCachedWebIds();
        if (cached.length > 0) showCachedList(options, cached);
        else showWebIdForm(options, queryWebId);
      },
    });
    return;
  }

  const cached = getCachedWebIds();
  if (cached.length > 0) {
    showCachedList(options, cached);
    return;
  }

  showWebIdForm(options);
}

function showCachedList(
  options: MountCallbackOptions,
  entries: CachedWebId[],
): void {
  const parent = options.root ?? document.body;
  let ui: CachedWebIdsUi | null = null;

  ui = renderCachedWebIdsList(parent, entries, {
    onPick: (webId) => {
      ui?.setBusy(true);
      ui?.setStatus('Looking up your identity provider…');
      void driveLoginFromWebId(options, parent, webId, {
        onLoginStart: () => {
          ui?.dispose();
          ui = null;
        },
        onError: (message) => {
          // If we already disposed (issuer-picker case) the cached list is
          // gone — re-render before showing the error.
          if (ui === null) {
            showCachedList(options, getCachedWebIds());
            queueMicrotask(() => {
              // We can't reach the new ui handle from here, so embed the
              // error in a fresh form instead. Cheaper than threading the
              // status through.
              showWebIdForm(options, webId, message);
            });
            return;
          }
          ui.setBusy(false);
          ui.setStatus(message, 'error');
        },
        onIssuerPickerCancelled: () => {
          const remaining = getCachedWebIds();
          if (remaining.length > 0) showCachedList(options, remaining);
          else showWebIdForm(options, webId);
        },
      });
    },
    onForget: (webId) => {
      forgetWebId(webId);
      const remaining = getCachedWebIds();
      ui?.dispose();
      ui = null;
      if (remaining.length > 0) {
        showCachedList(options, remaining);
      } else {
        showWebIdForm(options);
      }
    },
    onUseDifferent: () => {
      ui?.dispose();
      ui = null;
      showWebIdForm(options);
    },
  });
}

function showWebIdForm(
  options: MountCallbackOptions,
  seedValue?: string,
  initialError?: string,
): void {
  const parent = options.root ?? document.body;
  const ui = renderPromptUi(parent);
  if (seedValue) ui.input.value = seedValue;
  if (initialError) ui.setStatus(initialError, 'error');

  ui.root.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = ui.input.value.trim();

    if (!raw) {
      ui.setStatus('Please enter your WebID.', 'error');
      return;
    }

    let validatedWebId: string;
    try {
      validatedWebId = validateWebIdSyncStrict(raw, {
        allowLocalhost: options.allowLocalhost ?? false,
      });
    } catch (err) {
      const message =
        err instanceof InvalidWebIdError
          ? err.message
          : 'WebID must be a valid URL.';
      ui.setStatus(message, 'error');
      return;
    }

    ui.setBusy(true);
    ui.setStatus('Looking up your identity provider…');

    await driveLoginFromWebId(options, parent, validatedWebId, {
      onLoginStart: () => { ui.dispose(); },
      onError: (message) => {
        ui.setBusy(false);
        ui.setStatus(message, 'error');
      },
      onIssuerPickerCancelled: (cancelledWebId) => {
        const remaining = getCachedWebIds();
        if (remaining.length > 0) showCachedList(options, remaining);
        else showWebIdForm(options, cancelledWebId);
      },
    });
  });
}

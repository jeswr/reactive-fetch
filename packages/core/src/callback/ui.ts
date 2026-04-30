// Core's in-popup UI: the WebID-input form and the cached-WebIDs list.
// The issuer-picker UI and base popup chrome (CSS injection, body layout,
// the card factory) live in `@jeswr/solid-reactive-fetch-shared` so the
// prompt-flavoured callback can re-use them after the `?webId=`
// short-circuit.

import {
  createCard,
  ensurePopupLayout,
  ensureStylesInjected,
  type CachedWebId,
} from '@jeswr/solid-reactive-fetch-shared/callback';

export interface PromptUi {
  root: HTMLElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  status: HTMLElement;
  setStatus(message: string, kind?: 'info' | 'error'): void;
  setBusy(busy: boolean): void;
  dispose(): void;
}

export function renderPromptUi(parent: HTMLElement): PromptUi {
  ensureStylesInjected();
  ensurePopupLayout(parent);

  const card = createCard();

  const root = document.createElement('form');
  root.setAttribute('data-reactive-fetch', 'prompt');
  root.noValidate = true;

  const heading = document.createElement('h1');
  heading.setAttribute('data-reactive-fetch', 'heading');
  heading.textContent = 'Sign in with your Solid Pod';

  const subheading = document.createElement('p');
  subheading.setAttribute('data-reactive-fetch', 'subheading');
  subheading.textContent = 'Enter your WebID and we’ll redirect you to your identity provider.';

  const field = document.createElement('div');
  field.setAttribute('data-reactive-fetch', 'field');

  const label = document.createElement('label');
  label.textContent = 'WebID';
  label.setAttribute('for', 'reactive-fetch-webid');

  const input = document.createElement('input');
  input.id = 'reactive-fetch-webid';
  input.type = 'url';
  input.name = 'webid';
  input.required = true;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'https://your.pod/profile/card#me';

  field.append(label, input);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.setAttribute('data-reactive-fetch', 'primary-button');
  submit.textContent = 'Continue';

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(heading, subheading, field, submit, status);
  card.append(root);
  parent.append(card);

  return {
    root,
    input,
    submit,
    status,
    setStatus(message, kind = 'info') {
      status.textContent = message;
      status.dataset['kind'] = kind;
    },
    setBusy(busy) {
      input.disabled = busy;
      submit.disabled = busy;
      root.dataset['busy'] = busy ? 'true' : 'false';
    },
    dispose() {
      card.remove();
    },
  };
}

export interface CachedWebIdsUi {
  root: HTMLElement;
  setStatus(message: string, kind?: 'info' | 'error'): void;
  setBusy(busy: boolean): void;
  dispose(): void;
}

export interface CachedWebIdsUiHandlers {
  /** Invoked when the user clicks a card. */
  onPick(webId: string): void;
  /** Invoked when the user clicks a per-card forget button. */
  onForget(webId: string): void;
  /** Invoked when the user wants to enter a WebID manually. */
  onUseDifferent(): void;
}

export function renderCachedWebIdsList(
  parent: HTMLElement,
  entries: CachedWebId[],
  handlers: CachedWebIdsUiHandlers,
): CachedWebIdsUi {
  ensureStylesInjected();
  ensurePopupLayout(parent);

  const card = createCard();

  const root = document.createElement('section');
  root.setAttribute('data-reactive-fetch', 'cached-webids');

  const heading = document.createElement('h1');
  heading.setAttribute('data-reactive-fetch', 'heading');
  heading.textContent = 'Welcome back';

  const subheading = document.createElement('p');
  subheading.setAttribute('data-reactive-fetch', 'subheading');
  subheading.textContent = 'Pick a WebID to sign in with.';

  const list = document.createElement('div');
  list.setAttribute('role', 'list');
  list.setAttribute('data-reactive-fetch', 'cached-list');

  const cleanups: Array<() => void> = [];
  const pickButtons: HTMLButtonElement[] = [];
  const forgetButtons: HTMLButtonElement[] = [];

  entries.forEach((entry, index) => {
    const row = document.createElement('div');
    row.setAttribute('role', 'listitem');
    row.setAttribute('data-reactive-fetch', 'cached-webid-card');
    row.style.setProperty('--rf-stagger-index', String(index));

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.setAttribute('data-reactive-fetch', 'cached-webid-pick');
    pick.setAttribute(
      'aria-label',
      `Sign in as ${entry.name ?? entry.webId}, ${entry.webId}`,
    );

    const avatar = document.createElement('span');
    avatar.setAttribute('data-reactive-fetch', 'avatar');
    if (entry.photoUrl) {
      const img = document.createElement('img');
      img.src = entry.photoUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      // Fall back to initials if the photo fails to load (403, 404, CORS).
      img.addEventListener(
        'error',
        () => {
          img.remove();
          avatar.append(makeInitials(entry.name ?? entry.webId));
          avatar.dataset['fallback'] = 'true';
        },
        { once: true },
      );
      avatar.append(img);
    } else {
      avatar.append(makeInitials(entry.name ?? entry.webId));
      avatar.dataset['fallback'] = 'true';
    }

    const meta = document.createElement('span');
    meta.setAttribute('data-reactive-fetch', 'cached-webid-meta');

    const displayName = document.createElement('strong');
    displayName.setAttribute('data-reactive-fetch', 'cached-webid-name');
    displayName.textContent = entry.name ?? shortenWebId(entry.webId);

    const webIdLine = document.createElement('span');
    webIdLine.setAttribute('data-reactive-fetch', 'cached-webid-uri');
    webIdLine.textContent = entry.webId;

    meta.append(displayName, webIdLine);
    pick.append(avatar, meta);

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.setAttribute('data-reactive-fetch', 'forget-webid');
    forget.setAttribute('aria-label', `Forget ${entry.name ?? entry.webId}`);
    forget.title = 'Forget this WebID';
    forget.append(makeForgetIcon());

    row.append(pick, forget);
    list.append(row);

    const onPick = () => handlers.onPick(entry.webId);
    const onForget = () => handlers.onForget(entry.webId);
    pick.addEventListener('click', onPick);
    forget.addEventListener('click', onForget);
    pickButtons.push(pick);
    forgetButtons.push(forget);
    cleanups.push(() => {
      pick.removeEventListener('click', onPick);
      forget.removeEventListener('click', onForget);
    });
  });

  const useDifferent = document.createElement('button');
  useDifferent.type = 'button';
  useDifferent.setAttribute('data-reactive-fetch', 'use-different-webid');
  useDifferent.textContent = 'Sign in with a different WebID';

  const onUseDifferent = () => handlers.onUseDifferent();
  useDifferent.addEventListener('click', onUseDifferent);
  cleanups.push(() => useDifferent.removeEventListener('click', onUseDifferent));

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(heading, subheading, list, useDifferent, status);
  card.append(root);
  parent.append(card);

  let disposed = false;
  return {
    root,
    setStatus(message, kind = 'info') {
      status.textContent = message;
      status.dataset['kind'] = kind;
    },
    setBusy(busy) {
      pickButtons.forEach((b) => { b.disabled = busy; });
      forgetButtons.forEach((b) => { b.disabled = busy; });
      useDifferent.disabled = busy;
      root.dataset['busy'] = busy ? 'true' : 'false';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cleanups.forEach((fn) => fn());
      card.remove();
    },
  };
}

function shortenWebId(webId: string): string {
  try {
    const url = new URL(webId);
    return url.host + (url.pathname === '/' ? '' : url.pathname);
  } catch {
    return webId;
  }
}

function makeInitials(source: string): HTMLElement {
  const text = document.createElement('span');
  text.setAttribute('data-reactive-fetch', 'avatar-initials');
  const words = source
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 1 && /^https?:/i.test(source)) {
    try {
      const url = new URL(source);
      const host = url.host.replace(/^www\./, '');
      const hostInitial = host[0] ?? '?';
      const pathInitial = url.pathname.replace(/^\/+/, '')[0] ?? '';
      text.textContent = (hostInitial + pathInitial).toUpperCase() || '?';
      return text;
    } catch {
      /* fall through */
    }
  }
  text.textContent = words
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase() || '?';
  return text;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeForgetIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
  svg.append(path);
  return svg;
}

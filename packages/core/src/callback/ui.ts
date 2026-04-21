import type { CachedWebId } from './webidCache.js';

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

export interface IssuerPickerUi {
  root: HTMLElement;
  selection: Promise<string>;
  setStatus(message: string, kind?: 'info' | 'error'): void;
  setBusy(busy: boolean): void;
  dispose(): void;
}

export function renderIssuerPicker(
  parent: HTMLElement,
  issuers: string[],
): IssuerPickerUi {
  ensureStylesInjected();
  ensurePopupLayout(parent);

  const card = createCard();

  const root = document.createElement('form');
  root.setAttribute('data-reactive-fetch', 'issuer-picker');
  root.noValidate = true;

  const heading = document.createElement('h1');
  heading.setAttribute('data-reactive-fetch', 'heading');
  heading.textContent = 'Choose your identity provider';

  const subheading = document.createElement('p');
  subheading.setAttribute('data-reactive-fetch', 'subheading');
  subheading.textContent =
    'This WebID has multiple identity providers. Pick one to sign in with.';

  const list = document.createElement('div');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('data-reactive-fetch', 'issuer-list');

  const radios: HTMLInputElement[] = [];
  issuers.forEach((issuer, index) => {
    const id = `reactive-fetch-issuer-${index}`;
    const itemLabel = document.createElement('label');
    itemLabel.setAttribute('for', id);
    itemLabel.setAttribute('data-reactive-fetch', 'issuer-row');
    itemLabel.style.setProperty('--rf-stagger-index', String(index));

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'reactive-fetch-issuer';
    radio.id = id;
    radio.value = issuer;

    const meta = document.createElement('span');
    meta.setAttribute('data-reactive-fetch', 'issuer-meta');

    const host = document.createElement('strong');
    host.setAttribute('data-reactive-fetch', 'issuer-host');
    host.textContent = safeIssuerHost(issuer);

    const full = document.createElement('span');
    full.setAttribute('data-reactive-fetch', 'issuer-url');
    full.textContent = issuer;

    meta.append(host, full);
    itemLabel.append(radio, meta);
    list.append(itemLabel);
    radios.push(radio);
  });

  const actions = document.createElement('div');
  actions.setAttribute('data-reactive-fetch', 'actions');

  const back = document.createElement('button');
  back.type = 'button';
  back.setAttribute('data-reactive-fetch', 'secondary-button');
  back.textContent = 'Back';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.setAttribute('data-reactive-fetch', 'primary-button');
  submit.textContent = 'Continue';
  submit.disabled = true;

  actions.append(back, submit);

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(heading, subheading, list, actions, status);
  card.append(root);
  parent.append(card);

  let resolveSelection!: (value: string) => void;
  let rejectSelection!: (reason: unknown) => void;
  const selection = new Promise<string>((resolve, reject) => {
    resolveSelection = resolve;
    rejectSelection = reject;
  });
  selection.catch(() => { /* consumer handles */ });

  const onChange = () => {
    submit.disabled = !radios.some((r) => r.checked);
  };
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const chosen = radios.find((r) => r.checked);
    if (!chosen) return;
    resolveSelection(chosen.value);
  };
  const onBack = () => {
    rejectSelection(new IssuerPickerCancelled());
  };

  list.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  back.addEventListener('click', onBack);

  let disposed = false;

  return {
    root,
    selection,
    setStatus(message, kind = 'info') {
      status.textContent = message;
      status.dataset['kind'] = kind;
    },
    setBusy(busy) {
      submit.disabled = busy || !radios.some((r) => r.checked);
      back.disabled = busy;
      radios.forEach((r) => { r.disabled = busy; });
      root.dataset['busy'] = busy ? 'true' : 'false';
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      list.removeEventListener('change', onChange);
      root.removeEventListener('submit', onSubmit);
      back.removeEventListener('click', onBack);
      rejectSelection(new IssuerPickerCancelled());
      card.remove();
    },
  };
}

export class IssuerPickerCancelled extends Error {
  constructor() {
    super('Issuer picker cancelled by user.');
    this.name = 'IssuerPickerCancelled';
  }
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

function safeIssuerHost(issuer: string): string {
  try {
    return new URL(issuer).host || issuer;
  } catch {
    return issuer;
  }
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

function createCard(): HTMLElement {
  const card = document.createElement('section');
  card.setAttribute('data-reactive-fetch', 'card');
  return card;
}

// Flag on <html> so `ensurePopupLayout` is idempotent across view swaps
// within the same popup window.
const LAYOUT_APPLIED_ATTR = 'data-reactive-fetch-layout';

function ensurePopupLayout(parent: HTMLElement): void {
  // Only apply body-level layout (viewport centering, background gradient)
  // when the consumer mounts to the document body itself — the default path.
  // A custom `root` means the app owns that chrome and we shouldn't paint it.
  if (parent !== document.body) return;
  const root = document.documentElement;
  if (root.hasAttribute(LAYOUT_APPLIED_ATTR)) return;
  root.setAttribute(LAYOUT_APPLIED_ATTR, 'true');
  document.body.setAttribute('data-reactive-fetch-body', 'true');
}

const STYLE_ELEMENT_ID = 'reactive-fetch-popup-styles';

function ensureStylesInjected(): void {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = POPUP_CSS;
  document.head.appendChild(style);
}

const POPUP_CSS = `
:root {
  --rf-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  --rf-font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;

  --rf-accent: #7C4DFF;
  --rf-accent-hover: #6A3CE8;
  --rf-accent-pressed: #5A2DD0;
  --rf-accent-tint: color-mix(in srgb, #7C4DFF 8%, transparent);
  --rf-accent-tint-strong: color-mix(in srgb, #7C4DFF 14%, transparent);
  --rf-accent-ring: color-mix(in srgb, #7C4DFF 28%, transparent);
  --rf-on-accent: #FFFFFF;

  --rf-text: #17182B;
  --rf-text-secondary: #4A4D66;
  --rf-text-muted: #7C7F99;

  --rf-bg: #FFFFFF;
  --rf-bg-subtle: #F7F8FC;
  --rf-bg-sunken: #EEF0F9;

  --rf-border: #E4E6EF;
  --rf-border-strong: #C9CCDD;

  --rf-success: #0E8A4F;
  --rf-error: #C42C33;
  --rf-error-bg: #FDECEE;

  --rf-radius-sm: 6px;
  --rf-radius: 10px;
  --rf-radius-lg: 16px;

  --rf-shadow-sm: 0 1px 2px rgba(23, 24, 43, 0.04), 0 1px 1px rgba(23, 24, 43, 0.02);
  --rf-shadow-md: 0 4px 12px rgba(23, 24, 43, 0.06), 0 2px 4px rgba(23, 24, 43, 0.03);
  --rf-shadow-xl: 0 24px 48px -12px rgba(23, 24, 43, 0.12), 0 8px 16px -8px rgba(23, 24, 43, 0.06);

  --rf-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --rf-t-fast: 140ms;
  --rf-t-med: 220ms;

  --rf-focus-ring: 0 0 0 3px var(--rf-accent-ring);
}

[data-reactive-fetch-body] {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background:
    radial-gradient(ellipse 800px 480px at 50% -10%, color-mix(in srgb, var(--rf-accent) 10%, transparent), transparent 70%),
    linear-gradient(180deg, var(--rf-bg-subtle) 0%, var(--rf-bg-sunken) 100%);
  font-family: var(--rf-font);
  font-size: 15px;
  line-height: 1.55;
  color: var(--rf-text);
  -webkit-font-smoothing: antialiased;
  box-sizing: border-box;
}

[data-reactive-fetch-body] *,
[data-reactive-fetch-body] *::before,
[data-reactive-fetch-body] *::after {
  box-sizing: border-box;
}

[data-reactive-fetch="card"] {
  width: 100%;
  max-width: 440px;
  background: var(--rf-bg);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius-lg);
  box-shadow: var(--rf-shadow-xl);
  padding: 2rem;
  animation: rf-card-in var(--rf-t-med) var(--rf-ease) both;
}

@keyframes rf-card-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}

[data-reactive-fetch="prompt"],
[data-reactive-fetch="issuer-picker"],
[data-reactive-fetch="cached-webids"] {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

[data-reactive-fetch="heading"] {
  margin: 0;
  font-size: 1.375rem;
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.015em;
  color: var(--rf-text);
}

[data-reactive-fetch="subheading"] {
  margin: -0.75rem 0 0;
  color: var(--rf-text-secondary);
  font-size: 0.9375rem;
}

[data-reactive-fetch="field"] {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

[data-reactive-fetch="field"] label {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--rf-text-secondary);
}

#reactive-fetch-webid {
  width: 100%;
  padding: 0.75rem 1rem;
  font: inherit;
  color: var(--rf-text);
  background: var(--rf-bg-subtle);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius);
  transition:
    border-color var(--rf-t-fast) var(--rf-ease),
    background var(--rf-t-fast) var(--rf-ease),
    box-shadow var(--rf-t-fast) var(--rf-ease);
}

#reactive-fetch-webid::placeholder {
  color: var(--rf-text-muted);
}

#reactive-fetch-webid:hover:not(:disabled):not(:focus) {
  border-color: var(--rf-border-strong);
}

#reactive-fetch-webid:focus {
  outline: none;
  border-color: var(--rf-accent);
  background: var(--rf-bg);
  box-shadow: var(--rf-focus-ring);
}

#reactive-fetch-webid:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

[data-reactive-fetch="primary-button"],
[data-reactive-fetch="secondary-button"],
[data-reactive-fetch="use-different-webid"] {
  font: inherit;
  font-weight: 600;
  min-height: 44px;
  padding: 0.625rem 1.25rem;
  border-radius: var(--rf-radius);
  cursor: pointer;
  transition:
    background var(--rf-t-fast) var(--rf-ease),
    border-color var(--rf-t-fast) var(--rf-ease),
    box-shadow var(--rf-t-fast) var(--rf-ease),
    transform 90ms var(--rf-ease);
}

[data-reactive-fetch="primary-button"] {
  background: var(--rf-accent);
  color: var(--rf-on-accent);
  border: 1px solid transparent;
  box-shadow: var(--rf-shadow-sm);
}

[data-reactive-fetch="primary-button"]:hover:not(:disabled) {
  background: var(--rf-accent-hover);
}

[data-reactive-fetch="primary-button"]:active:not(:disabled) {
  background: var(--rf-accent-pressed);
  transform: scale(0.985);
}

[data-reactive-fetch="primary-button"]:focus-visible {
  outline: none;
  box-shadow: var(--rf-focus-ring), var(--rf-shadow-sm);
}

[data-reactive-fetch="primary-button"]:disabled {
  background: color-mix(in srgb, var(--rf-accent) 40%, var(--rf-bg-sunken));
  color: color-mix(in srgb, var(--rf-on-accent) 80%, transparent);
  cursor: not-allowed;
  box-shadow: none;
}

[data-reactive-fetch="secondary-button"],
[data-reactive-fetch="use-different-webid"] {
  background: var(--rf-bg);
  color: var(--rf-text);
  border: 1px solid var(--rf-border);
}

[data-reactive-fetch="secondary-button"]:hover:not(:disabled),
[data-reactive-fetch="use-different-webid"]:hover:not(:disabled) {
  background: var(--rf-bg-subtle);
  border-color: var(--rf-border-strong);
}

[data-reactive-fetch="secondary-button"]:active:not(:disabled),
[data-reactive-fetch="use-different-webid"]:active:not(:disabled) {
  transform: scale(0.985);
}

[data-reactive-fetch="secondary-button"]:focus-visible,
[data-reactive-fetch="use-different-webid"]:focus-visible {
  outline: none;
  box-shadow: var(--rf-focus-ring);
}

[data-reactive-fetch="secondary-button"]:disabled,
[data-reactive-fetch="use-different-webid"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

[data-reactive-fetch="actions"] {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

[data-reactive-fetch="actions"] [data-reactive-fetch="primary-button"] {
  flex: 0 1 auto;
  min-width: 7rem;
}

[data-reactive-fetch="issuer-list"] {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 280px;
  overflow-y: auto;
  padding: 0.125rem;
  margin: 0 -0.125rem;
}

[data-reactive-fetch="issuer-row"] {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius);
  background: var(--rf-bg);
  cursor: pointer;
  transition:
    border-color var(--rf-t-fast) var(--rf-ease),
    background var(--rf-t-fast) var(--rf-ease),
    box-shadow var(--rf-t-fast) var(--rf-ease),
    transform var(--rf-t-fast) var(--rf-ease);
  animation: rf-row-in var(--rf-t-med) var(--rf-ease) both;
  animation-delay: calc(var(--rf-stagger-index, 0) * 60ms);
}

@keyframes rf-row-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

[data-reactive-fetch="issuer-row"]:hover {
  border-color: var(--rf-border-strong);
  background: var(--rf-bg-subtle);
  transform: translateY(-1px);
  box-shadow: var(--rf-shadow-sm);
}

[data-reactive-fetch="issuer-row"]:has(input:checked) {
  border-color: var(--rf-accent);
  background: var(--rf-accent-tint);
  box-shadow: 0 0 0 1px var(--rf-accent);
}

[data-reactive-fetch="issuer-row"]:focus-within {
  box-shadow: var(--rf-focus-ring);
}

[data-reactive-fetch="issuer-row"] input[type="radio"] {
  margin: 2px 0 0;
  accent-color: var(--rf-accent);
}

[data-reactive-fetch="issuer-meta"] {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.125rem;
  flex: 1;
}

[data-reactive-fetch="issuer-host"] {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--rf-text);
  word-break: break-all;
}

[data-reactive-fetch="issuer-url"] {
  font-size: 0.8125rem;
  color: var(--rf-text-muted);
  font-family: var(--rf-font-mono);
  word-break: break-all;
}

/* Cached WebIDs */

[data-reactive-fetch="cached-list"] {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 320px;
  overflow-y: auto;
  padding: 0.125rem;
  margin: 0 -0.125rem;
}

[data-reactive-fetch="cached-webid-card"] {
  display: flex;
  align-items: stretch;
  gap: 0;
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius);
  background: var(--rf-bg);
  overflow: hidden;
  transition:
    border-color var(--rf-t-fast) var(--rf-ease),
    box-shadow var(--rf-t-fast) var(--rf-ease);
  animation: rf-row-in var(--rf-t-med) var(--rf-ease) both;
  animation-delay: calc(var(--rf-stagger-index, 0) * 60ms);
}

[data-reactive-fetch="cached-webid-card"]:hover {
  border-color: var(--rf-border-strong);
  box-shadow: var(--rf-shadow-sm);
}

[data-reactive-fetch="cached-webid-pick"] {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  flex: 1;
  min-width: 0;
  padding: 0.75rem 1rem;
  background: transparent;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background var(--rf-t-fast) var(--rf-ease);
}

[data-reactive-fetch="cached-webid-pick"]:hover:not(:disabled) {
  background: var(--rf-accent-tint);
}

[data-reactive-fetch="cached-webid-pick"]:active:not(:disabled) {
  background: var(--rf-accent-tint-strong);
}

[data-reactive-fetch="cached-webid-pick"]:focus-visible {
  outline: none;
  background: var(--rf-accent-tint);
  box-shadow: inset 0 0 0 2px var(--rf-accent);
}

[data-reactive-fetch="cached-webid-pick"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

[data-reactive-fetch="avatar"] {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: linear-gradient(135deg, var(--rf-accent) 0%, #5A2DD0 100%);
  color: var(--rf-on-accent);
  font-weight: 600;
  font-size: 1rem;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
}

[data-reactive-fetch="avatar"] img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

[data-reactive-fetch="avatar-initials"] {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

[data-reactive-fetch="cached-webid-meta"] {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1;
}

[data-reactive-fetch="cached-webid-name"] {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--rf-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-reactive-fetch="cached-webid-uri"] {
  font-size: 0.8125rem;
  color: var(--rf-text-muted);
  font-family: var(--rf-font-mono);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[data-reactive-fetch="forget-webid"] {
  flex: 0 0 auto;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-left: 1px solid transparent;
  color: var(--rf-text-muted);
  cursor: pointer;
  transition:
    color var(--rf-t-fast) var(--rf-ease),
    background var(--rf-t-fast) var(--rf-ease),
    border-color var(--rf-t-fast) var(--rf-ease);
}

[data-reactive-fetch="forget-webid"] svg {
  width: 14px;
  height: 14px;
}

[data-reactive-fetch="forget-webid"]:hover:not(:disabled) {
  color: var(--rf-error);
  background: var(--rf-error-bg);
  border-left-color: var(--rf-border);
}

[data-reactive-fetch="forget-webid"]:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--rf-accent);
}

[data-reactive-fetch="forget-webid"]:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

[data-reactive-fetch="status"] {
  margin: 0;
  font-size: 0.875rem;
  color: var(--rf-text-secondary);
  padding: 0.5rem 0.75rem;
  border-radius: var(--rf-radius-sm);
  background: var(--rf-bg-subtle);
}

[data-reactive-fetch="status"]:empty {
  display: none;
}

[data-reactive-fetch="status"][data-kind="error"] {
  color: var(--rf-error);
  background: var(--rf-error-bg);
}

[data-reactive-fetch="prompt"][data-busy="true"],
[data-reactive-fetch="issuer-picker"][data-busy="true"],
[data-reactive-fetch="cached-webids"][data-busy="true"] {
  pointer-events: none;
}

[data-reactive-fetch="prompt"][data-busy="true"] [data-reactive-fetch="primary-button"]::after,
[data-reactive-fetch="issuer-picker"][data-busy="true"] [data-reactive-fetch="primary-button"]::after {
  content: "";
  display: inline-block;
  width: 0.75rem;
  height: 0.75rem;
  margin-left: 0.5rem;
  vertical-align: -0.0625rem;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: var(--rf-on-accent);
  border-radius: 50%;
  animation: rf-spin 700ms linear infinite;
}

@keyframes rf-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 440px) {
  [data-reactive-fetch-body] { padding: 1rem; }
  [data-reactive-fetch="card"] { padding: 1.5rem; }
  [data-reactive-fetch="actions"] { flex-direction: column-reverse; }
  [data-reactive-fetch="actions"] [data-reactive-fetch="primary-button"],
  [data-reactive-fetch="actions"] [data-reactive-fetch="secondary-button"] {
    width: 100%;
  }
  [data-reactive-fetch="avatar"] { width: 40px; height: 40px; font-size: 0.9375rem; }
}

@media (prefers-reduced-motion: reduce) {
  [data-reactive-fetch="card"],
  [data-reactive-fetch="issuer-row"],
  [data-reactive-fetch="cached-webid-card"] {
    animation: none;
  }
  [data-reactive-fetch="primary-button"],
  [data-reactive-fetch="secondary-button"],
  [data-reactive-fetch="use-different-webid"],
  [data-reactive-fetch="issuer-row"],
  [data-reactive-fetch="cached-webid-pick"] {
    transition: none;
  }
}

@media (prefers-color-scheme: dark) {
  [data-reactive-fetch-body] {
    --rf-text: #EDEDF6;
    --rf-text-secondary: #B2B5C8;
    --rf-text-muted: #8A8DA3;
    --rf-bg: #1B1C2E;
    --rf-bg-subtle: #22243A;
    --rf-bg-sunken: #13141F;
    --rf-border: #2F3249;
    --rf-border-strong: #4A4E6A;
    --rf-error-bg: color-mix(in srgb, #C42C33 18%, var(--rf-bg));
    --rf-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4);
    --rf-shadow-xl: 0 24px 48px -12px rgba(0, 0, 0, 0.6), 0 8px 16px -8px rgba(0, 0, 0, 0.4);
    background:
      radial-gradient(ellipse 800px 480px at 50% -10%, color-mix(in srgb, var(--rf-accent) 14%, transparent), transparent 70%),
      linear-gradient(180deg, #13141F 0%, #0D0E18 100%);
  }
}
`;

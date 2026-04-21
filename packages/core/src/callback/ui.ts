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
  subheading.textContent = "Enter your WebID and we'll redirect you to your identity provider.";

  const label = document.createElement('label');
  label.textContent = 'WebID';
  label.setAttribute('for', 'reactive-fetch-webid');

  const input = document.createElement('input');
  input.id = 'reactive-fetch-webid';
  input.type = 'url';
  input.name = 'webid';
  input.required = true;
  input.autocomplete = 'off';
  input.placeholder = 'https://your.pod/profile/card#me';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.setAttribute('data-reactive-fetch', 'primary-button');
  submit.textContent = 'Continue';

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(heading, subheading, label, input, submit, status);
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

function safeIssuerHost(issuer: string): string {
  try {
    return new URL(issuer).host || issuer;
  } catch {
    return issuer;
  }
}

function createCard(): HTMLElement {
  const card = document.createElement('section');
  card.setAttribute('data-reactive-fetch', 'card');
  return card;
}

// Flag on <html> so `ensurePopupLayout` is idempotent across form↔picker swaps
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

// Tag the injected <style> so a tree with multiple ui.ts bundles (unlikely but
// possible in consumer-override scenarios) does not duplicate it.
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
  --rf-accent: #7C4DFF;
  --rf-accent-dark: #6A3CE8;
  --rf-accent-tint: rgba(124, 77, 255, 0.08);
  --rf-text: #1A1B2E;
  --rf-text-muted: #5D6073;
  --rf-border: #E4E6EE;
  --rf-border-strong: #C8CBDC;
  --rf-bg: #FFFFFF;
  --rf-bg-muted: #F7F8FC;
  --rf-success: #0E8A4F;
  --rf-success-tint: #E8F5EE;
  --rf-error: #C42C33;
  --rf-error-tint: #FDECEE;
  --rf-shadow: 0 20px 48px rgba(26, 27, 46, 0.08), 0 2px 6px rgba(26, 27, 46, 0.04);
  --rf-radius: 12px;
  --rf-focus-ring: 0 0 0 3px rgba(124, 77, 255, 0.28);
}

[data-reactive-fetch-body] {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  background: linear-gradient(180deg, #F7F8FC 0%, #EEF0F9 100%);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: var(--rf-text);
  box-sizing: border-box;
}

[data-reactive-fetch-body] *, [data-reactive-fetch-body] *::before, [data-reactive-fetch-body] *::after {
  box-sizing: border-box;
}

[data-reactive-fetch="card"] {
  width: 100%;
  max-width: 420px;
  background: var(--rf-bg);
  border: 1px solid var(--rf-border);
  border-radius: var(--rf-radius);
  box-shadow: var(--rf-shadow);
  padding: 2rem;
}

[data-reactive-fetch="prompt"],
[data-reactive-fetch="issuer-picker"] {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

[data-reactive-fetch="heading"] {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--rf-text);
}

[data-reactive-fetch="subheading"] {
  margin: -0.5rem 0 0;
  color: var(--rf-text-muted);
  font-size: 0.9375rem;
}

[data-reactive-fetch="prompt"] label {
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rf-text-muted);
  margin-bottom: -0.5rem;
}

[data-reactive-fetch="prompt"] input,
#reactive-fetch-webid {
  width: 100%;
  padding: 0.75rem 1rem;
  font: inherit;
  color: var(--rf-text);
  background: var(--rf-bg-muted);
  border: 1px solid var(--rf-border);
  border-radius: 8px;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

#reactive-fetch-webid::placeholder {
  color: #9A9CAE;
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
[data-reactive-fetch="secondary-button"] {
  font: inherit;
  font-weight: 600;
  min-height: 44px;
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 80ms ease;
}

[data-reactive-fetch="primary-button"] {
  background: var(--rf-accent);
  color: #FFFFFF;
  border: 1px solid var(--rf-accent);
}

[data-reactive-fetch="primary-button"]:hover:not(:disabled) {
  background: var(--rf-accent-dark);
  border-color: var(--rf-accent-dark);
}

[data-reactive-fetch="primary-button"]:active:not(:disabled) {
  transform: translateY(1px);
}

[data-reactive-fetch="primary-button"]:focus-visible {
  outline: none;
  box-shadow: var(--rf-focus-ring);
}

[data-reactive-fetch="primary-button"]:disabled {
  background: #C7BFE5;
  border-color: #C7BFE5;
  cursor: not-allowed;
}

[data-reactive-fetch="secondary-button"] {
  background: var(--rf-bg);
  color: var(--rf-text);
  border: 1px solid var(--rf-border);
}

[data-reactive-fetch="secondary-button"]:hover:not(:disabled) {
  background: var(--rf-bg-muted);
  border-color: var(--rf-border-strong);
}

[data-reactive-fetch="secondary-button"]:focus-visible {
  outline: none;
  box-shadow: var(--rf-focus-ring);
}

[data-reactive-fetch="secondary-button"]:disabled {
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
  padding: 0.75rem 1rem;
  border: 1px solid var(--rf-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease, box-shadow 120ms ease;
}

[data-reactive-fetch="issuer-row"]:hover {
  border-color: var(--rf-border-strong);
  background: var(--rf-bg-muted);
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
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  word-break: break-all;
}

[data-reactive-fetch="status"] {
  margin: 0;
  font-size: 0.875rem;
  color: var(--rf-text-muted);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--rf-bg-muted);
}

[data-reactive-fetch="status"]:empty {
  display: none;
}

[data-reactive-fetch="status"][data-kind="error"] {
  color: var(--rf-error);
  background: var(--rf-error-tint);
}

[data-reactive-fetch="prompt"][data-busy="true"],
[data-reactive-fetch="issuer-picker"][data-busy="true"] {
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
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #FFFFFF;
  border-radius: 50%;
  animation: reactive-fetch-spin 700ms linear infinite;
}

@keyframes reactive-fetch-spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 420px) {
  [data-reactive-fetch-body] {
    padding: 1rem;
  }
  [data-reactive-fetch="card"] {
    padding: 1.5rem;
  }
  [data-reactive-fetch="actions"] {
    flex-direction: column-reverse;
  }
  [data-reactive-fetch="actions"] [data-reactive-fetch="primary-button"],
  [data-reactive-fetch="actions"] [data-reactive-fetch="secondary-button"] {
    width: 100%;
  }
}

@media (prefers-color-scheme: dark) {
  [data-reactive-fetch-body] {
    --rf-text: #EDEDF6;
    --rf-text-muted: #A2A5B9;
    --rf-border: #2F3249;
    --rf-border-strong: #4A4E6A;
    --rf-bg: #1A1B2E;
    --rf-bg-muted: #23253B;
    --rf-success-tint: rgba(14, 138, 79, 0.18);
    --rf-error-tint: rgba(196, 44, 51, 0.18);
    --rf-shadow: 0 20px 48px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.3);
    background: linear-gradient(180deg, #13141F 0%, #1A1B2E 100%);
  }
  [data-reactive-fetch="primary-button"]:disabled {
    background: #4A3F7A;
    border-color: #4A3F7A;
    color: #8F88B0;
  }
}
`;

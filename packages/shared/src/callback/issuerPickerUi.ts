import { createCard, ensurePopupLayout, ensureStylesInjected } from './popupChrome.js';

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

function safeIssuerHost(issuer: string): string {
  try {
    return new URL(issuer).host || issuer;
  } catch {
    return issuer;
  }
}

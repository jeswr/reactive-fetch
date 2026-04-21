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
  const root = document.createElement('form');
  root.setAttribute('data-reactive-fetch', 'prompt');
  root.noValidate = true;

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
  submit.textContent = 'Continue';

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(label, input, submit, status);
  parent.append(root);

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
      root.remove();
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
  const root = document.createElement('form');
  root.setAttribute('data-reactive-fetch', 'issuer-picker');
  root.noValidate = true;

  const heading = document.createElement('p');
  heading.setAttribute('data-reactive-fetch', 'issuer-picker-heading');
  heading.textContent =
    'This WebID has multiple identity providers. Pick one to sign in with:';

  const list = document.createElement('div');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('data-reactive-fetch', 'issuer-list');

  const radios: HTMLInputElement[] = [];
  issuers.forEach((issuer, index) => {
    const id = `reactive-fetch-issuer-${index}`;
    const itemLabel = document.createElement('label');
    itemLabel.setAttribute('for', id);

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'reactive-fetch-issuer';
    radio.id = id;
    radio.value = issuer;

    const host = document.createElement('strong');
    host.setAttribute('data-reactive-fetch', 'issuer-host');
    host.textContent = safeIssuerHost(issuer);

    const full = document.createElement('span');
    full.setAttribute('data-reactive-fetch', 'issuer-url');
    full.textContent = issuer;

    itemLabel.append(radio, host, full);
    list.append(itemLabel);
    radios.push(radio);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.textContent = 'Continue';
  submit.disabled = true;

  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Back';

  const status = document.createElement('p');
  status.setAttribute('data-reactive-fetch', 'status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  root.append(heading, list, submit, back, status);
  parent.append(root);

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
      root.remove();
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

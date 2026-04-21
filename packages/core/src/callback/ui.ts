export interface PromptUi {
  root: HTMLElement;
  input: HTMLInputElement;
  submit: HTMLButtonElement;
  status: HTMLElement;
  setStatus(message: string, kind?: 'info' | 'error'): void;
  setBusy(busy: boolean): void;
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
  };
}

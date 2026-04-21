import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  IssuerPickerCancelled,
  renderCachedWebIdsList,
  renderIssuerPicker,
  renderPromptUi,
} from './ui.js';
import type { CachedWebId } from './webidCache.js';

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-reactive-fetch-layout');
  document.body.removeAttribute('data-reactive-fetch-body');
  document.getElementById('reactive-fetch-popup-styles')?.remove();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderPromptUi', () => {
  test('renders a form with the WebID input and preserves existing selectors', () => {
    const ui = renderPromptUi(document.body);
    expect(ui.root.getAttribute('data-reactive-fetch')).toBe('prompt');
    expect(document.getElementById('reactive-fetch-webid')).toBe(ui.input);
    expect(ui.submit.getAttribute('data-reactive-fetch')).toBe('primary-button');
  });

  test('setStatus writes the message and kind, setBusy toggles dataset + disabled', () => {
    const ui = renderPromptUi(document.body);
    ui.setStatus('Looking…');
    expect(ui.status.textContent).toBe('Looking…');
    expect(ui.status.dataset['kind']).toBe('info');
    ui.setStatus('Nope', 'error');
    expect(ui.status.dataset['kind']).toBe('error');
    ui.setBusy(true);
    expect(ui.input.disabled).toBe(true);
    expect(ui.submit.disabled).toBe(true);
    expect(ui.root.dataset['busy']).toBe('true');
    ui.setBusy(false);
    expect(ui.input.disabled).toBe(false);
  });
});

describe('renderIssuerPicker', () => {
  test('renders one radio per issuer and keeps existing selectors', () => {
    const picker = renderIssuerPicker(document.body, [
      'https://idp-a.example/',
      'https://idp-b.example/',
    ]);
    const radios = document.querySelectorAll<HTMLInputElement>(
      'input[name="reactive-fetch-issuer"]',
    );
    expect(radios).toHaveLength(2);
    expect(picker.root.getAttribute('data-reactive-fetch')).toBe('issuer-picker');
  });

  test('submit is disabled until a radio is checked', () => {
    renderIssuerPicker(document.body, [
      'https://idp-a.example/',
      'https://idp-b.example/',
    ]);
    const submit = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="issuer-picker"] button[type="submit"]',
    );
    expect(submit?.disabled).toBe(true);
    const radio = document.querySelector<HTMLInputElement>(
      'input[name="reactive-fetch-issuer"]',
    );
    expect(radio).not.toBeNull();
    radio!.checked = true;
    radio!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(submit?.disabled).toBe(false);
  });

  test('dispose rejects pending selection with IssuerPickerCancelled', async () => {
    const picker = renderIssuerPicker(document.body, ['https://idp.example/']);
    picker.dispose();
    await expect(picker.selection).rejects.toBeInstanceOf(IssuerPickerCancelled);
  });
});

const ALICE: CachedWebId = {
  webId: 'https://alice.example/profile#me',
  name: 'Alice',
  photoUrl: 'https://alice.example/photo.jpg',
  lastUsedAt: 1000,
};

const BOB: CachedWebId = {
  webId: 'https://bob.example/profile#me',
  name: 'Bob',
  lastUsedAt: 2000,
};

describe('renderCachedWebIdsList', () => {
  test('renders one card per cached entry with name + photo, preserves required selectors', () => {
    renderCachedWebIdsList(document.body, [ALICE, BOB], {
      onPick: () => {},
      onForget: () => {},
      onUseDifferent: () => {},
    });

    // Required data-reactive-fetch selectors from task #32.
    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).not.toBeNull();
    const cards = document.querySelectorAll('[data-reactive-fetch="cached-webid-card"]');
    expect(cards).toHaveLength(2);
    const forgets = document.querySelectorAll('[data-reactive-fetch="forget-webid"]');
    expect(forgets).toHaveLength(2);
    expect(document.querySelector('[data-reactive-fetch="use-different-webid"]')).not.toBeNull();

    const firstName = cards[0]?.querySelector('[data-reactive-fetch="cached-webid-name"]');
    expect(firstName?.textContent).toBe('Alice');

    // Alice has a photo → <img> child. Bob has only initials.
    expect(cards[0]?.querySelector('img')).not.toBeNull();
    expect(cards[1]?.querySelector('img')).toBeNull();
    expect(cards[1]?.querySelector('[data-reactive-fetch="avatar-initials"]')).not.toBeNull();
  });

  test('clicking a cached card invokes onPick with that card’s WebID', () => {
    const picks: string[] = [];
    renderCachedWebIdsList(document.body, [ALICE, BOB], {
      onPick: (webId) => picks.push(webId),
      onForget: () => {},
      onUseDifferent: () => {},
    });

    const pickButtons = document.querySelectorAll<HTMLButtonElement>(
      '[data-reactive-fetch="cached-webid-pick"]',
    );
    pickButtons[1]?.click();
    expect(picks).toEqual([BOB.webId]);
  });

  test('clicking forget invokes onForget with that card’s WebID', () => {
    const forgotten: string[] = [];
    renderCachedWebIdsList(document.body, [ALICE], {
      onPick: () => {},
      onForget: (webId) => forgotten.push(webId),
      onUseDifferent: () => {},
    });

    const forget = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="forget-webid"]',
    );
    forget?.click();
    expect(forgotten).toEqual([ALICE.webId]);
  });

  test('clicking "Sign in with a different WebID" invokes onUseDifferent', () => {
    let invoked = 0;
    renderCachedWebIdsList(document.body, [ALICE], {
      onPick: () => {},
      onForget: () => {},
      onUseDifferent: () => {
        invoked += 1;
      },
    });

    const btn = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="use-different-webid"]',
    );
    btn?.click();
    expect(invoked).toBe(1);
  });

  test('cards expose aria-labels that include name and WebID for screen readers', () => {
    renderCachedWebIdsList(document.body, [ALICE], {
      onPick: () => {},
      onForget: () => {},
      onUseDifferent: () => {},
    });
    const pick = document.querySelector<HTMLButtonElement>(
      '[data-reactive-fetch="cached-webid-pick"]',
    );
    const label = pick?.getAttribute('aria-label') ?? '';
    expect(label).toContain('Alice');
    expect(label).toContain(ALICE.webId);
  });

  test('setBusy disables all interactive controls', () => {
    const ui = renderCachedWebIdsList(document.body, [ALICE, BOB], {
      onPick: () => {},
      onForget: () => {},
      onUseDifferent: () => {},
    });
    ui.setBusy(true);
    document.querySelectorAll<HTMLButtonElement>(
      '[data-reactive-fetch="cached-webid-pick"], [data-reactive-fetch="forget-webid"], [data-reactive-fetch="use-different-webid"]',
    ).forEach((btn) => {
      expect(btn.disabled).toBe(true);
    });
    expect(ui.root.dataset['busy']).toBe('true');
  });

  test('dispose removes the card from the DOM', () => {
    const ui = renderCachedWebIdsList(document.body, [ALICE], {
      onPick: () => {},
      onForget: () => {},
      onUseDifferent: () => {},
    });
    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).not.toBeNull();
    ui.dispose();
    expect(document.querySelector('[data-reactive-fetch="cached-webids"]')).toBeNull();
  });
});

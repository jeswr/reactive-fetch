// Helpers for driving the popup-based login flow. Keeps CSS-specific selectors
// and URL assumptions in one place so spec files stay focused on behaviour.

import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { ALICE, SEL } from './constants.js';

export interface LoginUser {
  webId: string;
  email: string;
  password: string;
}

export async function driveCallbackWebIdPrompt(popup: Page, webId: string): Promise<void> {
  const input = popup.locator(SEL.callbackWebIdInput);
  await input.waitFor({ state: 'visible' });
  await input.fill(webId);
  await popup.locator(SEL.callbackPromptSubmit).click();
}

export async function driveCssLoginForm(popup: Page, user: LoginUser): Promise<void> {
  // CSS v7 password login pages live under /.account/login/password/ but the
  // exact subpath can vary by config. Match any login page that exposes email
  // + password fields.
  await popup.locator('input[name="email"]').waitFor({ state: 'visible', timeout: 20_000 });
  await popup.locator('input[name="email"]').fill(user.email);
  await popup.locator('input[name="password"]').fill(user.password);
  await popup.locator('button[type="submit"]').first().click();
}

export async function driveCssConsentIfPresent(popup: Page): Promise<void> {
  // CSS shows a consent screen for unknown clients. Wait briefly to see if
  // one appears; if the popup has already returned to our origin or closed,
  // nothing to do.
  try {
    await popup.waitForURL(
      (url) => {
        const s = url.toString();
        return s.includes('/.account/oidc/consent') ||
               s.includes('/idp/consent') ||
               url.pathname.endsWith('/callback.html');
      },
      { timeout: 10_000 },
    );
  } catch {
    return;
  }
  const current = popup.url();
  if (current.includes('/consent')) {
    const submit = popup.locator('form button[type="submit"]');
    if (await submit.count()) {
      await submit.first().click();
    }
  }
}

/**
 * Drives a full popup login and waits for the WebID to appear in the opener.
 */
export async function loginAs(
  context: BrowserContext,
  page: Page,
  user: LoginUser = ALICE,
): Promise<void> {
  const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
  await page.locator(SEL.showWebIdBtn).click();
  const popup = await popupPromise;

  await driveCallbackWebIdPrompt(popup, user.webId);
  await driveCssLoginForm(popup, user);
  await driveCssConsentIfPresent(popup);

  // Popup self-closes via window.close() after postMessage. Tolerate the
  // close happening before we observe it.
  await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);

  // The WebID is written to a dedicated `#webid-display` element so that
  // subsequent fetch-body responses in `#output` don't clobber it.
  await expect(page.locator(SEL.webIdDisplay)).toHaveText(user.webId, { timeout: 20_000 });
}

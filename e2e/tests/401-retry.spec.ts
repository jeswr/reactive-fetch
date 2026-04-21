// Reactive auth: the vanilla-ts app's "Fetch private resource" button first
// awaits `rf.webId` (which triggers the login popup if not authenticated),
// then fetches. The reactive-fetch core itself also retries on a 401. Both
// paths converge to the same user-visible outcome: after a single click and
// a single popup login, the private resource body is displayed.

import { test, expect } from '../fixtures/test.js';
import { driveCallbackWebIdPrompt, driveCssConsentIfPresent, driveCssLoginForm } from '../fixtures/login.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('login-on-demand triggered by fetch-private click', () => {
  test('unauthenticated fetch triggers popup login then returns the resource', async ({
    context,
    page,
    seededPrivateResource,
  }) => {
    void seededPrivateResource;

    await context.clearCookies();

    await page.goto('/');
    await page.locator(SEL.fetchPrivateBtn).waitFor({ state: 'visible' });

    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.fetchPrivateBtn).click();
    const popup = await popupPromise;

    await driveCallbackWebIdPrompt(popup, ALICE.webId);
    await driveCssLoginForm(popup, ALICE);
    await driveCssConsentIfPresent(popup);

    await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);

    await expect(page.locator(SEL.status)).toContainText(/\b200\b/, { timeout: 20_000 });
    await expect(page.locator(SEL.output)).toContainText('note.txt', { timeout: 20_000 });
  });
});

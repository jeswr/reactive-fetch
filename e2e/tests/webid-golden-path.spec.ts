import { test, expect } from '../fixtures/test.js';
import { driveCallbackWebIdPrompt, driveCssConsentIfPresent, driveCssLoginForm } from '../fixtures/login.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('golden path: read WebID via popup login', () => {
  test('displays alice WebID after completing popup login', async ({ context, page }) => {
    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });

    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.showWebIdBtn).click();
    const popup = await popupPromise;

    await driveCallbackWebIdPrompt(popup, ALICE.webId);
    await driveCssLoginForm(popup, ALICE);
    await driveCssConsentIfPresent(popup);

    // Popup self-closes via window.close(). Tolerate the close happening
    // before we attach the listener.
    await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);

    await expect(page.locator(SEL.output)).toContainText(ALICE.webId, { timeout: 20_000 });
    await expect(page.locator(SEL.status)).toContainText(/signed in/i);
  });
});

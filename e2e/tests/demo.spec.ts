/**
 * Demo recording: the full reactive-fetch golden path, shot for human
 * viewers.
 *
 * This spec is intentionally NOT run by the default e2e suite — it's
 * gated behind `pnpm demo:record` (see `scripts/demo-record.mjs`). That
 * script uses `playwright.demo.config.ts` which:
 *   - forces `video: 'on'` at 1280x720
 *   - applies `slowMo: 400` so each action is readable
 *   - runs only this spec
 *
 * Each `highlight(...)` pause gives the viewer a beat to read what just
 * happened; cumulative pause time is ~6s, which combined with slowMo
 * puts the final recording at the requested ~30–45 seconds.
 */

import { test, expect } from '../fixtures/test.js';
import {
  driveCallbackWebIdPrompt,
  driveCssConsentIfPresent,
  driveCssLoginForm,
} from '../fixtures/login.js';
import { ALICE, SEL } from '../fixtures/constants.js';

async function highlight(ms = 1_000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('demo', () => {
  test('records the full reactive-fetch flow end to end', async ({ context, page }) => {
    // 1. Load the app.
    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });
    await highlight(1_500);

    // 2. Kick off login via the button.
    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.showWebIdBtn).click();
    const popup = await popupPromise;

    // 3. reactive-fetch's WebID prompt.
    await driveCallbackWebIdPrompt(popup, ALICE.webId);
    await highlight(700);

    // 4. CSS login form.
    await driveCssLoginForm(popup, ALICE);
    await highlight(700);

    // 5. Optional consent screen.
    await driveCssConsentIfPresent(popup);

    // 6. Popup self-closes; WebID resolves in the opener.
    await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);
    await expect(page.locator(SEL.webIdDisplay)).toHaveText(ALICE.webId, { timeout: 20_000 });
    await highlight(2_000);

    // 7. Authenticated fetch.
    await page.locator(SEL.fetchPrivateBtn).click();
    await expect(page.locator(SEL.output)).toContainText(ALICE.privateBody, {
      timeout: 20_000,
    });
    // Let the viewer absorb the final result.
    await highlight(3_000);
  });
});

import { test, expect } from '../fixtures/test.js';
import { SEL } from '../fixtures/constants.js';

test.describe('popup-closed cancellation surfaces an error', () => {
  test('closing the popup before login shows an error in the status line', async ({
    context,
    page,
  }) => {
    // Popup `closed`-polling fires every 500ms; give headroom for the
    // PopupClosedError to surface + render into the status line.
    test.setTimeout(30_000);
    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });

    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.showWebIdBtn).click();
    const popup = await popupPromise;

    // Wait until the callback has rendered so the opener's message listener
    // is armed (and the popup-closed polling is active).
    await popup.locator(SEL.callbackWebIdInput).waitFor({ state: 'visible' });
    await popup.close();

    // The app sets data-status="error" on the status line when the error
    // branch of withButtons runs. Assert on the stable attribute + the
    // PopupClosedError message contents.
    const status = page.locator(SEL.status);
    await expect(status).toHaveAttribute('data-status', 'error', { timeout: 15_000 });
    await expect(status).toContainText(/popup/i);
    await expect(status).toContainText(/closed/i);

    // The WebID-display element stays empty — we never resolved past the
    // cancellation, so no WebID should be rendered.
    await expect(page.locator(SEL.webIdDisplay)).toHaveText('');
  });
});

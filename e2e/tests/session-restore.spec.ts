import { test, expect } from '../fixtures/test.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('session restore on reload', () => {
  test('WebID is still available after a reload without opening a popup', async ({
    context,
    loggedInPage,
  }) => {
    // Fixture drives full popup login; reload + sync check adds little.
    test.setTimeout(30_000);
    // Arm a listener that catches any popup during reload so we can assert
    // no popup was opened rather than relying on absence of a visible window.
    let sawPopup = false;
    const onPage = () => {
      sawPopup = true;
    };
    context.on('page', onPage);

    try {
      await loggedInPage.reload();
      await loggedInPage.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });

      // Click "Show my WebID" — because the session is restored from
      // IndexedDB, this should resolve immediately without a popup.
      await loggedInPage.locator(SEL.showWebIdBtn).click();

      await expect(loggedInPage.locator(SEL.webIdDisplay)).toHaveText(ALICE.webId, {
        timeout: 15_000,
      });
      expect(sawPopup).toBe(false);
    } finally {
      context.off('page', onPage);
    }
  });
});

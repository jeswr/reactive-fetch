import { test, expect } from '../fixtures/test.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('session restore on reload', () => {
  // Firefox: after reload, IndexedDB reads within the uvdsl library's
  // RefreshWorker appear to race with the worker startup, leaving the
  // restore promise wedged. Chromium works reliably. Revisit when we have
  // a firefox-reproducible unit test for the restore path.
  test.skip(({ browserName }) => browserName === 'firefox', 'firefox IDB-in-worker race on reload');

  test('WebID is still available after a reload without opening a popup', async ({
    context,
    loggedInPage,
  }) => {
    test.setTimeout(45_000);

    // Arm a listener that catches any popup during reload, so we can assert
    // no popup was opened rather than relying on absence of a visible window.
    let sawPopup = false;
    const onPage = () => {
      sawPopup = true;
    };
    context.on('page', onPage);

    try {
      await loggedInPage.reload();
      await loggedInPage.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });

      // Click "Show my WebID" — with the persisted refresh token + DPoP
      // keypair in IndexedDB, rf.webId should resolve silently via the
      // refresh-grant path without ever opening a new popup window.
      await loggedInPage.locator(SEL.showWebIdBtn).click();

      await expect(loggedInPage.locator(SEL.webIdDisplay)).toHaveText(ALICE.webId, {
        timeout: 25_000,
      });
      expect(sawPopup).toBe(false);
    } finally {
      context.off('page', onPage);
    }
  });
});

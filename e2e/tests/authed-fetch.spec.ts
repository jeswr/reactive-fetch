import { test, expect } from '../fixtures/test.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('authenticated fetch of private pod resource', () => {
  test('logged-in alice can read her private.txt', async ({
    loggedInPage,
    seededPrivateResource,
  }) => {
    test.setTimeout(30_000);
    void seededPrivateResource;

    await loggedInPage.locator(SEL.fetchPrivateBtn).click();

    await expect(loggedInPage.locator(SEL.status)).toContainText(/\b200\b/, {
      timeout: 15_000,
    });
    await expect(loggedInPage.locator(SEL.output)).toContainText(ALICE.privateBody, {
      timeout: 15_000,
    });
  });
});

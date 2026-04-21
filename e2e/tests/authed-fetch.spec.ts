import { test, expect } from '../fixtures/test.js';
import { ALICE, SEL } from '../fixtures/constants.js';

test.describe('authenticated fetch of private pod resource', () => {
  test('logged-in alice can read her private/ container', async ({
    loggedInPage,
    seededPrivateResource,
  }) => {
    void seededPrivateResource;

    await loggedInPage.locator(SEL.fetchPrivateBtn).click();

    // Container response should be 200 (not 401/403) — the status line
    // includes the status code.
    await expect(loggedInPage.locator(SEL.status)).toContainText(/\b200\b/, {
      timeout: 15_000,
    });
    // The Turtle body of the container should reference the seeded child
    // document.
    await expect(loggedInPage.locator(SEL.output)).toContainText('note.txt', {
      timeout: 15_000,
    });
  });
});

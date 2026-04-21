import { test, expect } from '../fixtures/test.js';
import { driveCssConsentIfPresent, driveCssLoginForm } from '../fixtures/login.js';
import { ALICE, CSS_URL, MULTI_ISSUER, SEL } from '../fixtures/constants.js';

test.describe('multi-issuer picker UI', () => {
  test('shows a picker when the WebID declares multiple oidcIssuers', async ({
    context,
    page,
    seededMultiIssuerProfile,
  }) => {
    // Full popup login + picker + OIDC redirect cycle.
    test.setTimeout(30_000);
    void seededMultiIssuerProfile;

    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });

    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.showWebIdBtn).click();
    const popup = await popupPromise;

    const input = popup.locator(SEL.callbackWebIdInput);
    await input.waitFor({ state: 'visible' });
    await input.fill(MULTI_ISSUER.webId);
    await popup.locator(SEL.callbackPromptSubmit).click();

    const picker = popup.locator(SEL.issuerPicker);
    await expect(picker).toBeVisible();

    const radios = popup.locator(SEL.issuerRadio);
    await expect(radios).toHaveCount(MULTI_ISSUER.issuers.length);

    const hosts = popup.locator(SEL.issuerHost);
    await expect(hosts.first()).toContainText(new URL(CSS_URL).host);

    // Select the localhost (CSS) issuer and continue.
    await popup.locator(`${SEL.issuerRadio}[value="${CSS_URL}"]`).check();
    await popup.locator(SEL.issuerPickerSubmit).click();

    await driveCssLoginForm(popup, ALICE);
    await driveCssConsentIfPresent(popup);

    await popup.waitForEvent('close', { timeout: 20_000 }).catch(() => undefined);

    await expect(page.locator(SEL.webIdDisplay)).toHaveText(MULTI_ISSUER.webId, {
      timeout: 20_000,
    });
  });
});

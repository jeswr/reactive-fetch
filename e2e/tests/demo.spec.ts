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

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../fixtures/test.js';
import {
  driveCallbackWebIdPrompt,
  driveCssConsentIfPresent,
  driveCssLoginForm,
} from '../fixtures/login.js';
import { putAcl, putResource } from '../fixtures/css-admin.js';
import { ALICE, CSS_URL, SEL } from '../fixtures/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The vanilla-ts example hard-codes this URL for the "Fetch private resource"
// button. We seed it on-the-fly with an alice-only ACL so unauthenticated
// fetches 401 (making "authenticated" meaningful in the demo).
const DEMO_PRIVATE_URL = `${CSS_URL}/alice/private.txt`;
const DEMO_PRIVATE_BODY = "Hello from alice's private pod resource.";

function aliceOnlyAcl(resourceUrl: string, webId: string): string {
  return [
    '@prefix acl: <http://www.w3.org/ns/auth/acl#>.',
    '',
    '<#owner>',
    '  a acl:Authorization;',
    `  acl:agent <${webId}>;`,
    `  acl:accessTo <${resourceUrl}>;`,
    '  acl:mode acl:Read, acl:Write, acl:Control.',
    '',
  ].join('\n');
}

async function highlight(ms = 1_000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('demo', () => {
  test('records the full reactive-fetch flow end to end', async ({ context, page, aliceFetcher }) => {
    // Seed the private resource the app fetches. Public-read-OK ACL would let
    // the demo "succeed" without auth — so we lock it down to alice only and
    // rely on the authenticated fetch to bring the right DPoP token.
    await putResource(aliceFetcher, DEMO_PRIVATE_URL, DEMO_PRIVATE_BODY, 'text/plain');
    await putAcl(aliceFetcher, DEMO_PRIVATE_URL, aliceOnlyAcl(DEMO_PRIVATE_URL, ALICE.webId));

    // Capture timings so scripts/demo-record.mjs can align the popup track
    // with the opener track when compositing side-by-side. All values are
    // seconds relative to `t0` (which is ~= the start of the opener's video).
    const t0 = Date.now();
    let popupOpenedAt = 0;
    let popupClosedAt = 0;

    // 1. Load the app.
    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });
    await highlight(1_500);

    // 2. Kick off login via the button.
    const popupPromise = context.waitForEvent('page', { timeout: 15_000 });
    await page.locator(SEL.showWebIdBtn).click();
    const popup = await popupPromise;
    popupOpenedAt = (Date.now() - t0) / 1000;

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
    popupClosedAt = (Date.now() - t0) / 1000;
    await expect(page.locator(SEL.webIdDisplay)).toHaveText(ALICE.webId, { timeout: 20_000 });
    await highlight(2_000);

    // 7. Authenticated fetch.
    await page.locator(SEL.fetchPrivateBtn).click();
    await expect(page.locator(SEL.output)).toContainText(DEMO_PRIVATE_BODY, {
      timeout: 20_000,
    });
    // Let the viewer absorb the final result.
    await highlight(3_000);

    // Write the timings where the record script can read them. Note: these
    // are wall-clock measurements taken AFTER page.goto resolves; the real
    // opener video probably starts ~50-100ms earlier (context creation), but
    // a small fixed offset across both tracks doesn't break alignment — only
    // the RELATIVE position of popup-within-opener matters for hstack.
    const timingsPath = resolve(__dirname, '..', 'demo-output', 'timings.json');
    writeFileSync(
      timingsPath,
      JSON.stringify(
        {
          popupOpenedAt,
          popupClosedAt,
          testEndedAt: (Date.now() - t0) / 1000,
        },
        null,
        2,
      ),
    );
  });
});

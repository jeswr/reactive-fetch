// Central Playwright test fixture file. Extends the base `test` with:
//
//  - `aliceFetcher`: an authenticated fetch against CSS as alice
//  - `seededPrivateResource`: ensures alice's private/ container + ACL exist
//  - `seededMultiIssuerProfile`: a WebID with two solid:oidcIssuer triples
//  - `loggedInPage`: a page with alice already logged in (via the real popup)
//
// Heavy CSS setup happens in fixtures so the cost is amortized across tests.

import { test as base, expect, type Page } from '@playwright/test';
import {
  getAuthenticatedFetch,
  multiIssuerProfile,
  privateContainerAcl,
  publicReadAcl,
  putAcl,
  putResource,
  type CssFetcher,
} from './css-admin.js';
import { ALICE, MULTI_ISSUER, SEL } from './constants.js';
import { loginAs } from './login.js';

type Fixtures = {
  aliceFetcher: CssFetcher;
  seededPrivateResource: void;
  seededMultiIssuerProfile: void;
  loggedInPage: Page;
};

export const test = base.extend<Fixtures>({
  aliceFetcher: async ({}, use) => {
    const fetcher = await getAuthenticatedFetch({
      email: ALICE.email,
      password: ALICE.password,
    });
    await use(fetcher);
  },

  seededPrivateResource: async ({ aliceFetcher }, use) => {
    // Put a child document so CSS auto-creates the parent container, then
    // restrict the container via its ACL. The vanilla-ts app GETs the
    // container URL, so the ACL has to live on the container.
    await putResource(aliceFetcher, ALICE.privateDocument, ALICE.privateBody, 'text/plain');
    await putAcl(aliceFetcher, ALICE.privateContainer, privateContainerAcl(ALICE.privateContainer, ALICE.webId));
    await use();
  },

  seededMultiIssuerProfile: async ({ aliceFetcher }, use) => {
    await putResource(
      aliceFetcher,
      MULTI_ISSUER.profileUrl,
      multiIssuerProfile(MULTI_ISSUER.webId, [...MULTI_ISSUER.issuers]),
      'text/turtle',
    );
    // Public-readable ACL so the callback can fetch the WebID profile
    // unauthenticated to discover the oidcIssuer triples.
    await putAcl(
      aliceFetcher,
      MULTI_ISSUER.profileUrl,
      publicReadAcl(MULTI_ISSUER.profileUrl, ALICE.webId),
    );
    await use();
  },

  loggedInPage: async ({ context, page }, use) => {
    await page.goto('/');
    await page.locator(SEL.showWebIdBtn).waitFor({ state: 'visible' });
    await loginAs(context, page);
    await use(page);
  },
});

export { expect };

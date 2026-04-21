export const CSS_PORT = Number(process.env['CSS_PORT'] ?? 3000);
export const APP_PORT = Number(process.env['APP_PORT'] ?? 5173);

export const CSS_URL = `http://localhost:${CSS_PORT}`;
export const APP_URL = `http://localhost:${APP_PORT}`;

export const ALICE = {
  email: 'alice@example.com',
  password: 'password123',
  webId: `${CSS_URL}/alice/profile/card#me`,
  podRoot: `${CSS_URL}/alice/`,
  // The vanilla-ts example fetches `<podRoot>private.txt`. We seed the file
  // and restrict it to alice via an ACL so unauthenticated reads 401.
  privateResource: `${CSS_URL}/alice/private.txt`,
  privateBody: 'hello alice',
} as const;

export const BOB = {
  email: 'bob@example.com',
  password: 'password123',
  webId: `${CSS_URL}/bob/profile/card#me`,
  podRoot: `${CSS_URL}/bob/`,
} as const;

export const MULTI_ISSUER = {
  // Hosted under alice's pod so alice owns it; the callback fetches the
  // WebID profile unauthenticated to discover oidcIssuer triples, so we
  // grant public read on the resource.
  webId: `${CSS_URL}/alice/multi-profile#me`,
  profileUrl: `${CSS_URL}/alice/multi-profile`,
  issuers: [CSS_URL, 'https://login.example.org'],
} as const;

// Selectors for examples/vanilla-ts. Single source of truth — any id rename
// is a one-line change here.
export const SEL = {
  showWebIdBtn: '#show-webid',
  fetchPrivateBtn: '#fetch-private',
  status: '#status',
  output: '#output',
  webIdDisplay: '#webid-display',
  callbackWebIdInput: '#reactive-fetch-webid',
  callbackPromptSubmit: '[data-reactive-fetch="prompt"] button[type="submit"]',
  issuerPicker: '[data-reactive-fetch="issuer-picker"]',
  issuerRadio: 'input[name="reactive-fetch-issuer"]',
  issuerHost: '[data-reactive-fetch="issuer-host"]',
  issuerPickerSubmit: '[data-reactive-fetch="issuer-picker"] button[type="submit"]',
} as const;

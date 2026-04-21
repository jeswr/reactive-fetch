export const CSS_PORT = Number(process.env['CSS_PORT'] ?? 3000);
export const APP_PORT = Number(process.env['APP_PORT'] ?? 5173);

export const CSS_URL = `http://localhost:${CSS_PORT}`;
export const APP_URL = `http://localhost:${APP_PORT}`;

export const ALICE = {
  email: 'alice@example.com',
  password: 'password123',
  webId: `${CSS_URL}/alice/profile/card#me`,
  podRoot: `${CSS_URL}/alice/`,
  // The vanilla-ts example fetches `<podRoot>private/` as the private resource
  // demo. We seed a non-empty .meta/ACL on the container + a child document so
  // the GET returns something readable for authenticated alice only.
  privateContainer: `${CSS_URL}/alice/private/`,
  privateDocument: `${CSS_URL}/alice/private/note.txt`,
  privateBody: 'hello alice',
} as const;

export const BOB = {
  email: 'bob@example.com',
  password: 'password123',
  webId: `${CSS_URL}/bob/profile/card#me`,
  podRoot: `${CSS_URL}/bob/`,
} as const;

export const MULTI_ISSUER = {
  // Hosted under alice's pod so alice owns it; the callback only needs to
  // fetch it publicly to discover the oidcIssuer triples, so we grant public
  // read on the profile resource itself.
  webId: `${CSS_URL}/alice/multi-profile#me`,
  profileUrl: `${CSS_URL}/alice/multi-profile`,
  issuers: [CSS_URL, 'https://login.example.org'],
} as const;

// Selectors correspond to the ids used by examples/vanilla-ts/index.html —
// kept here so specs have a single source of truth and any id rename is a
// one-line change.
export const SEL = {
  showWebIdBtn: '#show-webid',
  fetchPrivateBtn: '#fetch-private',
  status: '#status',
  output: '#output',
  callbackWebIdInput: '#reactive-fetch-webid',
  callbackPromptSubmit: '[data-reactive-fetch="prompt"] button[type="submit"]',
  issuerPicker: '[data-reactive-fetch="issuer-picker"]',
  issuerRadio: 'input[name="reactive-fetch-issuer"]',
  issuerHost: '[data-reactive-fetch="issuer-host"]',
  issuerPickerSubmit: '[data-reactive-fetch="issuer-picker"] button[type="submit"]',
} as const;

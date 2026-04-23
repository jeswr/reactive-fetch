// WebID profiles are either Turtle (the dominant case) or JSON-LD. The
// fetch + Content-Type dispatch + parser routing all live in
// @jeswr/fetch-rdf — that's the canonical home for the helper across
// Jesse's Solid workspace, and using it here keeps the n3 +
// jsonld-streaming-parser pipeline owned in one place.
import { DataFactory as N3DataFactory } from 'n3';
import { fetchRdf, RdfFetchError } from '@jeswr/fetch-rdf';
import { NamedNodeAs, NamedNodeFrom } from '@rdfjs/wrapper';
import { Agent, WebIdDataset } from '@solid/object/webid';
import { InvalidIssuerError, NoOidcIssuerError, WebIdProfileError } from '../errors.js';

const OIDC_ISSUER_IRI = 'http://www.w3.org/ns/solid/terms#oidcIssuer';

/**
 * Subclass of `@solid/object`'s Agent that adds an `oidcIssuers` getter
 * (the upstream class today only exposes pim/solid storage; the
 * solid:oidcIssuer triple is what Solid-OIDC §6.1 mandates for issuer
 * discovery and is the property reactive-fetch / the browser extension
 * actually need from the profile).
 *
 * Exported as `WebIDProfileAgent` so the wrapping class is structurally
 * equivalent to a `WebIDProfile` (alias for upstream `Agent`) — instances
 * of it satisfy the `WebIDProfile` type, with the extra `oidcIssuers`
 * getter available for callers that have the runtime instance in hand.
 *
 * If/when `@solid/object` adds an `oidcIssuers` getter to `Agent` directly,
 * this subclass collapses to a plain re-export. See `WebIDProfile.ts` for
 * the forward-compat story.
 */
export class WebIDProfileAgent extends Agent {
  get oidcIssuers(): Set<string> {
    return this.objects(OIDC_ISSUER_IRI, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

// Internal alias kept for the existing (lower-case-d) name used throughout
// this file — newer call sites use the exported `WebIDProfileAgent`.
const WebIdAgent = WebIDProfileAgent;
type WebIdAgent = WebIDProfileAgent;

export interface ResolveOidcIssuersOptions {
  /**
   * Accept `http://localhost`, `http://127.0.0.1`, and `http://[::1]` as
   * valid issuers in addition to HTTPS. Default `false` — production apps
   * must reject plaintext-localhost issuers so a malicious WebID profile
   * cannot redirect a user's popup to a local service listening on a port.
   * Set `true` only in local dev against a non-TLS IDP (Community Solid
   * Server, ESS dev cluster, etc.).
   */
  allowLocalhost?: boolean;
}

export interface WebIdProfile {
  /** Issuer URLs that passed the HTTPS (+ optional localhost) filter. */
  issuers: string[];
  /**
   * Display name from the profile (VCARD.fn → FOAF.name → derived from the
   * URL). Undefined if the profile contained none of these.
   */
  name?: string;
  /** VCARD.hasPhoto URL if present. */
  photoUrl?: string;
}

export async function resolveWebIdProfile(
  webIdUrl: string,
  options: ResolveOidcIssuersOptions = {},
): Promise<WebIdProfile> {
  const allowLocalhost = options.allowLocalhost ?? false;
  const { agent, rawIssuers } = await fetchAndBuildAgent(webIdUrl);
  if (rawIssuers.length === 0) throw new NoOidcIssuerError(webIdUrl);

  const issuers = rawIssuers.filter((iss) => isAllowedIssuer(iss, allowLocalhost));
  if (issuers.length === 0) {
    throw new InvalidIssuerError(
      webIdUrl,
      rawIssuers[0]!,
      `WebID ${webIdUrl} declared ${rawIssuers.length} solid:oidcIssuer value(s), none of which are valid ${allowLocalhost ? 'HTTPS or localhost HTTP' : 'HTTPS'} URLs: ${rawIssuers.join(', ')}.`,
    );
  }

  // @solid/object's Agent resolves `.name` through vcardFn → foafName →
  // URL-derived, and defaults to a URL-derived string rather than null; we
  // drop the URL-derived fallback so the cache only stores real display
  // names. `.photoUrl` reads VCARD.hasPhoto and returns null when absent.
  const derivedName = deriveRealName(agent);
  const photoUrl = agent.photoUrl ?? undefined;
  return {
    issuers,
    ...(derivedName !== undefined && { name: derivedName }),
    ...(photoUrl !== undefined && { photoUrl }),
  };
}

export async function resolveOidcIssuers(
  webIdUrl: string,
  options: ResolveOidcIssuersOptions = {},
): Promise<string[]> {
  const profile = await resolveWebIdProfile(webIdUrl, options);
  return profile.issuers;
}

/**
 * Fetch the WebID Profile Document and return the wrapped
 * `WebIDProfileAgent` (the `@solid/object`-style RDF wrapper) plus the
 * issuer list that passed the HTTPS / localhost filter.
 *
 * This is the discovery primitive that backs `ReactiveFetch.profile`. It
 * exists alongside `resolveWebIdProfile` (which returns a flat literal
 * shape used by the UI cache) because the unified-wrapper API surface
 * specifically wants the wrapped object — the cache is a separate concern
 * and shouldn't pull a parsed RDF dataset into IndexedDB.
 *
 * TODO: when the colleague's planned standalone "WebID profile discovery"
 * package ships, swap this implementation out for a thin call into it. The
 * spec algorithm we follow here (Solid 26 WebID Algorithms section,
 * https://htmlpreview.github.io/?https://github.com/solid/specification/blob/feat/solid26-webid/solid26.html#webid-algorithms)
 * is the same algorithm that package will implement.
 */
export async function fetchWebIDProfile(
  webIdUrl: string,
  options: ResolveOidcIssuersOptions = {},
): Promise<{ agent: WebIDProfileAgent; issuers: string[] }> {
  const allowLocalhost = options.allowLocalhost ?? false;
  const { agent, rawIssuers } = await fetchAndBuildAgent(webIdUrl);
  if (rawIssuers.length === 0) throw new NoOidcIssuerError(webIdUrl);

  const issuers = rawIssuers.filter((iss) => isAllowedIssuer(iss, allowLocalhost));
  if (issuers.length === 0) {
    throw new InvalidIssuerError(
      webIdUrl,
      rawIssuers[0]!,
      `WebID ${webIdUrl} declared ${rawIssuers.length} solid:oidcIssuer value(s), none of which are valid ${allowLocalhost ? 'HTTPS or localhost HTTP' : 'HTTPS'} URLs: ${rawIssuers.join(', ')}.`,
    );
  }

  return { agent, issuers };
}

// Internal: fetch the WebID document, parse it, build a WebIdAgent, and
// also pull out the raw oidcIssuers without applying the issuer filter.
// The two callers above each apply their own gating on top of this.
async function fetchAndBuildAgent(
  webIdUrl: string,
): Promise<{ agent: WebIdAgent; rawIssuers: string[] }> {
  let dataset;
  try {
    ({ dataset } = await fetchRdf(webIdUrl));
  } catch (cause) {
    if (cause instanceof RdfFetchError) {
      // Map the SDK's flat-discriminator error into the existing
      // hierarchy that callers already branch on. We preserve the
      // original error as `cause` for debugging.
      if (cause.status !== undefined) {
        throw new WebIdProfileError(
          webIdUrl,
          `WebID profile fetch returned HTTP ${cause.status} for ${webIdUrl}.`,
          { cause },
        );
      }
      // No status → either a transport failure or a parse failure.
      throw new WebIdProfileError(
        webIdUrl,
        `Failed to fetch or parse WebID profile at ${webIdUrl}.`,
        { cause },
      );
    }
    throw new WebIdProfileError(webIdUrl, `Failed to fetch WebID profile at ${webIdUrl}.`, {
      cause,
    });
  }

  const webIdDataset = new WebIdDataset(dataset, N3DataFactory);
  const agent = new WebIdAgent(
    N3DataFactory.namedNode(webIdUrl),
    webIdDataset,
    N3DataFactory,
  );
  return { agent, rawIssuers: [...agent.oidcIssuers] };
}

function deriveRealName(agent: WebIdAgent): string | undefined {
  return agent.vcardFn ?? agent.foafName ?? undefined;
}

// An OIDC issuer MUST be an absolute HTTPS URL (OIDC Discovery §2). With
// `allowLocalhost: true` we additionally accept the three http loopback
// forms so local dev (Community Solid Server, ESS dev cluster, etc.) can
// run without a TLS cert. `hostname` returns IPv6 addresses bracketed per
// the WHATWG URL spec, so we compare against the bracketed form.
function isAllowedIssuer(issuer: string, allowLocalhost: boolean): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (allowLocalhost && url.protocol === 'http:') {
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]'
    );
  }
  return false;
}


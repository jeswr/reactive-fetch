// Turtle is the dominant WebID profile serialization; N3.js parses it directly
// into quads synchronously, which is noticeably faster than routing through
// rdf-parse's Comunica-backed content-type dispatch. Everything else (JSON-LD,
// RDF/XML, N-Triples, N-Quads, TriG, etc.) goes through rdf-parse.
import { Parser as N3Parser, DataFactory as N3DataFactory } from 'n3';
import datasetFactory from '@rdfjs/dataset';
import { rdfParser } from 'rdf-parse';
import { Readable } from 'readable-stream';
import contentType from 'content-type';
import type { DatasetCore, Quad } from '@rdfjs/types';
import { NamedNodeAs, NamedNodeFrom } from '@rdfjs/wrapper';
import { Agent, WebIdDataset } from '@solid/object/webid';
import { InvalidIssuerError, NoOidcIssuerError, WebIdProfileError } from '../errors.js';

const OIDC_ISSUER_IRI = 'http://www.w3.org/ns/solid/terms#oidcIssuer';

const TURTLE_FAMILY = new Set([
  'text/turtle',
  'application/n-triples',
  'application/n-quads',
  'application/trig',
]);

class WebIdAgent extends Agent {
  get oidcIssuers(): Set<string> {
    return this.objects(OIDC_ISSUER_IRI, NamedNodeAs.string, NamedNodeFrom.string);
  }
}

export async function resolveOidcIssuers(webIdUrl: string): Promise<string[]> {
  let response: Response;
  try {
    response = await globalThis.fetch(webIdUrl, {
      headers: { Accept: 'text/turtle, application/ld+json;q=0.9, */*;q=0.1' },
    });
  } catch (cause) {
    throw new WebIdProfileError(webIdUrl, `Failed to fetch WebID profile at ${webIdUrl}.`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new WebIdProfileError(
      webIdUrl,
      `WebID profile fetch returned HTTP ${response.status} for ${webIdUrl}.`,
    );
  }

  const rawContentType = response.headers.get('content-type') ?? 'text/turtle';
  let mediaType: string;
  try {
    mediaType = contentType.parse(rawContentType).type;
  } catch (cause) {
    throw new WebIdProfileError(
      webIdUrl,
      `Invalid Content-Type "${rawContentType}" on WebID profile at ${webIdUrl}.`,
      { cause },
    );
  }
  const body = await response.text();

  let quads: Quad[];
  try {
    quads = TURTLE_FAMILY.has(mediaType)
      ? parseTurtle(body, mediaType, webIdUrl)
      : await parseWithRdfParse(body, mediaType, webIdUrl);
  } catch (cause) {
    throw new WebIdProfileError(
      webIdUrl,
      `Failed to parse WebID profile (${mediaType}) at ${webIdUrl}.`,
      { cause },
    );
  }

  const dataset: DatasetCore = datasetFactory.dataset(quads);
  const webIdDataset = new WebIdDataset(dataset, N3DataFactory);
  const agent = new WebIdAgent(
    N3DataFactory.namedNode(webIdUrl),
    webIdDataset,
    N3DataFactory,
  );

  const rawIssuers = [...agent.oidcIssuers];
  if (rawIssuers.length === 0) throw new NoOidcIssuerError(webIdUrl);

  const issuers = rawIssuers.filter((iss) => isAllowedIssuer(iss));
  if (issuers.length === 0) {
    throw new InvalidIssuerError(
      webIdUrl,
      rawIssuers[0]!,
      `WebID ${webIdUrl} declared ${rawIssuers.length} solid:oidcIssuer value(s), none of which are HTTPS URLs: ${rawIssuers.join(', ')}.`,
    );
  }
  return issuers;
}

// An OIDC issuer MUST be an absolute HTTPS URL (OIDC Discovery §2). We also
// accept http://localhost and http://127.0.0.1 for local dev workflows.
function isAllowedIssuer(issuer: string): boolean {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  }
  return false;
}

function parseTurtle(body: string, format: string, baseIRI: string): Quad[] {
  const parser = new N3Parser({ format, baseIRI });
  return parser.parse(body);
}

async function parseWithRdfParse(
  body: string,
  mediaType: string,
  baseIRI: string,
): Promise<Quad[]> {
  const input = Readable.from([body]);
  const quadStream = rdfParser.parse(input as unknown as NodeJS.ReadableStream, {
    contentType: mediaType,
    baseIRI,
  });

  return new Promise<Quad[]>((resolve, reject) => {
    const collected: Quad[] = [];
    quadStream.on('data', (quad: Quad) => collected.push(quad));
    quadStream.on('error', reject);
    quadStream.on('end', () => resolve(collected));
  });
}

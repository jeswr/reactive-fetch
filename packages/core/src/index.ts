export interface ReactiveFetchOptions {
  clientId: string;
}

export interface ReactiveFetch {
  readonly webId: Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export function createReactiveFetch(_options: ReactiveFetchOptions): ReactiveFetch {
  throw new Error('createReactiveFetch: not yet implemented');
}

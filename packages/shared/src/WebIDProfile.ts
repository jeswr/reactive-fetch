// WebIDProfile — wrapped WebID profile object exposed alongside the bare
// `webId` string by both `@jeswr/solid-reactive-fetch` and the
// `solid-browser-extension` `window.solid.profile` getter.
//
// === Forward compatibility with @solid/object ===
//
// Today (2026-04, `@solid/object@0.5.0`) the canonical wrapping class for a
// WebID subject is exported as `Agent` from `@solid/object/webid`. Samu Lang
// has discussed renaming this to `WebIDProfile` so that the class name
// matches the spec note's terminology
// (https://htmlpreview.github.io/?https://github.com/solid/specification/blob/feat/solid26-webid/solid26.html#webid-algorithms).
//
// The rename has not landed; until it does, `WebIDProfile` here is a type
// alias for `Agent`. When `@solid/object` exports `WebIDProfile`, switching
// is a one-line import change (`Agent as WebIDProfile` -> `WebIDProfile`).
// Any consumer that imports `WebIDProfile` from this package keeps working
// across that rename — that's the whole point of the indirection.
//
// === API stability — IMPORTANT ===
//
// `WebIDProfile` is a wrapper around an RDF subject, so every getter is
// effectively a SPARQL query against the parsed profile. The categories
// below mirror what the spec note (Solid 26, WebID Algorithms section) and
// the `@solid/object` README treat as load-bearing today.
//
// Stable getters (use these freely — these are the ones the unified-wrapper
// package will rely on):
//   - `value`          — the WebID IRI as a string
//   - `oidcIssuers`    — exposed by ReactiveFetch via the `WebIDOidcMixin`
//                        below; on the upstream `Agent` class this lives
//                        next to `pimStorage`/`solidStorage` as a SetFrom
//                        `solid:oidcIssuer` query
//   - `pimStorage`     — Set<string> of `pim:storage` IRIs
//   - `solidStorage`   — Set<string> of `solid:storage` IRIs
//   - `storageUrls`    — Set<string> union of the two above
//
// UNSTABLE — the spec note explicitly flags these "social" properties as
// subject to change. `@solid/object` ships getters for them today
// (vcardFn / foafName / role / phone / email / knows / photoUrl / website /
// foafHomepage / vcardHasUrl / organization / title / hasEmail / hasTelephone
// / name) but neither the wire shape nor the resolution order are
// considered stable. Read these only inside per-app code that can absorb a
// breaking change. Do NOT bake them into the unified-wrapper API. They
// remain accessible because `WebIDProfile extends Agent`, but treat them
// as best-effort.
//
// We deliberately do not narrow the type beyond `Agent` here; narrowing
// would force us to copy the upstream getter list and drift from it. The
// `@solid/object` class is the source of truth.

import { Agent } from '@solid/object/webid';

/**
 * Wrapped WebID profile. See the file header for which getters are stable
 * (`value`, `oidcIssuers`, storage) versus unstable (the social-graph
 * getters: `name`, `email`, `knows`, …).
 *
 * Forward-compatible alias for the upcoming `@solid/object` `WebIDProfile`
 * export. Today this is `Agent`; switching is a one-line import change.
 */
export type WebIDProfile = Agent;

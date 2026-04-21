import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { ReactiveFetchProvider, ReactiveFetchProviderMissing } from './context.js';
import { useSolidFetch } from './useSolidFetch.js';

function Probe({ capture }: { capture: (fn: ReactiveFetch['fetch']) => void }) {
  capture(useSolidFetch());
  return null;
}

describe('useSolidFetch', () => {
  test('returns a function that forwards to rf.fetch with the same arguments', async () => {
    const rfFetch = vi.fn(async () => new Response('pong'));
    const rf = { webId: Promise.resolve('x'), fetch: rfFetch } as unknown as ReactiveFetch;

    let captured!: ReactiveFetch['fetch'];
    render(
      <ReactiveFetchProvider value={rf}>
        <Probe capture={(fn) => { captured = fn; }} />
      </ReactiveFetchProvider>,
    );

    const init = { method: 'POST' as const };
    const res = await captured('https://pod.example/r', init);
    expect(await res.text()).toBe('pong');
    expect(rfFetch).toHaveBeenCalledWith('https://pod.example/r', init);
  });

  test('throws ReactiveFetchProviderMissing when used outside a provider', () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() =>
        render(
          <Probe capture={() => {}} />,
        ),
      ).toThrow(ReactiveFetchProviderMissing);
    } finally {
      console.error = originalError;
    }
  });
});

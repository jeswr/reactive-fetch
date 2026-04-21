import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactiveFetchProvider, ReactiveFetchProviderMissing, useReactiveFetch } from './context.js';
import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';

function makeRf(): ReactiveFetch {
  return {
    get webId() {
      return Promise.resolve('https://user.example/me');
    },
    fetch: async () => new Response('ok'),
  };
}

describe('ReactiveFetchProvider / useReactiveFetch', () => {
  test('useReactiveFetch returns the provided instance', () => {
    const rf = makeRf();
    function Inner() {
      const got = useReactiveFetch();
      return <span data-testid="same">{String(got === rf)}</span>;
    }
    render(
      <ReactiveFetchProvider value={rf}>
        <Inner />
      </ReactiveFetchProvider>,
    );
    expect(screen.getByTestId('same').textContent).toBe('true');
  });

  test('useReactiveFetch throws ReactiveFetchProviderMissing outside a provider', () => {
    function Orphan() {
      useReactiveFetch();
      return null;
    }
    expect(() => render(<Orphan />)).toThrow(ReactiveFetchProviderMissing);
  });
});

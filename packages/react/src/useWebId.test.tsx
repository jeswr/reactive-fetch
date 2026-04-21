import { StrictMode, Suspense } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { ReactiveFetchProvider, ReactiveFetchProviderMissing } from './context.js';
import { useWebId } from './useWebId.js';

type PendingControls = {
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
};

function createFakeReactiveFetch(): ReactiveFetch & {
  __resolve: PendingControls['resolve'];
  __reject: PendingControls['reject'];
  __reads: number;
} {
  let reads = 0;
  let settle!: PendingControls;
  const promise = new Promise<string>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const rf = {
    get webId() {
      reads += 1;
      return promise;
    },
    async fetch() {
      return new Response();
    },
    __resolve: settle.resolve,
    __reject: settle.reject,
    get __reads() {
      return reads;
    },
  };
  return rf as unknown as ReactiveFetch & {
    __resolve: PendingControls['resolve'];
    __reject: PendingControls['reject'];
    __reads: number;
  };
}

function WebIdDisplay() {
  const webId = useWebId();
  return <span data-testid="webid">{webId}</span>;
}

describe('useWebId', () => {
  test('suspends while rf.webId is pending and resolves to the WebID', async () => {
    const rf = createFakeReactiveFetch();

    render(
      <ReactiveFetchProvider value={rf}>
        <Suspense fallback={<span data-testid="fallback">loading</span>}>
          <WebIdDisplay />
        </Suspense>
      </ReactiveFetchProvider>,
    );

    expect(screen.getByTestId('fallback')).toBeDefined();

    await act(async () => {
      rf.__resolve('https://alice.example/profile#me');
    });

    await waitFor(() => {
      expect(screen.getByTestId('webid').textContent).toBe(
        'https://alice.example/profile#me',
      );
    });
  });

  test('multiple consumers share a single webId read per ReactiveFetch instance', async () => {
    const rf = createFakeReactiveFetch();

    render(
      <ReactiveFetchProvider value={rf}>
        <Suspense fallback={<span>loading</span>}>
          <WebIdDisplay />
          <WebIdDisplay />
          <WebIdDisplay />
        </Suspense>
      </ReactiveFetchProvider>,
    );

    await act(async () => {
      rf.__resolve('https://alice.example/profile#me');
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('webid')).toHaveLength(3);
    });

    // One read per render attempt is acceptable, but NOT one-per-consumer —
    // every consumer must share the same cached Promise.
    expect(rf.__reads).toBeLessThanOrEqual(2);
  });

  test('throws ReactiveFetchProviderMissing when used outside a provider', () => {
    function Boom() {
      return (
        <Suspense fallback={<span>loading</span>}>
          <WebIdDisplay />
        </Suspense>
      );
    }

    // Silence React's error-boundary logging for this negative test.
    const originalError = console.error;
    console.error = () => {};
    try {
      expect(() =>
        render(
          <StrictMode>
            <Boom />
          </StrictMode>,
        ),
      ).toThrow(ReactiveFetchProviderMissing);
    } finally {
      console.error = originalError;
    }
  });
});

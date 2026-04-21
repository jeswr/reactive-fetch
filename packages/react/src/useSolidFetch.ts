import { useCallback } from 'react';
import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';
import { useReactiveFetch } from './context.js';

export type SolidFetch = ReactiveFetch['fetch'];

export function useSolidFetch(): SolidFetch {
  const rf = useReactiveFetch();
  return useCallback<SolidFetch>((input, init) => rf.fetch(input, init), [rf]);
}

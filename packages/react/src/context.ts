import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { ReactiveFetch } from '@jeswr/solid-reactive-fetch';

export class ReactiveFetchProviderMissing extends Error {
  constructor(
    message = 'useReactiveFetch must be used within a <ReactiveFetchProvider>.',
  ) {
    super(message);
    this.name = 'ReactiveFetchProviderMissing';
  }
}

const ReactiveFetchContext = createContext<ReactiveFetch | null>(null);

export interface ReactiveFetchProviderProps {
  value: ReactiveFetch;
  children?: ReactNode;
}

export function ReactiveFetchProvider({
  value,
  children,
}: ReactiveFetchProviderProps) {
  return createElement(ReactiveFetchContext.Provider, { value }, children);
}

export function useReactiveFetch(): ReactiveFetch {
  const rf = useContext(ReactiveFetchContext);
  if (rf === null) throw new ReactiveFetchProviderMissing();
  return rf;
}

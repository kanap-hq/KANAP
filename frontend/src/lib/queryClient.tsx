import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { appQueryClient, retryQuery } from './appQueryClient';

export { retryQuery };

export function WithQueryClient({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={appQueryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

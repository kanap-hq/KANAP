import { QueryClient } from '@tanstack/react-query';

/**
 * Up to two more tries after a network or server failure. A refusal or a missing record (a 4xx
 * answer, except a timeout or a rate limit) is final: asking again only delays the message.
 */
export function retryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null | undefined)?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  return failureCount < 2;
}

/** The app's query cache. Code outside React reads what the screens already loaded from it (`catalogValueName`). */
export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: retryQuery,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

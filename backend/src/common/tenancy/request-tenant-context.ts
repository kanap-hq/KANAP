import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The request being served, for code far from the request that shares a
 * resource between users (the Markdown workers): the tenancy middleware runs
 * the rest of the request inside it.
 */
type RequestContext = {
  tenantId: string | null;
  /** The request itself: its user (`user.sub`) is set by the guards, after the middleware. */
  request: { user?: { sub?: unknown } | null } | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `work` as part of a request of `tenantId` (null: a request without
 * tenant). `request` gives the user of the request once it is authenticated.
 */
export function runWithRequestTenant<T>(
  tenantId: string | null | undefined,
  work: () => T,
  request: RequestContext['request'] = null,
): T {
  return storage.run({ tenantId: tenantId || null, request }, work);
}

/**
 * Runs `work` outside any request. Timers and jobs it creates (a cron job
 * scheduled again from an admin request, a task started by hand) do not keep
 * the request that created them as their own.
 */
export function runOutsideRequest<T>(work: () => T): T {
  return storage.exit(work);
}

/** The tenant of the request being served, or null outside a request of a tenant. */
export function currentRequestTenant(): string | null {
  return storage.getStore()?.tenantId ?? null;
}

/**
 * The request being served: its tenant and its authenticated user (null when
 * none yet), or null outside a request (scheduled tasks, startup work).
 */
export function currentRequestContext(): { tenantId: string | null; userId: string | null } | null {
  const context = storage.getStore();
  if (!context) return null;
  const sub = context.request?.user?.sub;
  return {
    tenantId: context.tenantId,
    userId: typeof sub === 'string' && sub ? sub : null,
  };
}

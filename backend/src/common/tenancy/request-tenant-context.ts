import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The tenant of the request being served, for code far from the request that
 * shares a resource between tenants (the Markdown workers): the tenancy
 * middleware runs the rest of the request inside it.
 */
const storage = new AsyncLocalStorage<string>();

/** Runs `work` with `tenantId` as the tenant of the current request (none: as it is). */
export function runWithRequestTenant<T>(tenantId: string | null | undefined, work: () => T): T {
  return tenantId ? storage.run(tenantId, work) : work();
}

/** The tenant of the request being served, or null outside a request of a tenant. */
export function currentRequestTenant(): string | null {
  return storage.getStore() ?? null;
}

import { Agent, fetch as undiciFetch } from 'undici';
import { pinnedLookup, PublicHttpTarget, PublicHttpTargetOptions, resolvePublicHttpTarget } from './ssrf-guard';

/**
 * An outbound HTTP target checked by resolvePublicHttpTarget, with the fetch to
 * reach it. When the checks returned validated addresses (multi-tenant mode, a
 * host that is not allowlisted), every connection goes to one of them: a
 * dispatcher of its own answers the name with them (pinnedLookup), while TLS
 * (SNI, certificate check) and the Host header keep the name from the URL.
 * Otherwise (single-tenant, allowlisted host) the global fetch is used as before.
 *
 * `close()` releases the dispatcher. Call it once the response body has been
 * read, or given up, in a `finally`.
 */
export type ValidatedFetchTarget = {
  url: URL;
  /** Set when the connection is bound to the validated addresses. */
  dispatcher: Agent | null;
  fetch: typeof fetch;
  close(): Promise<void>;
};

/** A dispatcher whose connections go to the validated addresses, or null when nothing is pinned. */
export function createPinnedDispatcher(target: PublicHttpTarget): Agent | null {
  if (!target.addresses) return null;
  return new Agent({ connect: { lookup: pinnedLookup(target.url.hostname, target.addresses) } });
}

export function fetchForTarget(target: PublicHttpTarget): ValidatedFetchTarget {
  const dispatcher = createPinnedDispatcher(target);
  if (!dispatcher) {
    return {
      url: target.url,
      dispatcher: null,
      // Read when called, so the global fetch in use at that moment is the one called.
      fetch: ((input: any, init?: any) => globalThis.fetch(input, init)) as typeof fetch,
      close: async () => undefined,
    };
  }
  let closed = false;
  return {
    url: target.url,
    dispatcher,
    // undici's own fetch, of the same version as the dispatcher.
    fetch: ((input: any, init?: any) => undiciFetch(input, { ...(init ?? {}), dispatcher })) as unknown as typeof fetch,
    close: async () => {
      if (closed) return;
      closed = true;
      // destroy(), not close(): a response body left unread must not keep it open.
      await dispatcher.destroy().catch(() => undefined);
    },
  };
}

/** resolvePublicHttpTarget, then the fetch bound to what it validated. */
export async function openValidatedFetch(
  target: string | URL,
  opts?: PublicHttpTargetOptions,
): Promise<ValidatedFetchTarget> {
  return fetchForTarget(await resolvePublicHttpTarget(target, opts));
}

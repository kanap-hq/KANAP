import { Features } from '../config/features';

export type DiscoveryCallConfig = {
  /** The booking page (Cal.com), opened by the "Book a discovery call" button. Empty: no button. */
  url: string;
  /** The address offered when no booking page is set. */
  fallbackEmail: string;
  /** The shared secret of the Cal.com webhook. Empty: the webhook route answers 404. */
  webhookSecret: string;
};

const EMPTY: DiscoveryCallConfig = { url: '', fallbackEmail: '', webhookSecret: '' };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function httpUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/**
 * The discovery call of trial workspaces (`doc/discovery-call.md`): DISCOVERY_CALL_URL,
 * DISCOVERY_CALL_FALLBACK_EMAIL and DISCOVERY_CALL_WEBHOOK_SECRET, all empty by default. Cloud
 * only: on-premise every value is empty, whatever the environment says. A URL that is not http(s)
 * and an address that is not one count as empty. Read at each call, so a spec can set the
 * environment.
 */
export function discoveryCallConfig(env: NodeJS.ProcessEnv = process.env): DiscoveryCallConfig {
  if (Features.SINGLE_TENANT) return EMPTY;
  const fallbackEmail = (env.DISCOVERY_CALL_FALLBACK_EMAIL ?? '').trim();
  return {
    url: httpUrl((env.DISCOVERY_CALL_URL ?? '').trim()),
    fallbackEmail: EMAIL.test(fallbackEmail) ? fallbackEmail : '',
    webhookSecret: (env.DISCOVERY_CALL_WEBHOOK_SECRET ?? '').trim(),
  };
}

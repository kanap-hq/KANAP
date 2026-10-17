import { parseBoolean } from '../common/env';
import { hasConfiguredEmailTransport } from '../email/email-config';

const deploymentMode = (process.env.DEPLOYMENT_MODE || '').trim().toLowerCase();
const isSingleTenant = deploymentMode === 'single-tenant';

export const Features = {
  DEPLOYMENT_MODE: isSingleTenant ? ('single-tenant' as const) : ('multi-tenant' as const),
  SINGLE_TENANT: isSingleTenant,
  STRIPE_BILLING: !isSingleTenant && !!process.env.STRIPE_SECRET_KEY,
  ENTRA_SSO: !!process.env.ENTRA_CLIENT_ID,
  EMAIL_ENABLED: hasConfiguredEmailTransport(),
  AI_CHAT_ENABLED: parseBoolean(process.env.AI_CHAT_ENABLED),
  AI_MCP_ENABLED: parseBoolean(process.env.AI_MCP_ENABLED),
  AI_SETTINGS_ENABLED: parseBoolean(process.env.AI_SETTINGS_ENABLED),
  AI_WEB_SEARCH_READY: !!process.env.BRAVE_SEARCH_API_KEY,
  // The NVD feed needs the way out to the NVD or a mirror (NVD_API_BASE_URL): on by default in the
  // cloud, off by default on-premise. VULNERABILITY_FEED_ENABLED set either way wins.
  VULNERABILITY_FEED_ENABLED: (process.env.VULNERABILITY_FEED_ENABLED ?? '').trim()
    ? parseBoolean(process.env.VULNERABILITY_FEED_ENABLED)
    : !isSingleTenant,
};

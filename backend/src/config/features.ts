import { parseDeploymentMode } from '../common/deployment-mode';
import { parseBoolean } from '../common/env';
import { hasConfiguredEmailTransport } from '../email/email-config';

// Throws at load on any value other than single-tenant, multi-tenant or unset (unset is
// multi-tenant). validateStartupEnv repeats the check for an env object passed to it.
const deploymentMode = parseDeploymentMode(process.env.DEPLOYMENT_MODE);
const isSingleTenant = deploymentMode === 'single-tenant';
const vulnerabilityFeedEnabled = (process.env.VULNERABILITY_FEED_ENABLED ?? '').trim()
  ? parseBoolean(process.env.VULNERABILITY_FEED_ENABLED)
  : !isSingleTenant;

export const Features = {
  DEPLOYMENT_MODE: deploymentMode,
  SINGLE_TENANT: isSingleTenant,
  STRIPE_BILLING: !isSingleTenant && !!process.env.STRIPE_SECRET_KEY,
  ENTRA_SSO: !!process.env.ENTRA_CLIENT_ID,
  EMAIL_ENABLED: hasConfiguredEmailTransport(),
  AI_CHAT_ENABLED: parseBoolean(process.env.AI_CHAT_ENABLED),
  AI_MCP_ENABLED: parseBoolean(process.env.AI_MCP_ENABLED),
  AI_SETTINGS_ENABLED: parseBoolean(process.env.AI_SETTINGS_ENABLED),
  AI_WEB_SEARCH_READY: !!process.env.BRAVE_SEARCH_API_KEY,
  // The living catalog of technologies reads endoflife.date (or ENDOFLIFE_API_BASE_URL): on by
  // default in the cloud, off by default on-premise, where the catalog shipped with each version is
  // synced at start. TECHNOLOGY_CATALOG_SYNC_ENABLED set either way wins.
  TECHNOLOGY_CATALOG_SYNC_ENABLED: (process.env.TECHNOLOGY_CATALOG_SYNC_ENABLED ?? '').trim()
    ? parseBoolean(process.env.TECHNOLOGY_CATALOG_SYNC_ENABLED)
    : !isSingleTenant,
  // The NVD feed needs the way out to the NVD or a mirror (NVD_API_BASE_URL): on by default in the
  // cloud, off by default on-premise. VULNERABILITY_FEED_ENABLED set either way wins.
  VULNERABILITY_FEED_ENABLED: vulnerabilityFeedEnabled,
  // The CVE.org list (cvelistV5). Defaults to the vulnerability feed; CVE_LIST_FEED_ENABLED set
  // either way wins. The collector also stays idle while the vulnerability feed itself is off.
  CVE_LIST_FEED_ENABLED: (process.env.CVE_LIST_FEED_ENABLED ?? '').trim()
    ? parseBoolean(process.env.CVE_LIST_FEED_ENABLED)
    : vulnerabilityFeedEnabled,
};

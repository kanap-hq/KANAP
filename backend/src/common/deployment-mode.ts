/** Accepted `DEPLOYMENT_MODE` values. A blank or missing value means `multi-tenant`. */
export const DEPLOYMENT_MODE_VALUES = ['single-tenant', 'multi-tenant'] as const;
export type DeploymentMode = (typeof DEPLOYMENT_MODE_VALUES)[number];

/**
 * `single-tenant`, `multi-tenant`, or unset (blank means `multi-tenant`, the cloud default).
 * Any other value throws, so a typo such as `single_tenant` cannot start the API as multi-tenant.
 * No imports: `features.ts` calls this while its own module is still loading.
 */
export function parseDeploymentMode(raw: string | undefined): DeploymentMode {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'multi-tenant') return 'multi-tenant';
  if (value === 'single-tenant') return 'single-tenant';
  const shown = (raw ?? '').trim();
  throw new Error(
    `FATAL: DEPLOYMENT_MODE is ${JSON.stringify(shown)}. Accepted values are single-tenant, multi-tenant, or unset (unset means multi-tenant).`,
  );
}

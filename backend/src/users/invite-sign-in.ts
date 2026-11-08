import { BadRequestException } from '@nestjs/common';
import type { Tenant } from '../tenants/tenant.entity';

/** How an invited person will sign in: with a password they set from the link, or with Microsoft. */
export type InviteSignIn = 'password' | 'microsoft';

/** A workspace whose people can sign in with Microsoft Entra: connected and turned on. */
export function tenantSignsInWithEntra(
  tenant: Pick<Tenant, 'sso_provider' | 'sso_enabled' | 'entra_tenant_id'> | null | undefined,
): boolean {
  return tenant?.sso_provider === 'entra' && !!tenant.sso_enabled && !!tenant.entra_tenant_id;
}

/** `sign_in` of an invitation request; absent means a password link, as before the choice existed. */
export function parseInviteSignIn(raw: unknown): InviteSignIn {
  if (raw == null || raw === '') return 'password';
  if (raw === 'password' || raw === 'microsoft') return raw;
  throw new BadRequestException("sign_in must be 'password' or 'microsoft'");
}

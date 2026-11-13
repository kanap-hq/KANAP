import * as assert from 'node:assert/strict';
import 'reflect-metadata';
import { PublicController } from '../public.controller';
import { Features } from '../../config/features';

/**
 * `GET /public/tenant-info` tells the sign-in page whether "Sign in with Microsoft" works for the
 * workspace (`microsoftSignIn`): only when the installation has Microsoft sign-in and the workspace
 * is connected to a directory. Nothing more about the connection: no directory id, no name.
 */

function controller(tenantRow: Record<string, unknown>) {
  const instance = Object.create(PublicController.prototype) as PublicController;
  (instance as any).tenants = { findById: async () => ({ name: 'Acme', branding: {}, ...tenantRow }) };
  return instance;
}

const CONNECTED = { sso_provider: 'entra', sso_enabled: true, entra_tenant_id: 'directory-id', entra_metadata: { display_name: 'Acme directory' } };
const NOT_CONNECTED = { sso_provider: 'none', sso_enabled: false, entra_tenant_id: null, entra_metadata: null };

async function infoFor(tenantRow: Record<string, unknown>, featureOn: boolean): Promise<any> {
  const flags = Features as { ENTRA_SSO: boolean };
  const previous = flags.ENTRA_SSO;
  flags.ENTRA_SSO = featureOn;
  try {
    return await controller(tenantRow).tenantInfo({ tenant: { id: 't1', slug: 'acme' } });
  } finally {
    flags.ENTRA_SSO = previous;
  }
}

async function main() {
  const connected = await infoFor(CONNECTED, true);
  assert.equal(connected.microsoftSignIn, true, 'a connected workspace');
  assert.equal(JSON.stringify(connected).includes('directory-id'), false, 'the directory id is not given');
  assert.equal(JSON.stringify(connected).includes('Acme directory'), false, 'nor its name');

  assert.equal((await infoFor(NOT_CONNECTED, true)).microsoftSignIn, false, 'a workspace not connected');
  assert.equal((await infoFor(CONNECTED, false)).microsoftSignIn, false, 'an installation without Microsoft sign-in');
  console.log('tenant-info-microsoft-sign-in.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

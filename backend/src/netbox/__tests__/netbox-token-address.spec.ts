import * as assert from 'node:assert/strict';
import { NETBOX_PROVIDER_KEY, NETBOX_PROVIDER_KIND, NetboxConfigService } from '../netbox-config.service';
import { NetboxSyncService } from '../netbox-sync.service';

// The connection test sends the stored token only to the stored address. Testing
// another address needs the token typed in the request; another spelling of the
// stored address (host case, trailing slash, default port) is the same address.

const STORED_URL = 'https://netbox.example.com';

function harness() {
  const config = {
    id: 'cfg-1',
    tenant_id: 'tenant-1',
    provider_kind: NETBOX_PROVIDER_KIND,
    provider_key: NETBOX_PROVIDER_KEY,
    enabled: true,
    base_url: STORED_URL,
    credential_ref_json: { kind: 'encrypted', ciphertext: 'enc:stored-token', material_shape: 'api_token' },
    metadata_json: {},
    timeout_seconds: null,
  };
  const manager = {
    getRepository: () => ({ findOne: async () => config }),
    query: async () => [{ n: 1 }],
  } as any;
  const configService = new NetboxConfigService({
    canEncrypt: () => true,
    decrypt: (value: string) => value.replace(/^enc:/, ''),
  } as any);
  const calls: Array<{ baseUrl: string; token: string }> = [];
  const client = {
    getVersion: async (connection: { baseUrl: string; token: string }) => {
      calls.push({ baseUrl: connection.baseUrl, token: connection.token });
      return '4.1.0';
    },
  };
  const sync = new NetboxSyncService({} as any, configService, client as any, {} as any, {} as any, {} as any);
  return { manager, sync, calls };
}

async function main() {
  {
    const { manager, sync, calls } = harness();
    const result = await sync.testConnection(manager, 'tenant-1', { base_url: 'https://netbox-new.example.com' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'netbox_token_needed_for_address');
    assert.equal(calls.length, 0, 'no request leaves for another address without its token');
    console.log('ok - another address without a token is not tested with the stored token');
  }
  {
    const { manager, sync, calls } = harness();
    const result = await sync.testConnection(manager, 'tenant-1', {
      base_url: 'https://netbox2.example.com',
      api_token: 'typed-token',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(calls, [{ baseUrl: 'https://netbox2.example.com', token: 'typed-token' }]);
    console.log('ok - another address with a typed token is tested with that token');
  }
  for (const spelling of [STORED_URL, 'https://NetBox.Example.com:443/', undefined]) {
    const { manager, sync, calls } = harness();
    const result = await sync.testConnection(manager, 'tenant-1', spelling ? { base_url: spelling } : {});
    assert.equal(result.ok, true, String(spelling));
    assert.equal(calls[0]?.token, 'stored-token', String(spelling));
  }
  console.log('ok - the stored address, however spelled, is tested with the stored token');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

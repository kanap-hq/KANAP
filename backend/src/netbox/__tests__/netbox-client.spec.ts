import * as assert from 'node:assert/strict';
import { Features } from '../../config/features';
import { LookupFn } from '../../common/ssrf-guard';
import {
  NetboxClient,
  NetboxHttpLike,
  netboxAuthorizationHeader,
  sanitizeNetboxText,
} from '../netbox.client';
import { NetboxApiError, NetboxConnection } from '../netbox.types';

// Transport spec for the Netbox client: a fake HTTP implementation stands in
// for node:https, exactly the way the PRTG spec fakes fetch. Runs standalone
// under ts-node.

const SECRET_TOKEN = 'super-secret-netbox-token-0123456789';
const BASE_URL = 'https://netbox.example.test';

// The request-time SSRF guard would otherwise try to resolve this reserved
// .test hostname. The allowlist short-circuits before DNS; a literal private
// IP stays blocked, which the dedicated case below checks.
process.env.SSRF_ALLOWED_HOSTS = 'netbox.example.test';

type Route = (url: URL) => { status?: number; json?: unknown; text?: string } | never;

function createClient(route: Route, token = SECRET_TOKEN) {
  const requests: Array<{ url: URL; headers: Record<string, string>; insecureTls: boolean }> = [];
  const httpImpl: NetboxHttpLike = async (input, request) => {
    const url = new URL(input);
    requests.push({ url, headers: request.headers, insecureTls: request.insecureTls });
    const result = route(url);
    return {
      status: result.status ?? 200,
      body: result.text ?? JSON.stringify(result.json ?? {}),
      contentType: 'application/json',
    };
  };
  const connection: NetboxConnection = { baseUrl: BASE_URL, token, insecureTls: false, requestTimeoutMs: null };
  return { client: new NetboxClient(httpImpl), connection, requests };
}

function deviceRecord(id: number) {
  return {
    id,
    name: `par-esx-${id}`,
    role: { slug: 'server', name: 'Server' },
    site: { slug: 'paris', name: 'Paris DC' },
    status: { value: 'active' },
  };
}

async function expectError(promise: Promise<unknown>): Promise<NetboxApiError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof NetboxApiError, `expected a NetboxApiError, got ${String(error)}`);
    return error;
  }
  throw new Error('expected the call to fail');
}

async function main() {
  // --- authorization header --------------------------------------------------

  assert.equal(netboxAuthorizationHeader('abcdef'), 'Token abcdef');
  // Netbox reads the token version from the value, so the keyword never changes.
assert.equal(netboxAuthorizationHeader('nbt_key1.secret'), 'Token nbt_key1.secret');
assert.equal(netboxAuthorizationHeader('  padded  '), 'Token padded');

  {
    const { client, connection, requests } = createClient(() => ({ json: { 'netbox-version': '3.7.4' } }));
    const version = await client.getVersion(connection);
    assert.equal(version, '3.7.4');
    assert.equal(requests[0].headers.Authorization, `Token ${SECRET_TOKEN}`);
    assert.equal(requests[0].url.pathname, '/api/status/');
  }

  {
    const { client, connection, requests } = createClient(() => ({ json: { 'netbox-version': '4.1.0' } }), 'nbt_key1.secret');
    await client.getVersion(connection);
    assert.equal(requests[0].headers.Authorization, 'Token nbt_key1.secret');
  }

  // --- pagination ------------------------------------------------------------

  {
    // Three pages of 200. `next` points at a completely different host: it must
    // be ignored and the offsets computed from `count`.
    const total = 450;
    const { client, connection, requests } = createClient((url) => {
      const offset = Number(url.searchParams.get('offset'));
      const limit = Number(url.searchParams.get('limit'));
      const results = [];
      for (let index = offset; index < Math.min(offset + limit, total); index += 1) {
        results.push(deviceRecord(index + 1));
      }
      return { json: { count: total, next: 'http://169.254.169.254/latest/meta-data/', results } };
    });

    const { objects: devices, complete } = await client.listDevices(connection);
    assert.equal(complete, true);
    assert.equal(devices.length, total);
    assert.equal(devices[0].id, '1');
    assert.equal(devices[total - 1].id, String(total));
    assert.deepEqual(requests.map((request) => request.url.searchParams.get('offset')), ['0', '200', '400']);
    assert.deepEqual(requests.map((request) => request.url.host), [
      'netbox.example.test',
      'netbox.example.test',
      'netbox.example.test',
    ]);
    // The heavy config_context blob is never asked for.
    assert.equal(requests[0].url.searchParams.get('exclude'), 'config_context');
  }

  {
    // A last page that comes back short stops the walk even if `count` disagrees.
    const { client, connection, requests } = createClient((url) => (
      Number(url.searchParams.get('offset')) === 0
        ? { json: { count: 5000, next: `${BASE_URL}/api/dcim/devices/?offset=200`, results: [deviceRecord(1)] } }
        : { json: { count: 5000, next: null, results: [] } }
    ));
    const { objects: devices, complete } = await client.listDevices(connection);
    assert.equal(devices.length, 1);
    assert.equal(complete, true);
    assert.equal(requests.length, 2);
  }

  {
    const { client, connection, requests } = createClient(() => ({
      json: { count: 1, next: null, results: [{ id: 3, name: 'par-app-01', role: { slug: 'vm' }, site: { slug: 'paris' } }] },
    }));
    const { objects: vms } = await client.listVirtualMachines(connection);
    assert.equal(vms.length, 1);
    assert.equal(vms[0].type, 'vm');
    assert.equal(requests[0].url.pathname, '/api/virtualization/virtual-machines/');
  }

  {
    const { client, connection, requests } = createClient((url) => (
      url.pathname === '/api/dcim/device-roles/'
        ? { json: { count: 1, next: null, results: [{ slug: 'server', name: 'Server', device_count: 12, virtualmachine_count: 7 }] } }
        : { json: { count: 1, next: null, results: [{ slug: 'paris', name: 'Paris DC', device_count: 12, virtualmachine_count: 4 }] } }
    ));
    // Virtual machines never go through a Netbox role in KANAP, so the count a
    // role reports for them is deliberately flattened to zero.
    assert.deepEqual(await client.listRoles(connection), [
      { slug: 'server', name: 'Server', device_count: 12, vm_count: 0 },
    ]);
    assert.deepEqual(await client.listSites(connection), [
      { slug: 'paris', name: 'Paris DC', device_count: 12, vm_count: 4 },
    ]);
    assert.deepEqual(requests.map((request) => request.url.pathname), ['/api/dcim/device-roles/', '/api/dcim/sites/']);
  }

  {
    // Locations are read whole, with the parent link the walk up to the top
    // level needs, and the deep link the sub-location carries.
    const { client, connection, requests } = createClient(() => ({
      json: {
        count: 2,
        next: null,
        results: [
          { id: 1, name: 'Building A', description: 'North wing', parent: null, site: { slug: 'paris' } },
          { id: 2, name: 'Floor 1', description: '', parent: { id: 1 }, site: { slug: 'paris' } },
        ],
      },
    }));
    const { locations, complete } = await client.listLocations(connection);
    assert.equal(complete, true);
    assert.equal(requests[0].url.pathname, '/api/dcim/locations/');
    assert.deepEqual(locations, [
      {
        id: '1',
        name: 'Building A',
        description: 'North wing',
        parentId: null,
        siteSlug: 'paris',
        url: 'https://netbox.example.test/dcim/locations/1/',
      },
      {
        id: '2',
        name: 'Floor 1',
        description: null,
        parentId: '1',
        siteSlug: 'paris',
        url: 'https://netbox.example.test/dcim/locations/2/',
      },
    ]);
  }

  {
    // A truncated walk must not be mistaken for the whole tree: the caller only
    // attaches equipment from a list it knows is complete.
    let call = 0;
    const { client, connection } = createClient(() => {
      call += 1;
      return {
        json: {
          count: 100000,
          next: 'https://netbox.example.test/api/dcim/locations/?offset=200',
          results: [{ id: call, name: `Location ${call}`, parent: null, site: { slug: 'paris' } }],
        },
      };
    });
    const { complete } = await client.listLocations(connection);
    assert.equal(complete, false);
  }

  {
    // The device's own Location is read from the brief object Netbox nests in
    // the device payload; a virtual machine has none.
    const { client, connection } = createClient((url) => (
      url.pathname === '/api/dcim/devices/'
        ? { json: { count: 1, next: null, results: [{ id: 7, name: 'par-esx-01', site: { slug: 'paris' }, location: { id: 4, name: 'Room 101' } }] } }
        : { json: { count: 1, next: null, results: [{ id: 8, name: 'par-vm-01', site: { slug: 'paris' }, location: { id: 4, name: 'Room 101' } }] } }
    ));
    const { objects: devices } = await client.listDevices(connection);
    assert.equal(devices[0].locationId, '4');
    const { objects: vms } = await client.listVirtualMachines(connection);
    assert.equal(vms[0].locationId, null, 'a Netbox VM carries no location');
  }

  {
    // The virtual-machine total is read from `count`, without fetching any.
    const { client, connection, requests } = createClient(() => ({
      json: { count: 12, next: null, results: [{ id: 1, name: 'par-app-01' }] },
    }));
    assert.equal(await client.countVirtualMachines(connection), 12);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url.searchParams.get('limit'), '1');
    assert.equal(requests[0].url.pathname, '/api/virtualization/virtual-machines/');
  }

  {
    // Netbox sends no usable `count`. Reading that as zero used to end the walk
    // after one page, and the run then flagged the whole rest of the inventory
    // as gone. The walk must run until a page is empty or `next` is null.
    const pages = [
      { next: 'https://netbox.example.test/api/dcim/devices/?offset=200', results: [deviceRecord(1)] },
      { next: 'https://netbox.example.test/api/dcim/devices/?offset=400', results: [deviceRecord(2)] },
      { next: null, results: [deviceRecord(3)] },
    ];
    for (const count of [undefined, null, 'lots']) {
      let call = 0;
      const { client, connection } = createClient(() => {
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        return { json: { ...(count === undefined ? {} : { count }), next: page.next, results: page.results } };
      });
      const { objects, complete } = await client.listDevices(connection);
      assert.equal(objects.length, 3, `count=${String(count)}`);
      assert.equal(complete, true);
    }
  }

  {
    // A Netbox that never stops: the walk gives up at the page cap and says so,
    // so the caller knows the inventory it holds is partial.
    const { client, connection, requests } = createClient((url) => ({
      json: {
        count: 10_000_000,
        next: `${BASE_URL}/api/dcim/devices/?offset=${Number(url.searchParams.get('offset')) + 200}`,
        results: [deviceRecord(1)],
      },
    }));
    const { complete } = await client.listDevices(connection);
    assert.equal(complete, false, 'an incomplete walk must not look complete');
    assert.equal(requests.length, 200, 'the page cap holds');
  }

  {
    // One object at a time, for a single-record action.
    const { client, connection, requests } = createClient((url) => (
      url.pathname === '/api/dcim/devices/7/'
        ? { json: { id: 7, name: 'par-web-07', role: { slug: 'server' }, site: { slug: 'paris' } } }
        : { json: { id: 50, name: 'par-app-01', site: { slug: 'paris' } } }
    ));
    const device = await client.getDevice(connection, '7');
    assert.equal(device.id, '7');
    assert.equal(device.type, 'device');
    const vm = await client.getVirtualMachine(connection, '50');
    assert.equal(vm.type, 'vm');
    assert.deepEqual(
      requests.map((request) => request.url.pathname),
      ['/api/dcim/devices/7/', '/api/virtualization/virtual-machines/50/'],
    );
    assert.equal(requests[0].url.searchParams.get('exclude'), 'config_context');
  }

  {
    // An object Netbox has forgotten says so in plain words.
    const { client, connection } = createClient(() => ({ status: 404, text: '{"detail":"Not found."}' }));
    const error = await expectError(client.getDevice(connection, '7'));
    assert.equal(error.errorCode, 'not_found');
    assert.match(error.message, /does not list this object any more/);
  }

  // --- error taxonomy --------------------------------------------------------

  {
    const cases: Array<[number, string]> = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'provider_unavailable'],
      [418, 'invalid_response'],
    ];
    for (const [status, code] of cases) {
      const { client, connection } = createClient(() => ({ status, text: 'nope' }));
      const error = await expectError(client.listDevices(connection));
      assert.equal(error.errorCode, code, `HTTP ${status}`);
      assert.doesNotMatch(error.message, new RegExp(SECRET_TOKEN), 'the token must never appear in an error');
    }
  }

  {
    // A redirect is never followed.
    const { client, connection } = createClient(() => ({ status: 302, text: '' }));
    const error = await expectError(client.listDevices(connection));
    assert.equal(error.errorCode, 'invalid_response');
    assert.match(error.message, /redirects/);
  }

  {
    // A login portal in front of Netbox answers with HTML.
    const { client, connection } = createClient(() => ({ text: '<!DOCTYPE html><html><body>Sign in</body></html>' }));
    const error = await expectError(client.listDevices(connection));
    assert.equal(error.errorCode, 'invalid_response');
    assert.match(error.message, /web page instead of data/);
  }

  {
    // A 200 that is not a list payload.
    const { client, connection } = createClient(() => ({ json: { detail: 'hello' } }));
    assert.equal((await expectError(client.listDevices(connection))).errorCode, 'invalid_response');
  }

  {
    // Certificate errors get their own code and point at the right setting.
    const { client, connection } = createClient(() => {
      throw Object.assign(new Error('self signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    });
    const error = await expectError(client.listDevices(connection));
    assert.equal(error.errorCode, 'tls_untrusted');
    assert.match(error.message, /Ignore certificate/);
  }

  {
    const { client, connection } = createClient(() => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    });
    assert.equal((await expectError(client.listDevices(connection))).errorCode, 'timeout');
  }

  {
    // A transport error that echoes the request, token and all, is scrubbed.
    const { client, connection } = createClient(() => {
      throw Object.assign(new Error(`connect ECONNREFUSED with Authorization: Token ${SECRET_TOKEN}`), { code: 'ECONNREFUSED' });
    });
    const error = await expectError(client.listDevices(connection));
    assert.equal(error.errorCode, 'provider_unavailable');
    assert.doesNotMatch(error.message, new RegExp(SECRET_TOKEN));
  }

  assert.equal(sanitizeNetboxText(`Token ${SECRET_TOKEN}`, SECRET_TOKEN), 'Token ***');
  assert.equal(sanitizeNetboxText('Bearer nbt_whatever'), 'Bearer ***');

  // --- SSRF guard ------------------------------------------------------------

  {
    // A private literal is refused before the transport is ever called, even
    // though the request would otherwise be perfectly well formed.
    let called = false;
    const httpImpl: NetboxHttpLike = async () => {
      called = true;
      return { status: 200, body: '{}', contentType: 'application/json' };
    };
    const client = new NetboxClient(httpImpl);
    const connection: NetboxConnection = {
      baseUrl: 'https://10.0.0.5',
      token: SECRET_TOKEN,
      insecureTls: false,
      requestTimeoutMs: null,
    };
    await assert.rejects(
      client.listDevices({ ...connection, requestTimeoutMs: null }),
      (error: any) => /private or internal/i.test(String(error?.message || '')),
    );
    assert.equal(called, false, 'no request may be attempted for a blocked target');
  }

  {
    // Multi-tenant, host not allowlisted: the transport receives a lookup that
    // answers with the address validated before the request.
    const originalSingleTenant = Features.SINGLE_TENANT;
    (Features as any).SINGLE_TENANT = false;
    try {
      let resolutions = 0;
      const addressLookup: LookupFn = async () => {
        resolutions += 1;
        return [{ address: '93.184.216.34' }];
      };
      const seen: Array<{ host: string; lookup: unknown }> = [];
      const httpImpl: NetboxHttpLike = async (input, request) => {
        seen.push({ host: new URL(input).hostname, lookup: request.lookup });
        return { status: 200, body: JSON.stringify({ 'netbox-version': '4.1.0' }), contentType: 'application/json' };
      };
      const client = new NetboxClient(httpImpl, addressLookup);
      const pinnedHost = 'netbox-public.example.test';
      const version = await client.getVersion({
        baseUrl: `https://${pinnedHost}`,
        token: SECRET_TOKEN,
        insecureTls: false,
        requestTimeoutMs: null,
      });
      assert.equal(version, '4.1.0');
      assert.equal(resolutions, 1);
      assert.equal(seen.length, 1);
      assert.equal(typeof seen[0].lookup, 'function', 'the transport receives the pinned lookup');
      const answer = await new Promise<{ error: unknown; address: unknown }>((resolve) => {
        (seen[0].lookup as any)(pinnedHost, {}, (error: unknown, address: unknown) => resolve({ error, address }));
      });
      assert.equal(answer.error, null);
      assert.equal(answer.address, '93.184.216.34');

      // An allowlisted host is not resolved, so nothing is pinned.
      seen.length = 0;
      await client.getVersion({ baseUrl: BASE_URL, token: SECRET_TOKEN, insecureTls: false, requestTimeoutMs: null });
      assert.equal(resolutions, 1);
      assert.equal(seen[0].lookup, undefined);
    } finally {
      (Features as any).SINGLE_TENANT = originalSingleTenant;
    }
  }
}

main().then(() => console.log('netbox-client.spec.ts OK')).catch((error) => {
  console.error(error);
  process.exit(1);
});

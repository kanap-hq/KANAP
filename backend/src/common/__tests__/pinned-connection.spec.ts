import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';
import { AddressInfo, LookupFunction } from 'node:net';
import { TLSSocket } from 'node:tls';
import { backendPath } from './backend-root';
import { LookupFn, pinnedLookup, resolvePublicHttpTarget, ValidatedAddress } from '../ssrf-guard';

// After the checks, a request connects to the address that was validated, never to
// one obtained by resolving the name a second time. The host name from the URL is
// kept for TLS (SNI and certificate check) and for the Host header.

// Names below are never resolved through DNS: only the pinned lookup answers them.
const PINNED_HOST = 'pinned-host.example.test';

// Self-signed certificate for localhost / 127.0.0.1 (shared with the Netbox specs).
const FIXTURES = backendPath('src', 'netbox', '__tests__', 'fixtures');
const CERT = fs.readFileSync(path.join(FIXTURES, 'netbox-test-cert.pem'));
const KEY = fs.readFileSync(path.join(FIXTURES, 'netbox-test-key.pem'));

function recordingLookup(inner: LookupFunction, seen: string[]): LookupFunction {
  return (hostname, options, callback) => {
    inner(hostname, options, (error, address, family) => {
      if (!error) {
        const list = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
        seen.push(...list);
      }
      callback(error, address, family);
    });
  };
}

function lookupOnce(fn: LookupFunction, hostname: string, options: Record<string, unknown>) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family?: number }>((resolve) => {
    fn(hostname, options as any, (error, address, family) => resolve({ error, address, family }));
  });
}

async function testResolveReturnsTheValidatedAddresses() {
  let calls = 0;
  const lookupFn: LookupFn = async () => {
    calls += 1;
    return [{ address: '93.184.216.34' }, { address: '2606:4700:4700::1111' }];
  };
  const target = await resolvePublicHttpTarget(`https://${PINNED_HOST}/v1`, { enforcePrivateBlock: true, lookupFn });
  assert.equal(calls, 1);
  assert.equal(target.url.hostname, PINNED_HOST);
  assert.deepEqual(target.addresses, [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ]);

  // Single-tenant: no resolution, nothing pinned.
  const onPrem = await resolvePublicHttpTarget('http://10.0.0.5/', { enforcePrivateBlock: false, lookupFn });
  assert.equal(onPrem.addresses, null);
  assert.equal(calls, 1);
}

async function testPinnedLookupAnswers() {
  const addresses: ValidatedAddress[] = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:4700:4700::1111', family: 6 },
  ];
  const fn = pinnedLookup(PINNED_HOST, addresses);

  const single = await lookupOnce(fn, PINNED_HOST, {});
  assert.equal(single.error, null);
  assert.equal(single.address, '93.184.216.34');
  assert.equal(single.family, 4);

  const all = await lookupOnce(fn, PINNED_HOST, { all: true });
  assert.deepEqual(all.address, addresses);

  const v6 = await lookupOnce(fn, PINNED_HOST, { family: 6 });
  assert.equal(v6.address, '2606:4700:4700::1111');

  // Another name gets no answer.
  const other = await lookupOnce(fn, 'other.example.test', {});
  assert.equal(other.error?.code, 'ENOTFOUND');
}

async function testHttpConnectionUsesTheValidatedAddress() {
  const hosts: string[] = [];
  const peers: string[] = [];
  const server = http.createServer((req, res) => {
    hosts.push(String(req.headers.host));
    peers.push(String(req.socket.remoteAddress));
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const seen: string[] = [];
  try {
    // Stand-in for a validated public address: the loopback test server.
    const lookup = recordingLookup(pinnedLookup(PINNED_HOST, [{ address: '127.0.0.1', family: 4 }]), seen);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`http://${PINNED_HOST}:${port}/`, { lookup, agent: false }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 200);
    assert.deepEqual(seen, ['127.0.0.1'], 'the connector receives the validated address');
    assert.deepEqual(hosts, [`${PINNED_HOST}:${port}`], 'the Host header keeps the name from the URL');
    assert.match(peers[0], /127\.0\.0\.1$/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testTlsKeepsTheHostNameFromTheUrl() {
  const serverNames: Array<string | false> = [];
  const server = https.createServer({ key: KEY, cert: CERT }, (_req, res) => res.end('ok'));
  server.on('secureConnection', (socket: TLSSocket) => {
    serverNames.push((socket as TLSSocket & { servername?: string | false }).servername ?? false);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const request = (hostname: string, seen: string[]) => new Promise<number>((resolve, reject) => {
    const lookup = recordingLookup(pinnedLookup(hostname, [{ address: '127.0.0.1', family: 4 }]), seen);
    const req = https.request(`https://${hostname}:${port}/`, { lookup, ca: CERT, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
  try {
    // The certificate names localhost: verified against the URL's host name.
    const seen: string[] = [];
    assert.equal(await request('localhost', seen), 200);
    assert.deepEqual(seen, ['127.0.0.1']);
    assert.deepEqual(serverNames, ['localhost'], 'SNI carries the host name from the URL');

    // Same pinned address, another host name: the certificate (which also lists
    // 127.0.0.1) is checked against the name, so the connection is refused.
    const seenOther: string[] = [];
    await assert.rejects(
      request(PINNED_HOST, seenOther),
      (error: NodeJS.ErrnoException) => error.code === 'ERR_TLS_CERT_ALTNAME_INVALID',
    );
    assert.deepEqual(seenOther, ['127.0.0.1']);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function run() {
  await testResolveReturnsTheValidatedAddresses();
  await testPinnedLookupAnswers();
  await testHttpConnectionUsesTheValidatedAddress();
  await testTlsKeepsTheHostNameFromTheUrl();
  console.log('pinned-connection.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

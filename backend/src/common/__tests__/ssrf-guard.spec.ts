import * as assert from 'node:assert/strict';
import { assertPublicHttpUrl, assertPublicHttpTarget, embeddedIpv4Address, LookupFn } from '../ssrf-guard';

const ENFORCE = { enforcePrivateBlock: true } as const;
const SKIP = { enforcePrivateBlock: false } as const;

function throws(fn: () => unknown) {
  assert.throws(fn);
}

async function rejects(p: Promise<unknown>) {
  await assert.rejects(p);
}

async function run() {
  // --- parse / protocol / credentials (always enforced) ---
  throws(() => assertPublicHttpUrl('not a url', ENFORCE));
  throws(() => assertPublicHttpUrl('ftp://example.com', ENFORCE));
  throws(() => assertPublicHttpUrl('http://user:pass@example.com', ENFORCE));
  throws(() => assertPublicHttpUrl('', ENFORCE));

  // --- literal internal IPs / localhost / *.local blocked when enforcing ---
  for (const bad of [
    'http://127.0.0.1', 'http://10.0.0.5', 'http://169.254.169.254',
    'http://192.168.1.1', 'http://172.16.0.1', 'http://100.64.0.1',
    'http://localhost', 'http://svc.local', 'http://x.localhost',
  ]) {
    throws(() => assertPublicHttpUrl(bad, ENFORCE));
  }

  // --- IPv6 literals (bracket-stripping) blocked when enforcing ---
  for (const bad of ['http://[::1]/', 'http://[fc00::1]/', 'http://[fe80::1]/']) {
    throws(() => assertPublicHttpUrl(bad, ENFORCE));
  }
  // public IPv6 literal is allowed
  assert.ok(assertPublicHttpUrl('http://[2606:4700:4700::1111]/', ENFORCE));

  // --- bare DNS name passes the SYNC layer (no DNS there) ---
  assert.ok(assertPublicHttpUrl('http://glpi.example.com', ENFORCE));
  assert.equal(assertPublicHttpUrl('https://api.openai.com/v1', ENFORCE).hostname, 'api.openai.com');

  // --- on-prem: enforcePrivateBlock:false lets private through (after parse/protocol) ---
  assert.ok(assertPublicHttpUrl('http://10.0.0.5', SKIP));
  assert.ok(assertPublicHttpUrl('http://localhost:11434', SKIP));
  assert.ok(assertPublicHttpUrl('http://[::1]/', SKIP));
  // ...but a bad protocol is still rejected on-prem
  throws(() => assertPublicHttpUrl('ftp://10.0.0.5', SKIP));

  // --- async DNS guard: resolves the host and blocks internal A/AAAA ---
  const toInternal: LookupFn = async () => [{ address: '10.0.0.5' }];
  const toPublic: LookupFn = async () => [{ address: '93.184.216.34' }];
  const throwing: LookupFn = async () => { throw new Error('nxdomain'); };
  const empty: LookupFn = async () => [];

  await rejects(assertPublicHttpTarget('http://rebind.example.com', { enforcePrivateBlock: true, lookupFn: toInternal }));
  assert.equal(
    (await assertPublicHttpTarget('http://ok.example.com', { enforcePrivateBlock: true, lookupFn: toPublic })).hostname,
    'ok.example.com',
  );
  await rejects(assertPublicHttpTarget('http://nx.example.com', { enforcePrivateBlock: true, lookupFn: throwing }));
  await rejects(assertPublicHttpTarget('http://none.example.com', { enforcePrivateBlock: true, lookupFn: empty }));

  // --- on-prem async: does NOT resolve (lookupFn never called) and returns ---
  let called = false;
  const spy: LookupFn = async () => { called = true; return [{ address: '10.0.0.5' }]; };
  const url = await assertPublicHttpTarget('http://internal.example.com', { enforcePrivateBlock: false, lookupFn: spy });
  assert.equal(url.hostname, 'internal.example.com');
  assert.equal(called, false, 'lookupFn must not run when private block is disabled');

  // --- IPv6 forms that carry an IPv4 address are judged by that IPv4 address ---
  assert.equal(embeddedIpv4Address('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(embeddedIpv4Address('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(embeddedIpv4Address('::ffff:0:a00:1'), '10.0.0.1');
  assert.equal(embeddedIpv4Address('::7f00:1'), '127.0.0.1');
  assert.equal(embeddedIpv4Address('::192.168.1.1'), '192.168.1.1');
  assert.equal(embeddedIpv4Address('64:ff9b::a9fe:a9fe'), '169.254.169.254');
  assert.equal(embeddedIpv4Address('64:FF9B::10.0.0.1'), '10.0.0.1');
  assert.equal(embeddedIpv4Address('2002:c0a8:101::1'), '192.168.1.1');
  assert.equal(embeddedIpv4Address('2002:7f00:0001:0000:0000:0000:0000:0001'), '127.0.0.1');
  assert.equal(embeddedIpv4Address('2606:4700:4700::1111'), null);
  assert.equal(embeddedIpv4Address('fe80::1'), null);
  assert.equal(embeddedIpv4Address('10.0.0.1'), null);
  assert.equal(embeddedIpv4Address('not-an-address'), null);

  const embeddedNonPublic = [
    '::ffff:127.0.0.1', '::ffff:10.0.0.5', '::ffff:169.254.169.254', '::ffff:0:192.168.1.1',
    '::127.0.0.1', '::10.0.0.5', '::169.254.169.254',
    '64:ff9b::127.0.0.1', '64:ff9b::10.0.0.5', '64:ff9b::169.254.169.254', '64:ff9b::192.168.1.1',
    '2002:7f00:1::1', '2002:a00:5::1', '2002:a9fe:a9fe::1', '2002:c0a8:101::1',
  ];
  for (const address of embeddedNonPublic) {
    // literal host in the URL (sync guard and request-time guard)
    throws(() => assertPublicHttpUrl(`http://[${address}]/`, ENFORCE));
    await rejects(assertPublicHttpTarget(`http://[${address}]/`, ENFORCE));
    // DNS name resolving to that address
    await rejects(assertPublicHttpTarget('http://name.example.com/', {
      enforcePrivateBlock: true,
      lookupFn: async () => [{ address }],
    }));
  }
  // The NAT64, 6to4 and IPv4-compatible prefixes are refused as a whole when enforcing.
  for (const address of ['64:ff9b::5db8:d822', '2002:5db8:d822::1', '::5db8:d822']) {
    throws(() => assertPublicHttpUrl(`http://[${address}]/`, ENFORCE));
  }
  // An ordinary public address passes, in either family and in the IPv4-mapped form.
  for (const address of ['93.184.216.34', '2606:4700:4700::1111', '::ffff:93.184.216.34']) {
    const url = await assertPublicHttpTarget('http://public.example.com/', {
      enforcePrivateBlock: true,
      lookupFn: async () => [{ address }],
    });
    assert.equal(url.hostname, 'public.example.com');
  }
  // Single-tenant: private targets stay allowed, whatever their form.
  for (const address of embeddedNonPublic) {
    assert.ok(assertPublicHttpUrl(`http://[${address}]/`, SKIP));
    assert.ok(await assertPublicHttpTarget(`http://[${address}]/`, SKIP));
  }

  // --- allowlist: SSRF_ALLOWED_HOSTS permits an otherwise-blocked internal host ---
  const prevAllow = process.env.SSRF_ALLOWED_HOSTS;
  try {
    // blocked without allowlist
    throws(() => assertPublicHttpUrl('http://192.168.1.45/', ENFORCE));
    process.env.SSRF_ALLOWED_HOSTS = '192.168.1.45, other.internal';
    // sync guard now allows the allowlisted literal IP
    assert.equal(assertPublicHttpUrl('http://192.168.1.45/', ENFORCE).hostname, '192.168.1.45');
    // async guard allows it too (host allowlisted → no DNS block); a DNS name resolving
    // to the allowlisted IP is also permitted
    assert.equal((await assertPublicHttpTarget('http://192.168.1.45/', { enforcePrivateBlock: true, lookupFn: async () => [{ address: '192.168.1.45' }] })).hostname, '192.168.1.45');
    assert.equal((await assertPublicHttpTarget('http://glpi.corp/', { enforcePrivateBlock: true, lookupFn: async () => [{ address: '192.168.1.45' }] })).hostname, 'glpi.corp');
    // a non-allowlisted internal host is still blocked
    throws(() => assertPublicHttpUrl('http://192.168.1.99/', ENFORCE));
  } finally {
    if (prevAllow === undefined) delete process.env.SSRF_ALLOWED_HOSTS;
    else process.env.SSRF_ALLOWED_HOSTS = prevAllow;
  }

  console.log('ssrf-guard.spec: all assertions passed');
}

run().catch((e) => { console.error(e); process.exit(1); });

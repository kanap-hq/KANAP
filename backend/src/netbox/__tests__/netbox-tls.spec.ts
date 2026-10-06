import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { backendPath } from '../../common/__tests__/backend-root';
import { NetboxClient } from '../netbox.client';
import { NetboxApiError, NetboxConnection } from '../netbox.types';

// "Ignore certificate" end to end, against a real TLS server holding a
// self-signed certificate (checked in under __tests__/fixtures, valid until
// 2126). The client must refuse it by default with the tls_untrusted code,
// and accept it only when the option is on — for that one connection, never
// process-wide.
//
// The server listens on 127.0.0.1, which the SSRF guard blocks in multi-tenant
// mode, so the loopback address is allowlisted the way the PRTG spec does.
process.env.SSRF_ALLOWED_HOSTS = '127.0.0.1';

// Read from src/: the compiled run (`npm run test:ci`) does not copy fixtures.
const FIXTURES = backendPath('src', 'netbox', '__tests__', 'fixtures');
const TLS_OPTIONS = {
  key: fs.readFileSync(path.join(FIXTURES, 'netbox-test-key.pem')),
  cert: fs.readFileSync(path.join(FIXTURES, 'netbox-test-cert.pem')),
};

const SECRET_TOKEN = 'self-signed-probe-token';

async function main() {
  const seenAuthorization: string[] = [];
  const server = https.createServer(TLS_OPTIONS, (req, res) => {
    seenAuthorization.push(String(req.headers.authorization || ''));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ 'netbox-version': '3.7.4' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  const client = new NetboxClient();
  const connection: NetboxConnection = {
    baseUrl: `https://127.0.0.1:${port}`,
    token: SECRET_TOKEN,
    insecureTls: false,
    requestTimeoutMs: 5000,
  };

  try {
    // Default: the certificate is not trusted, and the message says what to do.
    try {
      await client.getVersion(connection);
      assert.fail('the untrusted certificate should have been refused');
    } catch (error) {
      assert.ok(error instanceof NetboxApiError, `expected a NetboxApiError, got ${String(error)}`);
      assert.equal(error.errorCode, 'tls_untrusted');
      assert.match(error.message, /Ignore certificate/);
      assert.doesNotMatch(error.message, new RegExp(SECRET_TOKEN));
    }

    // With the option on, the same server answers.
    const version = await client.getVersion({ ...connection, insecureTls: true });
    assert.equal(version, '3.7.4');
    assert.equal(seenAuthorization.at(-1), `Token ${SECRET_TOKEN}`);

    // The option really is per request: the next call without it fails again.
    await assert.rejects(
      client.getVersion(connection),
      (error: any) => error instanceof NetboxApiError && error.errorCode === 'tls_untrusted',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

main().then(() => console.log('netbox-tls.spec.ts OK')).catch((error) => {
  console.error(error);
  process.exit(1);
});

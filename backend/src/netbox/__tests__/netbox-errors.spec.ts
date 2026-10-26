import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import {
  NETBOX_ERROR_CODES,
  NETBOX_ERROR_MESSAGES,
  netboxBadRequest,
  netboxFailureOf,
} from '../netbox-errors';
import { NetboxApiError } from '../netbox.types';

// Codes the Netbox screens translate. A refused connection and an internal
// address stay out of every sentence the API returns.

const LEAK = /ECONNREFUSED|ENOTFOUND|172\.18\.0\.9|10\.0\.0\.5/;

function assertSafe(message: string): void {
  assert.doesNotMatch(message, LEAK);
}

async function main(): Promise<void> {
  for (const code of NETBOX_ERROR_CODES) {
    const error = netboxBadRequest(code);
    assert.equal(error.getStatus(), 400);
    const body = error.getResponse() as { code: string; message: string };
    assert.equal(body.code, code);
    assert.equal(body.message, NETBOX_ERROR_MESSAGES[code]);
    assertSafe(body.message);
  }

  {
    const failure = netboxFailureOf(new NetboxApiError(
      'provider_unavailable',
      'KANAP could not reach the Netbox server: connect ECONNREFUSED 172.18.0.9:8999',
      true,
    ));
    assert.equal(failure.code, 'netbox_unreachable');
    assert.equal(failure.message, NETBOX_ERROR_MESSAGES.netbox_unreachable);
    assert.match(failure.detail || '', /ECONNREFUSED 172\.18\.0\.9/);
    assertSafe(failure.message);
  }

  {
    const failure = netboxFailureOf(new NetboxApiError('dns', 'getaddrinfo ENOTFOUND netbox.internal'));
    assert.equal(failure.code, 'netbox_dns');
    assertSafe(failure.message);
    assert.match(failure.detail || '', /ENOTFOUND/);
  }

  const apiCases: Array<[ConstructorParameters<typeof NetboxApiError>[0], string]> = [
    ['unauthorized', 'netbox_auth'],
    ['forbidden', 'netbox_auth'],
    ['timeout', 'netbox_timeout'],
    ['rate_limited', 'netbox_rate_limited'],
    ['tls_untrusted', 'netbox_tls'],
    ['invalid_response', 'netbox_invalid_response'],
    ['not_found', 'netbox_invalid_response'],
  ];
  for (const [errorCode, code] of apiCases) {
    const failure = netboxFailureOf(new NetboxApiError(errorCode, `raw ${errorCode}`));
    assert.equal(failure.code, code, errorCode);
    assert.equal(failure.message, NETBOX_ERROR_MESSAGES[code as keyof typeof NETBOX_ERROR_MESSAGES]);
    assert.equal(failure.detail, undefined);
  }

  const httpCases: Array<[string, string]> = [
    ['Unable to resolve target host.', 'netbox_dns'],
    ['Private or internal hosts are not allowed.', 'netbox_private_host'],
    ['Invalid target host.', 'netbox_private_host'],
    ['A URL is required.', 'netbox_base_url_invalid'],
    ['Value must be a valid HTTP(S) URL.', 'netbox_base_url_invalid'],
    ['Only http:// or https:// URLs are supported.', 'netbox_base_url_invalid'],
    ['URLs must not include embedded credentials.', 'netbox_base_url_invalid'],
    ['The Netbox address must be a full web address starting with http:// or https://.', 'netbox_base_url_invalid'],
    ['The Netbox address must be at most 2048 characters long.', 'netbox_address_too_long'],
    ['The Netbox address must not contain a query string, a fragment, or a user name and password.', 'netbox_base_url_invalid'],
    ['Add the Netbox address first, then try again.', 'netbox_base_url_invalid'],
    ['The request timeout must be a whole number of seconds between 5 and 120, or empty to use the default.', 'netbox_timeout_invalid'],
    ['No Netbox API token is saved yet. Add one in Netbox under your profile, API tokens, then paste it here.', 'netbox_token_missing'],
    ['The saved Netbox token cannot be read on this server. Enter the token again and save.', 'netbox_token_unreadable'],
  ];
  for (const [message, code] of httpCases) {
    const failure = netboxFailureOf(new BadRequestException(message));
    assert.equal(failure.code, code, message);
    assert.equal(failure.message, NETBOX_ERROR_MESSAGES[code as keyof typeof NETBOX_ERROR_MESSAGES]);
    assertSafe(failure.message);
  }

  {
    const failure = netboxFailureOf(netboxBadRequest('netbox_token_missing'));
    assert.equal(failure.code, 'netbox_token_missing');
    assert.equal(failure.detail, undefined);
  }

  {
    const failure = netboxFailureOf(new Error('connect ECONNREFUSED 10.0.0.5:8999'));
    assert.equal(failure.code, 'netbox_unreachable');
    assertSafe(failure.message);
    assert.match(failure.detail || '', /10\.0\.0\.5/);
  }
}

main().then(() => console.log('netbox-errors.spec.ts OK')).catch((error) => {
  console.error(error);
  process.exit(1);
});

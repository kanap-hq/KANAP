import * as assert from 'node:assert/strict';
import { AiEvidenceService, redactSensitiveText, redactSensitiveValue } from '../ai-evidence.service';
import { mcpArgumentPreview } from '../../mcp/ai-mcp-audit.service';
import { AiExternalMcpBridgeService } from '../../mcp/ai-external-mcp-bridge.service';
import { AiExternalMcpMockTransport } from '../../mcp/ai-external-mcp-mock-transport.service';

/**
 * A kept evidence row carries no token: the evidence writer and the external MCP bridge hide
 * JWTs, bearer tokens and Authorization header values, and keep ordinary dotted text as is.
 */

const JWT = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJzdWIiOiJzYW1wbGUtdXNlciJ9',
  'c2FtcGxlLXNpZ25hdHVyZS12YWx1ZQ',
].join('.');
const BASIC_VALUE = 'c2FtcGxlOnZhbHVl';
const SHORT_BEARER = 'abc.def';
const PLAIN = 'See docs.example.org/guide, rapport.final.pdf and version 1.2.3 at 12 rue de la Paix.';
const TOKENS = [JWT, BASIC_VALUE, SHORT_BEARER];

function assertNoToken(value: unknown, label: string) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const token of TOKENS) {
    assert.ok(!text.includes(token), `${label} still holds ${token.slice(0, 8)}...`);
  }
}

function tokenPayload() {
  return {
    note: `The call returned ${JWT} for the session.`,
    header: `Authorization: Basic ${BASIC_VALUE}`,
    command: `curl -H "Authorization: Bearer ${SHORT_BEARER}" https://docs.example.org/guide`,
    json_text: JSON.stringify({ Authorization: `Bearer ${JWT}` }),
    list: [`Bearer ${JWT}`],
    plain: PLAIN,
  };
}

async function testTheEvidenceWriterHidesTokensInTheSourceAddress() {
  const saved: Array<Record<string, unknown>> = [];
  const repo = { create: (row: Record<string, unknown>) => row, save: async (row: Record<string, unknown>) => { saved.push(row); return row; } };
  const service = new AiEvidenceService({} as any);
  const address = 'https://10.0.0.5/device.htm?id=42';
  for (const sourceUri of [`${address}&apitoken=${OPAQUE}`, `${address}&passhash=${OPAQUE}`, `https://user:${OPAQUE}@10.0.0.5/device.htm`, address]) {
    await service.recordEvidence({ tenantId: 'tenant', manager: { getRepository: () => repo } } as any, {
      sourceProvider: 'test',
      sourceObjectType: 'test_output',
      sourceUri,
      payload: null,
    });
  }
  for (const row of saved) assertNoCredential(String(row.source_uri), 'source address');
  // The address stays usable.
  assert.equal(saved[3].source_uri, address);
  assert.ok(String(saved[0].source_uri).startsWith(`${address}&apitoken=`));
}

async function testTheEvidenceWriterHidesTokens() {
  const saved: Array<Record<string, unknown>> = [];
  const repo = {
    create: (row: Record<string, unknown>) => row,
    save: async (row: Record<string, unknown>) => {
      saved.push(row);
      return row;
    },
  };
  const service = new AiEvidenceService({} as any);
  await service.recordEvidence({ tenantId: 'tenant', manager: { getRepository: () => repo } } as any, {
    sourceProvider: 'test',
    sourceObjectType: 'test_output',
    summary: `Returned ${JWT} with Authorization: Bearer ${SHORT_BEARER}. ${PLAIN}`,
    payload: tokenPayload(),
  });
  const row = saved[0];
  assertNoToken(row.summary, 'summary');
  assertNoToken(row.payload_json, 'payload');
  assert.ok(String(row.summary).includes(PLAIN));
  assert.equal((row.payload_json as Record<string, unknown>).plain, PLAIN);
}

function testTheEvidenceSummaryHidesTokens() {
  const service = new AiEvidenceService({} as any);
  const summary = service.summarize(`Returned ${JWT}. ${PLAIN}`);
  assertNoToken(summary, 'summary');
  assert.ok(String(summary.summary).includes(PLAIN));
  assert.equal(service.redact(PLAIN), PLAIN);
}

function testTheExternalMcpBridgeHidesTokens() {
  const bridge = new AiExternalMcpBridgeService({} as any, {} as any, new AiExternalMcpMockTransport()) as any;
  const server = { server_key: 'sample', redaction_policy_json: null };
  const snapshot = { external_tool_name: 'lookup', redaction_policy_json: null };

  const ok = bridge.normalizeTransportOutput(server, snapshot, {
    ok: true,
    data: { output: tokenPayload() },
    evidence: [],
  });
  assertNoToken(ok.evidence, 'output evidence');
  assert.equal(ok.evidence[0].redactedPayload.plain, PLAIN);

  const failed = bridge.normalizeTransportOutput(server, snapshot, {
    ok: false,
    errorCode: 'unknown',
    message: `Refused Authorization: Bearer ${JWT}. ${PLAIN}`,
    retryable: false,
  });
  assertNoToken(failed.message, 'error message');
  assertNoToken(failed.evidence, 'error evidence');
  assert.ok(failed.message.includes(PLAIN));

  const malformed = bridge.malformedProviderOutput(server, snapshot, { raw: `value ${JWT}`, plain: PLAIN });
  assertNoToken(malformed.evidence, 'malformed evidence');
  assert.equal(malformed.evidence[0].redactedPayload.output.plain, PLAIN);
}

function timed<T>(work: () => T): { value: T; ms: number } {
  const started = process.hrtime.bigint();
  const value = work();
  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
}

function testTheRedactionTimeGrowsLinearlyWithTheText() {
  // 300 KB of text close to a JWT, then a real one.
  const text = `${'eyJ-'.repeat(75_000)} ${JWT}`;
  const evidence = timed(() => redactSensitiveText(text));
  assert.ok(evidence.ms < 500, `evidence redaction took ${evidence.ms.toFixed(0)} ms`);
  assertNoToken(evidence.value, 'evidence text');
  const journal = timed(() => mcpArgumentPreview({ query: text }));
  assert.ok(journal.ms < 500, `journal preview took ${journal.ms.toFixed(0)} ms`);
  assertNoToken(journal.value, 'journal preview');
  assert.ok(!JSON.stringify(mcpArgumentPreview({ query: `see ${JWT}` })).includes(JWT));
}

// Sample values, assembled at run time.
const OPAQUE = ['Zq81Lm0P', 'w4Rt7Yx2', 'Nc5Vb9Kd'].join('');
const [JWT_HEADER, JWT_PAYLOAD, JWT_SIGNATURE] = JWT.split('.');

function credentialSamples(): string[] {
  return [
    `https://idp.example.org/callback?code=1&access_token=${OPAQUE}&state=2`,
    `refresh_token: ${OPAQUE}`,
    JSON.stringify({ refresh_token: OPAQUE }),
    `POST client_secret=${OPAQUE}&grant_type=client_credentials`,
    `key ${'s'}k-proj-${OPAQUE}`,
    `key ${'gh'}p_${OPAQUE}${OPAQUE.slice(0, 12)}`,
    `key ${'xo'}xb-1234567890-${OPAQUE}`,
    `key ${'kanap_'}mcp_${OPAQUE}`,
    `Cookie: sid=${OPAQUE}; theme=dark`,
    `Set-Cookie: sid=${OPAQUE}; Path=/; HttpOnly`,
    `https://alice:${OPAQUE}@git.example.org/repo.git`,
    `id_${JWT}`,
    `next=%2Fhome%3Fid_token%3D${JWT}`,
    `${JWT_HEADER}.${JWT_PAYLOAD.slice(0, 10)}\n${JWT_PAYLOAD.slice(10)}.${JWT_SIGNATURE}`,
    `${JWT_HEADER}.\n${JWT_PAYLOAD}.\n${JWT_SIGNATURE}`,
  ];
}

function assertNoCredential(text: string, label: string) {
  assert.ok(!text.includes(OPAQUE), `${label} still holds a value: ${text}`);
  assert.ok(!text.includes(JWT_SIGNATURE), `${label} still holds a signature: ${text}`);
}

function testTheEvidenceAndTheJournalShareOneRule() {
  for (const sample of credentialSamples()) {
    assertNoCredential(redactSensitiveText(sample), 'evidence');
    assertNoCredential(JSON.stringify(mcpArgumentPreview({ q: sample })), 'journal');
  }
  const fields = { private_key: OPAQUE, credentials: OPAQUE, passwd: OPAQUE, access_key: OPAQUE, api_key: OPAQUE, auth: OPAQUE, jwt: OPAQUE };
  assertNoCredential(JSON.stringify(redactSensitiveValue(fields)), 'evidence fields');
  assertNoCredential(JSON.stringify(mcpArgumentPreview(fields)), 'journal fields');
  // Ordinary text stays as written.
  for (const plain of [PLAIN, 'Cookie: please clear it and retry.', 'The token expired yesterday.', 'Desk-reference id_card']) {
    assert.equal(redactSensitiveText(plain), plain);
  }
}

function testAnAuthorizationValueIsHiddenWhenItIsACredential() {
  for (const sentence of [
    'Authorization: pending manager approval',
    'Authorization: refused by the finance team, see the ticket.',
    'authorization = granted on 12 March',
    'Proxy-Authorization: not required on this network',
  ]) {
    assert.equal(redactSensitiveText(sentence), sentence);
  }
  for (const header of [
    `Authorization: Bearer ${OPAQUE}`,
    `Authorization: Basic ${OPAQUE}`,
    `authorization: digest ${OPAQUE}`,
    `Authorization: Token ${OPAQUE}`,
    `Authorization: NTLM ${OPAQUE}`,
    `Authorization: ${OPAQUE}`,
    JSON.stringify({ headers: `{"Authorization":"Negotiate ${OPAQUE}"}` }),
  ]) {
    const redacted = redactSensitiveText(header);
    assertNoCredential(redacted, 'authorization');
    assert.ok(/authorization/i.test(redacted));
  }
}

async function run() {
  const tests: Array<() => unknown> = [
    testTheEvidenceWriterHidesTokens,
    testTheEvidenceWriterHidesTokensInTheSourceAddress,
    testTheRedactionTimeGrowsLinearlyWithTheText,
    testTheEvidenceAndTheJournalShareOneRule,
    testAnAuthorizationValueIsHiddenWhenItIsACredential,
    testTheEvidenceSummaryHidesTokens,
    testTheExternalMcpBridgeHidesTokens,
  ];
  let failures = 0;
  for (const test of tests) {
    try {
      await test();
      console.log(`ok ${test.name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${test.name}`, error);
    }
  }
  if (failures > 0) process.exit(1);
}

void run();

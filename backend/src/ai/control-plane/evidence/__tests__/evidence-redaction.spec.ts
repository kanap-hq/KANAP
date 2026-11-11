import * as assert from 'node:assert/strict';
import { AiEvidenceService } from '../ai-evidence.service';
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

async function run() {
  const tests: Array<() => unknown> = [
    testTheEvidenceWriterHidesTokens,
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

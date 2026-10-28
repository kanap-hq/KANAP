import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import {
  DATA_ACCESS_LEAVES_ACCESS_MESSAGE,
  DATA_ACCESS_PLACEMENT_MESSAGE,
  DATA_ACCESS_READ_ONLY_LINE_MESSAGE,
  DATA_ACCESS_REASON_BY_MESSAGE,
  DataAccessLimitedException,
} from '../line-write-checks';
import { DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE } from '../contract-write-checks';
import { DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE } from '../../spend/chargeback-report.service';
import { DATA_ACCESS_READ_ONLY_TASK_MESSAGE, DATA_ACCESS_TASK_DELETE_MESSAGE } from '../../tasks/task-data-access';
import { DATA_ACCESS_RESERVED_MESSAGE, DataAccessReservedException } from '../reserved-operations';
import { CONVERSION_HIDDEN_LINES_MESSAGE } from '../../technologies/application-conversion.service';
import { DATA_ACCESS_LIMITED_MESSAGE, mapDatabaseError } from '../../common/filters/database-error.mapping';
import { DataAccessHiddenLinesException } from '../hidden-links';

// Every 403 DATA_ACCESS_LIMITED carries a reason the screen translates (errors:dataAccess.*). A
// constant sentence gets it from the table; a constructed one (hidden links, a reference) passes it
// with its params. The English sentence stays what the API already said.

const bodyOf = (error: { getResponse(): unknown }) => error.getResponse() as Record<string, any>;

/** Every constant sentence, with its reason. */
const CONSTANTS: Array<[string, string]> = [
  [DATA_ACCESS_LIMITED_MESSAGE, 'outside'],
  [DATA_ACCESS_PLACEMENT_MESSAGE, 'placement'],
  [DATA_ACCESS_READ_ONLY_LINE_MESSAGE, 'readOnlyLine'],
  [DATA_ACCESS_READ_ONLY_CONTRACT_MESSAGE, 'readOnlyContract'],
  [DATA_ACCESS_LEAVES_ACCESS_MESSAGE, 'leavesAccess'],
  [DATA_ACCESS_CHARGEBACK_COMPANY_MESSAGE, 'chargebackCompany'],
  [DATA_ACCESS_READ_ONLY_TASK_MESSAGE, 'readOnlyTask'],
  [DATA_ACCESS_TASK_DELETE_MESSAGE, 'taskDelete'],
  [DATA_ACCESS_RESERVED_MESSAGE, 'reserved'],
];

function testConstants() {
  for (const [message, reason] of CONSTANTS) {
    assert.equal(DATA_ACCESS_REASON_BY_MESSAGE[message], reason, message);
    const body = bodyOf(new DataAccessLimitedException(message));
    assert.equal(body.code, 'DATA_ACCESS_LIMITED', message);
    assert.equal(body.reason, reason, message);
    assert.equal(body.message, message, message);
    assert.equal(body.statusCode, 403, message);
  }
  // The table holds no sentence no constant writes.
  const messages = new Set(CONSTANTS.map(([message]) => message));
  for (const message of Object.keys(DATA_ACCESS_REASON_BY_MESSAGE)) assert.ok(messages.has(message), `stale reason for ${message}`);
  console.log(`  ${CONSTANTS.length} constant sentences carry their reason: OK`);
}

function testPolicyRefusal() {
  // A policy refusal (SQLSTATE 42501) is the "outside your access" sentence.
  const mapped = mapDatabaseError(Object.assign(new Error('permission denied for table spend_items'), { code: '42501' }));
  assert.ok(mapped, 'a mapped policy refusal');
  assert.equal(mapped.code, 'DATA_ACCESS_LIMITED');
  const body = bodyOf(mapped.exception);
  assert.equal(body.reason, 'outside');
  assert.equal(body.message, DATA_ACCESS_LIMITED_MESSAGE);

  // The action reserved to unscoped persons is its own sentence.
  const reserved = bodyOf(new DataAccessReservedException());
  assert.equal(reserved.code, 'DATA_ACCESS_LIMITED');
  assert.equal(reserved.reason, 'reserved');
  assert.equal(reserved.message, DATA_ACCESS_RESERVED_MESSAGE);
  console.log('  policy refusal: outside; reserved operation: reserved: OK');
}

function testHiddenLinks() {
  const lines = new DataAccessHiddenLinesException('application', 3);
  const linesBody = bodyOf(lines);
  assert.equal(linesBody.code, 'DATA_ACCESS_LIMITED');
  assert.equal(linesBody.reason, 'hiddenLinks');
  assert.deepEqual(linesBody.params, { owner: 'application', lines: 3, contracts: 0 });
  assert.equal(lines.code, 'APPLICATION_HIDDEN_LINES');
  // What a delete check and a bulk delete read: the refusal's own count, not the link counts.
  assert.deepEqual(lines.params, { count: 3 });

  const contracts = new DataAccessHiddenLinesException('technology', 0, 2);
  const contractsBody = bodyOf(contracts);
  assert.equal(contractsBody.reason, 'hiddenLinks');
  assert.deepEqual(contractsBody.params, { owner: 'technology', lines: 0, contracts: 2 });
  assert.equal(contracts.code, 'TECHNOLOGY_HIDDEN_CONTRACTS');
  assert.deepEqual(contracts.params, { count: 2, contracts: 2 });

  const both = new DataAccessHiddenLinesException('asset', 1, 2);
  const bothBody = bodyOf(both);
  assert.equal(bothBody.reason, 'hiddenLinks');
  assert.deepEqual(bothBody.params, { owner: 'asset', lines: 1, contracts: 2 });
  assert.deepEqual(both.params, { count: 1, contracts: 2 });
  console.log('  hidden links: owner, lines and contracts, the refusal keeps its count: OK');
}

function testConstructedConversion() {
  // The application conversion counts its hidden lines: it passes its reason and params itself.
  const body = bodyOf(new DataAccessLimitedException(CONVERSION_HIDDEN_LINES_MESSAGE, {
    reason: 'hiddenLinks',
    params: { owner: 'application', lines: 2, contracts: 0 },
  }));
  assert.equal(body.reason, 'hiddenLinks');
  assert.deepEqual(body.params, { owner: 'application', lines: 2, contracts: 0 });
  assert.equal(body.message, CONVERSION_HIDDEN_LINES_MESSAGE);
  console.log('  constructed hidden lines: reason and params passed explicitly: OK');
}

function run() {
  testConstants();
  testPolicyRefusal();
  testHiddenLinks();
  testConstructedConversion();
  console.log('data-access-reasons.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}

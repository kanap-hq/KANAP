import * as assert from 'node:assert/strict';
import {
  DocumentIncidentBinding,
  DocumentIncidentViewer,
  INCIDENT_REVIEW_LOCKED_MESSAGE,
  assertDocumentIncidentVisible,
  assertDocumentIncidentWritable,
  assertIncidentBindingVisible,
  assertIncidentBindingWritable,
  buildIncidentReviewImportContext,
  buildIncidentReviewSourceContext,
  documentIncidentVisibilityQueryBuilderClause,
  documentIncidentVisibilitySql,
  isDocumentIncidentVisible,
  isDocumentIncidentWritable,
  resolveDocumentIncidentViewer,
  sourceContextMatchesBinding,
} from '../document-entity-visibility';
import { INCIDENT_LOCKED_MESSAGE } from '../../incidents/services/incidents-base.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OWNER = '22222222-2222-2222-2222-222222222222';
const REPORTER = '33333333-3333-3333-3333-333333333333';
const THIRD_PARTY = '44444444-4444-4444-4444-444444444444';
const DOCUMENT = '55555555-5555-5555-5555-555555555555';
const INCIDENT = '66666666-6666-6666-6666-666666666666';

function viewer(over: Partial<DocumentIncidentViewer>): DocumentIncidentViewer {
  return {
    userId: null,
    isAdmin: false,
    canReadIncidents: false,
    canContributeIncidents: false,
    ...over,
  };
}

function assertModuleRight(error: any, resource: string, level: string, message: string): void {
  assert.equal(error?.getStatus?.(), 403, 'status');
  assert.deepEqual(error?.getResponse?.(), {
    statusCode: 403,
    error: 'Forbidden',
    code: 'MODULE_RIGHT_REQUIRED',
    message,
    params: { resource, level },
  });
}

function binding(over: Partial<DocumentIncidentBinding>): DocumentIncidentBinding {
  return {
    document_id: DOCUMENT,
    tenant_id: TENANT,
    source_entity_id: INCIDENT,
    slot_key: 'review',
    incident_id: INCIDENT,
    item_number: 12,
    status: 'open',
    confidential: false,
    reporter_user_id: null,
    owner_user_id: null,
    ...over,
  };
}

const ADMIN = viewer({ userId: THIRD_PARTY, isAdmin: true, canReadIncidents: true, canContributeIncidents: true });
const CONTRIBUTOR_OWNER = viewer({ userId: OWNER, canReadIncidents: true, canContributeIncidents: true });
const READER_REPORTER = viewer({ userId: REPORTER, canReadIncidents: true });
const READER_THIRD_PARTY = viewer({ userId: THIRD_PARTY, canReadIncidents: true });
const KNOWLEDGE_ONLY = viewer({ userId: THIRD_PARTY });
const ANONYMOUS = viewer({});

function testRowMatrix() {
  // Non-confidential review: any incidents reader sees it, a Knowledge-only user does not.
  const open = binding({});
  assert.equal(isDocumentIncidentVisible(open, READER_THIRD_PARTY), true);
  assert.equal(isDocumentIncidentVisible(open, ADMIN), true);
  assert.equal(isDocumentIncidentVisible(open, KNOWLEDGE_ONLY), false, 'incidents rights are required even when not confidential');
  assert.equal(isDocumentIncidentVisible(open, ANONYMOUS), false);

  // Confidential with both owner and reporter null: only the registry admin.
  const bothNull = binding({ confidential: true });
  assert.equal(isDocumentIncidentVisible(bothNull, ADMIN), true);
  assert.equal(isDocumentIncidentVisible(bothNull, READER_THIRD_PARTY), false);
  assert.equal(isDocumentIncidentVisible(bothNull, READER_REPORTER), false);

  // Confidential with a null reporter: the owner still sees it.
  const ownerOnly = binding({ confidential: true, owner_user_id: OWNER, reporter_user_id: null });
  assert.equal(isDocumentIncidentVisible(ownerOnly, CONTRIBUTOR_OWNER), true);
  assert.equal(isDocumentIncidentVisible(ownerOnly, READER_THIRD_PARTY), false);

  // Confidential with a null owner: the reporter still sees it.
  const reporterOnly = binding({ confidential: true, owner_user_id: null, reporter_user_id: REPORTER });
  assert.equal(isDocumentIncidentVisible(reporterOnly, READER_REPORTER), true);
  assert.equal(isDocumentIncidentVisible(reporterOnly, READER_THIRD_PARTY), false);

  // Orphan binding: refused for everyone, admin included.
  const orphan = binding({ incident_id: null, status: null, confidential: null });
  assert.equal(isDocumentIncidentVisible(orphan, ADMIN), false);
  assert.equal(isDocumentIncidentVisible(orphan, CONTRIBUTOR_OWNER), false);
  assert.throws(() => assertIncidentBindingVisible(orphan, ADMIN), /Document not found/);

  // Writes need contributor and an unfrozen incident.
  assert.equal(isDocumentIncidentWritable(open, READER_THIRD_PARTY), false, 'reader cannot write');
  assert.equal(isDocumentIncidentWritable(open, CONTRIBUTOR_OWNER), true);
  for (const status of ['closed', 'cancelled']) {
    const frozen = binding({ status });
    assert.equal(isDocumentIncidentWritable(frozen, CONTRIBUTOR_OWNER), false, `${status} must freeze the review`);
    assert.equal(isDocumentIncidentWritable(frozen, ADMIN), false, `${status} freezes the review for admins too`);
    assert.throws(
      () => assertIncidentBindingWritable(frozen, CONTRIBUTOR_OWNER),
      (error: any) => error?.getStatus?.() === 403 && String(error?.message).includes('closed'),
    );
    // The CSV-import exemption lifts the freeze only.
    assert.doesNotThrow(() => assertIncidentBindingWritable(frozen, CONTRIBUTOR_OWNER, { allowFrozenIncident: true }));
    assert.throws(
      () => assertIncidentBindingWritable(
        binding({ status, confidential: true, owner_user_id: OWNER }),
        READER_THIRD_PARTY,
        { allowFrozenIncident: true },
      ),
      /Document not found/,
      'the import exemption never lifts confidentiality',
    );
  }

  // A reader who is the owner still cannot write.
  assert.throws(
    () => assertIncidentBindingWritable(open, READER_REPORTER),
    (error: any) => {
      assertModuleRight(error, 'incidents', 'contributor', 'incidents:contributor permission is required');
      return true;
    },
  );
}

function testSqlBranches() {
  // Anonymous / no incidents:reader: every bound document is excluded, no parameter.
  for (const v of [ANONYMOUS, KNOWLEDGE_ONLY]) {
    const params: unknown[] = [];
    const sql = documentIncidentVisibilitySql('d', v, params);
    assert.equal(params.length, 0);
    assert.match(sql, /NOT EXISTS/);
    assert.match(sql, /b_acl\.source_entity_type = 'incidents'/);
    assert.equal(/incidents i_acl/.test(sql), false, 'the no-rights branch does not even join incidents');
  }

  // A non-admin viewer with incidents rights but no identity cannot be matched
  // against a reporter or an owner: it falls back to the exclude-everything branch
  // rather than emitting a placeholder nothing will ever bind.
  const identitylessParams: unknown[] = [];
  const identitylessSql = documentIncidentVisibilitySql(
    'd',
    viewer({ userId: null, canReadIncidents: true, canContributeIncidents: true }),
    identitylessParams,
  );
  assert.equal(identitylessParams.length, 0);
  assert.equal(/incidents i_acl/.test(identitylessSql), false, 'no identity, no incident join');
  assert.equal(/\$\d/.test(identitylessSql), false, 'no dangling placeholder');

  // Registry admin: orphan bindings still excluded, no confidentiality restriction, no parameter.
  const adminParams: unknown[] = [];
  const adminSql = documentIncidentVisibilitySql('d', ADMIN, adminParams);
  assert.equal(adminParams.length, 0);
  assert.match(adminSql, /i_acl\.id IS NULL/);
  assert.equal(/confidential/.test(adminSql), false);

  // Identified reader: the spec's core clause, one bound parameter, `IS NOT TRUE`.
  const readerParams: unknown[] = ['already-there'];
  const readerSql = documentIncidentVisibilitySql('d', READER_THIRD_PARTY, readerParams);
  assert.deepEqual(readerParams, ['already-there', THIRD_PARTY]);
  assert.match(readerSql, /\$2/);
  assert.match(readerSql, /IS NOT TRUE/);
  assert.equal(
    /NOT\s*\(\s*i_acl\.reporter_user_id/.test(readerSql),
    false,
    'NOT (...) would let a null owner/reporter through',
  );
  assert.match(readerSql, /i_acl\.id IS NULL/);
  assert.match(readerSql, /b_acl\.tenant_id = d\.tenant_id/);

  // The alias is honoured.
  assert.match(documentIncidentVisibilitySql('doc', ADMIN, []), /b_acl\.document_id = doc\.id/);

  // QueryBuilder form carries the same predicate with a named parameter.
  const qb = documentIncidentVisibilityQueryBuilderClause('d', READER_THIRD_PARTY);
  assert.equal(qb.clause.startsWith('AND'), false);
  assert.match(qb.clause, /:documentIncidentAclUserId/);
  assert.deepEqual(qb.params, { documentIncidentAclUserId: THIRD_PARTY });
  const qbAdmin = documentIncidentVisibilityQueryBuilderClause('d', ADMIN);
  assert.deepEqual(qbAdmin.params, {});
  assert.equal(qbAdmin.clause.includes(':documentIncidentAclUserId'), false);
}

function testSourceContext() {
  const context = buildIncidentReviewSourceContext({ userId: OWNER, tenantId: TENANT, incidentId: INCIDENT })!;
  assert.equal(context.sourceEntityType, 'incidents');
  assert.equal(context.slotKey, 'review');
  assert.equal(context.allowFrozenIncident, undefined);
  assert.equal(buildIncidentReviewImportContext({ userId: OWNER, tenantId: TENANT, incidentId: INCIDENT })!.allowFrozenIncident, true);
  assert.equal(buildIncidentReviewSourceContext({ userId: '', tenantId: TENANT, incidentId: INCIDENT }), null);
  assert.equal(buildIncidentReviewSourceContext({ userId: OWNER, tenantId: null, incidentId: INCIDENT }), null);

  const bound = binding({});
  assert.equal(sourceContextMatchesBinding(context, bound, DOCUMENT), true);
  assert.equal(sourceContextMatchesBinding(context, bound, OWNER), false, 'other document id');
  assert.equal(
    sourceContextMatchesBinding({ ...context, tenantId: OWNER }, bound, DOCUMENT),
    false,
    'other tenant',
  );
  assert.equal(
    sourceContextMatchesBinding({ ...context, sourceEntityId: OWNER }, bound, DOCUMENT),
    false,
    'other incident',
  );
  assert.equal(
    sourceContextMatchesBinding({ ...context, slotKey: 'purpose' as any }, bound, DOCUMENT),
    false,
    'other slot',
  );
  assert.equal(
    sourceContextMatchesBinding(context, binding({ slot_key: 'purpose' }), DOCUMENT),
    false,
    'binding slot mismatch',
  );
  assert.equal(sourceContextMatchesBinding(null, bound, DOCUMENT), false);
  assert.equal(sourceContextMatchesBinding(context, null, DOCUMENT), false);
}

async function testViewerFailsClosedWithoutQuery() {
  let queried = 0;
  const manager: any = { query: async () => { queried += 1; return []; } };

  assert.deepEqual(
    await resolveDocumentIncidentViewer(manager, null, TENANT),
    { userId: null, isAdmin: false, canReadIncidents: false, canContributeIncidents: false },
  );
  assert.equal(queried, 0, 'no identity must not hit the database');

  // Headless surfaces sometimes carry a label instead of a user id: no rights, no query, no crash.
  assert.deepEqual(
    await resolveDocumentIncidentViewer(manager, 'ai-tool-admin', TENANT),
    { userId: null, isAdmin: false, canReadIncidents: false, canContributeIncidents: false },
  );
  assert.equal(queried, 0, 'a non-uuid actor must not hit the database either');

  // A missing tenantId falls back to app_current_tenant(); when that is empty the viewer fails closed.
  const emptyTenantManager: any = { query: async () => [{ tenant_id: null }] };
  const fallback = await resolveDocumentIncidentViewer(emptyTenantManager, OWNER, null);
  assert.deepEqual(fallback, { userId: OWNER, isAdmin: false, canReadIncidents: false, canContributeIncidents: false });
}

async function testViewerLevelMapping() {
  const make = (row: any) => ({ query: async () => [row] }) as any;

  assert.deepEqual(
    await resolveDocumentIncidentViewer(make({ user_ok: false, is_administrator: false, level_rank: 4 }), OWNER, TENANT),
    { userId: OWNER, isAdmin: false, canReadIncidents: false, canContributeIncidents: false },
    'a disabled or missing user gets nothing',
  );
  assert.deepEqual(
    await resolveDocumentIncidentViewer(make({ user_ok: true, is_administrator: 't', level_rank: null }), OWNER, TENANT),
    { userId: OWNER, isAdmin: true, canReadIncidents: true, canContributeIncidents: true },
  );
  assert.deepEqual(
    await resolveDocumentIncidentViewer(make({ user_ok: true, is_administrator: false, level_rank: 1 }), OWNER, TENANT),
    { userId: OWNER, isAdmin: false, canReadIncidents: true, canContributeIncidents: false },
  );
  assert.deepEqual(
    await resolveDocumentIncidentViewer(make({ user_ok: true, is_administrator: false, level_rank: 2 }), OWNER, TENANT),
    { userId: OWNER, isAdmin: false, canReadIncidents: true, canContributeIncidents: true },
  );
  assert.deepEqual(
    await resolveDocumentIncidentViewer(make({ user_ok: true, is_administrator: false, level_rank: 4 }), OWNER, TENANT),
    { userId: OWNER, isAdmin: true, canReadIncidents: true, canContributeIncidents: true },
  );
}

/** The two async entry points, driven with a pre-resolved binding/viewer (no query). */
async function testAsyncAsserts() {
  const manager: any = { query: async () => { throw new Error('must not query'); } };
  const open = binding({});

  assert.equal(
    await assertDocumentIncidentVisible(DOCUMENT, manager, OWNER, TENANT, { binding: null }),
    null,
    'a document with no incident binding is a no-op',
  );
  assert.equal(
    (await assertDocumentIncidentVisible(DOCUMENT, manager, OWNER, TENANT, { binding: open, viewer: READER_THIRD_PARTY }))?.document_id,
    DOCUMENT,
  );
  await assert.rejects(
    assertDocumentIncidentVisible(DOCUMENT, manager, THIRD_PARTY, TENANT, { binding: open, viewer: KNOWLEDGE_ONLY }),
    /Document not found/,
  );
  await assert.rejects(
    assertDocumentIncidentWritable(DOCUMENT, manager, REPORTER, TENANT, { binding: open, viewer: READER_REPORTER }),
    (error: any) => {
      assertModuleRight(error, 'incidents', 'contributor', 'incidents:contributor permission is required');
      return true;
    },
  );
  await assert.rejects(
    assertDocumentIncidentWritable(DOCUMENT, manager, OWNER, TENANT, {
      binding: binding({ status: 'cancelled' }), viewer: CONTRIBUTOR_OWNER,
    }),
    (error: any) => {
      assert.match(error.message, new RegExp(INCIDENT_REVIEW_LOCKED_MESSAGE.split('.')[0]));
      assert.equal(error.getResponse().code, 'INCIDENT_REVIEW_LOCKED', 'the screen translates the lock');
      return true;
    },
  );
  assert.ok(
    await assertDocumentIncidentWritable(DOCUMENT, manager, OWNER, TENANT, {
      binding: binding({ status: 'closed' }), viewer: CONTRIBUTOR_OWNER, allowFrozenIncident: true,
    }),
    'the import exemption lifts the freeze only',
  );
}

function testLockedMessageParity() {
  assert.equal(
    INCIDENT_REVIEW_LOCKED_MESSAGE,
    INCIDENT_LOCKED_MESSAGE,
    'the knowledge-side freeze message must stay identical to the incidents one',
  );
}

async function run() {
  testRowMatrix();
  testSqlBranches();
  testSourceContext();
  await testViewerFailsClosedWithoutQuery();
  await testViewerLevelMapping();
  await testAsyncAsserts();
  testLockedMessageParity();
  console.log('document-entity-visibility.spec: all assertions passed');
}

run().catch((error) => { console.error(error); process.exit(1); });

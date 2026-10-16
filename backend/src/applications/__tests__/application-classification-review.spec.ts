import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { classificationPatch } from '../services/application-classification';

const tenantId = randomUUID();
const otherTenantId = randomUUID();
const applicationId = randomUUID();
const reviewerId = randomUUID();

function createService(manager: any) {
  const settings = {
    lockClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
  };
  return new ApplicationsCrudService(
    { manager } as any,
    { log: async () => undefined } as any,
    null as any,
    settings as any,
    null as any,
  );
}

async function testReviewerNameIsTenantScopedAndNameOnly() {
  const calls: any[] = [];
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (params[1] === tenantId) return [{ first_name: 'Ada', last_name: 'Lovelace', email: 'must-not-render@example.invalid' }];
      return [];
    },
  };
  const service = createService(manager);
  const lookup = (service as any).classificationReviewerName.bind(service);
  const name = await lookup({ tenant_id: tenantId, classification_review: { user_id: reviewerId } }, manager);
  assert.equal(name, 'Ada Lovelace');
  assert.deepEqual(calls[0].params, [reviewerId, tenantId]);
  assert.doesNotMatch(name, /@|[0-9a-f]{8}-/i);

  const absent = await lookup({ tenant_id: otherTenantId, classification_review: { user_id: reviewerId } }, manager);
  assert.equal(absent, null, 'a reviewer from another tenant must not be displayed');
  const unnamed = await lookup({ tenant_id: tenantId, classification_review: { user_id: randomUUID() } }, {
    query: async () => [{ first_name: null, last_name: null, email: 'no-name@example.invalid' }],
  });
  assert.equal(unnamed, null, 'email and UUID must not be reviewer-name fallbacks');
}

async function testReviewRecordsTimestampAndRejectsStaleRevision() {
  const app: any = {
    id: applicationId,
    tenant_id: tenantId,
    criticality: 'business_critical',
    cyber_criticality: 'critical',
    data_class: 'restricted',
    recovery_wave: 'vital',
    classification_justification: 'Approved classification.',
    classification_revision: 4,
    classification_review: null,
  };
  const repo = { findOne: async () => app, save: async (value: any) => value };
  const manager: any = {
    transaction: async (work: any) => work(manager),
    getRepository: () => repo,
    query: async (sql: string) => {
      if (sql.includes('SELECT app_current_tenant()')) return [{ tenant_id: tenantId }];
      if (sql.includes('FROM users')) return [{ id: reviewerId }];
      if (sql.includes('FROM applications') && !sql.includes('FOR UPDATE')) return [{ id: applicationId }];
      return [];
    },
  };
  const service = createService(manager);
  await assert.rejects(
    () => service.reviewClassification(applicationId, 3, reviewerId, { manager }),
    (error: unknown) => error instanceof ConflictException && /reload before marking/i.test(error.message),
  );
  assert.equal(app.classification_review, null);
  const reviewed = await service.reviewClassification(applicationId, 4, reviewerId, { manager });
  assert.deepEqual(Object.keys(app.classification_review).sort(), ['reviewed_at', 'revision', 'user_id'], 'review is a timestamp: no catalog version is recorded');
  assert.equal(reviewed.classification_review_state, 'reviewed');
  assert.equal(app.classification_review.revision, 4);
}

function testReviewerDisplayIsServerManaged() {
  assert.throws(
    () => classificationPatch({ classification_reviewer_name: 'Injected Name' }, null, DEFAULT_CLASSIFICATION_CATALOG),
    /server-managed/,
  );
}

async function main() {
  await testReviewerNameIsTenantScopedAndNameOnly();
  await testReviewRecordsTimestampAndRejectsStaleRevision();
  testReviewerDisplayIsServerManaged();
  console.log('Application classification reviewer display and review timestamp passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

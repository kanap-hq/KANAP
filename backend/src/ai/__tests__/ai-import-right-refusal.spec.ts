import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { Features } from '../../config/features';
import { Tenant, TenantStatus } from '../../tenants/tenant.entity';
import { UserRole } from '../../users/user-role.entity';
import { Subscription } from '../../billing/subscription.entity';
import { AuditLog } from '../../audit/audit.entity';
import type { PermissionLevel, Resource } from '../../permissions/permissions.service';
import { AiPolicyService } from '../ai-policy.service';
import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiMutationPlan } from '../ai-mutation-plan.entity';
import { AiMutationPlanStep } from '../ai-mutation-plan-step.entity';
import { aiPermissionLevelLabel, aiResourceLabel } from '../ai-role-labels';
import type { AiScreenLanguage } from '../ai-unread-families';
import { aiWriteRequirements } from '../mutation/ai-write-levels';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';
import { AI_IMPORT_ACCESS, AI_IMPORT_KEYS, AI_IMPORT_RESOURCES } from '../import/ai-import-access';
import { AiImportMappingService } from '../import/ai-import-mapping.service';
import type { AiImportRunnerService } from '../import/ai-import-runner.service';
import { importRightRefusal } from '../import/ai-import-right-refusal';

/**
 * Lot I6d: a person who prepares changes with Kad is offered the import, and a family they may
 * not import is refused before the file is read. The refusal names the right as Admin › Roles
 * does, in the person's language, and asks for no row of the file. A person who holds the right
 * still gets the card. A reader, who cannot prepare changes, keeps the refusal of that side.
 */

const TENANT = 'tenant-1';
const USER = 'user-1';
const FILE = '11111111-1111-4111-8111-111111111111';
const LANGUAGES: readonly AiScreenLanguage[] = ['en', 'fr', 'de', 'es'];

const EN_BUDGET = 'Import refused: the missing right is "Admin" on "Budget", as Admin › Roles names it. '
  + 'Tell the person that right in those words. Suggest they ask a person who has it, or import the file on the screen if they have the right there, and stop. '
  + 'Create no row of the file, and do not offer to create its rows one by one.';
const FR_BUDGET = 'Import refused: the missing right is "Administrateur" on "Budget", as Admin › Roles names it. '
  + 'Tell the person that right in those words. Suggest they ask a person who has it, or import the file on the screen if they have the right there, and stop. '
  + 'Create no row of the file, and do not offer to create its rows one by one.';

function testTheRefusalNamesEachImportRight() {
  assert.equal(importRightRefusal('budget', 'admin', 'en').message, EN_BUDGET);
  assert.equal(importRightRefusal('budget', 'admin', 'fr').message, FR_BUDGET);
  for (const key of AI_IMPORT_KEYS) {
    const access = AI_IMPORT_ACCESS[key];
    for (const language of LANGUAGES) {
      const error = importRightRefusal(access.resource, access.level, language);
      const body = coded(error);
      const moduleName = aiResourceLabel(access.resource as Resource, language);
      const levelName = aiPermissionLevelLabel(access.level, language);
      assert.ok(moduleName, `${key} ${language}: the module has a name on Admin › Roles`);
      assert.equal(body.code, 'MODULE_RIGHT_REQUIRED', key);
      assert.deepEqual(body.params, { resource: access.resource, level: access.level }, `${key} ${language}`);
      assert.ok(error.message.includes(`"${levelName}" on "${moduleName}"`), `${key} ${language}: ${error.message}`);
      assert.equal(error.message.includes(`${access.resource}:${access.level}`), false, `${key}: no permission code`);
      assert.match(error.message, /Create no row of the file, and do not offer to create its rows one by one\./);
      assert.match(error.message, /ask a person who has it/);
      assert.match(error.message, /import the file on the screen/);
    }
  }
  console.log(`  ${AI_IMPORT_KEYS.length} imports, four languages: OK`);
}

function testTheImportIsOfferedToAnyoneWhoWrites() {
  assert.deepEqual(aiWriteRequirements('prepare_import_mapping', AI_IMPORT_RESOURCES), [
    { resource: 'ai_chat', level: 'member' },
  ]);
  assert.deepEqual(aiWriteRequirements('prepare_import_mapping', []), [
    { resource: 'ai_chat', level: 'member' },
  ]);
  console.log('  offered to anyone who prepares changes: OK');
}

type Harness = ReturnType<typeof createImport>;

function createImport(permissions: Record<string, string>, locale: string) {
  const previews: any[] = [];
  let fileReads = 0;
  let settingsReads = 0;
  const runs: string[] = [];
  const manager = {
    previews,
    query: async (sql: string) => {
      if (/app\.da_mode|data_access_mode/.test(sql)) return [{ limited: false }];
      if (/SELECT locale FROM users/.test(sql)) return [{ locale }];
      return [];
    },
    getRepository(entity: unknown) {
      if (entity === AiMutationPreview) {
        return {
          find: async () => previews.filter((preview) => preview.status === 'pending'),
          update: async () => undefined,
          findOne: async () => null,
          count: async () => previews.filter((preview) => preview.status === 'pending').length,
          create: (payload: any) => ({ id: `preview-${previews.length + 1}`, ...payload }),
          save: async (record: any) => {
            previews.push(record);
            return record;
          },
          createQueryBuilder: () => {
            const chain: any = { update: () => chain, set: () => chain, where: () => chain, andWhere: () => chain, execute: async () => ({ affected: 0 }) };
            return chain;
          },
        };
      }
      if (entity === AiMutationPlan || entity === AiMutationPlanStep || entity === UserRole) {
        return { find: async () => [], findOne: async () => null };
      }
      if (entity === Tenant) return { findOne: async () => ({ id: TENANT, status: TenantStatus.ACTIVE }) };
      if (entity === Subscription) return { findOne: async () => null };
      if (entity === AuditLog) return { insert: async () => ({ identifiers: [{ id: 'audit-1' }] }) };
      throw new Error(`Unexpected repository request: ${String(entity)}`);
    },
  };
  const attachments = {
    assertAndLoadAttachments: async (ids: string[]) => {
      fileReads += 1;
      return ids.map((id) => ({ id, kind: 'table', original_filename: 'lines.csv' }));
    },
    loadAttachmentBuffer: async (id: string) => {
      fileReads += 1;
      return { attachment: { id }, buffer: Buffer.from('title\nCellar door\n', 'utf8') };
    },
  };
  const policy = new AiPolicyService(
    { findById: async () => ({ id: USER, status: 'enabled', role_id: 'role-1', role: { role_name: 'Member', is_system: false } }) } as any,
    { listForRoles: async () => new Map(Object.entries({ ai_chat: 'member', ...permissions })) } as any,
    {
      get: async () => ({ tenant_id: TENANT, chat_enabled: true, mcp_enabled: true, provider_source: 'custom' }),
      getProviderValidationErrors: async () => [],
      getProviderErrorsWithoutConfirmation: async () => [],
    } as any,
    { validate: () => [] } as any,
    { isConfigured: async () => true } as any,
    { isConfigured: () => false } as any,
  );
  const runner = {
    run: async (key: string) => {
      runs.push(key);
      return {
        ok: true, dry_run: true, total: 1, inserted: 1, updated: 0, unchanged: 0, skipped: 0,
        error_count: 0, warning_count: 0, issues: [], report: { kind: 'rows', errors: [], warnings: [] },
      };
    },
  } as unknown as AiImportRunnerService;
  const settings = { getSettings: async () => { settingsReads += 1; return { incidentCategories: [] }; } };
  const mapping = new AiImportMappingService(attachments as any, settings as any, policy, runner);
  const operation = new PrepareImportMappingAiMutationOperation(mapping);
  const registry = {
    getOperation: (name: string) => {
      if (name !== operation.toolName) throw new Error(`Unsupported preview type ${name}`);
      return operation;
    },
    getOperationOrNull: (name: string) => (name === operation.toolName ? operation : null),
    isSupportedToolName: (name: string) => name === operation.toolName,
    listOperations: () => [operation],
  };
  const previewsService = new AiMutationPreviewService(
    { manager } as any, { manager } as any, { manager } as any, policy, registry as any,
  );
  const context = {
    tenantId: TENANT, userId: USER, isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: 'conv-1', manager: manager as any,
  };
  return { mapping, previews: previewsService, context, manager, runs, fileReads: () => fileReads, settingsReads: () => settingsReads };
}

function coded(error: unknown): { code?: string; message?: string; params?: { resource?: string; level?: string } } {
  assert.ok(error instanceof ForbiddenException, error instanceof Error ? error.message : String(error));
  const body = error.getResponse();
  assert.equal(typeof body, 'object');
  return body as { code?: string; message?: string; params?: { resource?: string; level?: string } };
}

async function refused(run: Promise<unknown>): Promise<ForbiddenException> {
  const error = await run.then(() => null, (caught: unknown) => caught);
  assert.ok(error instanceof ForbiddenException, error instanceof Error ? error.message : 'not refused');
  return error;
}

const INCIDENT_INPUT = {
  attachment_id: FILE,
  entity_type: 'incidents',
  columns: [{ column: 'title', source: 1, confidence: 'high' as const }],
};

async function assertImportRefusal(harness: Harness, language: AiScreenLanguage, resource: string, level: PermissionLevel) {
  const expected = importRightRefusal(resource, level, language);
  const onCard = await refused(harness.previews.createPreview(harness.context, 'prepare_import_mapping', INCIDENT_INPUT));
  const onTemplate = await refused(harness.mapping.describeTemplate(harness.context, 'incidents', language));
  for (const error of [onCard, onTemplate]) {
    assert.equal(error.message, expected.message);
    assert.deepEqual(coded(error).params, { resource, level });
    assert.equal(coded(error).code, 'MODULE_RIGHT_REQUIRED');
  }
  assert.equal(harness.manager.previews.length, 0, 'no preview');
  assert.equal(harness.fileReads(), 0, 'the file is not read');
  assert.equal(harness.settingsReads(), 0, 'the template is not read');
  assert.deepEqual(harness.runs, [], 'the import does not run');
}

async function testAWriterWithoutTheRightIsRefusedBeforeTheFile() {
  for (const language of LANGUAGES) {
    const harness = createImport({ incidents: 'reader' }, language);
    await assertImportRefusal(harness, language, 'incidents', 'contributor');
  }
  const budget = createImport({ budget: 'member' }, 'en');
  const error = await refused(budget.previews.createPreview(budget.context, 'prepare_import_mapping', {
    attachment_id: FILE, entity_type: 'budget_lines', columns: [{ column: 'name', source: 1, confidence: 'high' }],
  }));
  assert.equal(error.message, EN_BUDGET);
  assert.equal(budget.manager.previews.length, 0);
  assert.equal(budget.fileReads(), 0);
  const applications = createImport({ applications: 'member' }, 'es');
  const spanish = await refused(applications.mapping.describeTemplate(applications.context, 'applications', 'es'));
  assert.equal(spanish.message, importRightRefusal('applications', 'admin', 'es').message);
  assert.match(spanish.message, /"Administrador" on "Aplicaciones"/);
  assert.equal(applications.settingsReads(), 0);
  console.log('  a writer without the import right: refused, no preview: OK');
}

async function testAHolderStillGetsTheCard() {
  const harness = createImport({ incidents: 'contributor' }, 'fr');
  const card = await harness.previews.createPreview(harness.context, 'prepare_import_mapping', INCIDENT_INPUT);
  assert.equal(card.status, 'pending');
  assert.ok(card.import_mapping);
  assert.equal(harness.runs.length, 1);
  const template = await harness.mapping.describeTemplate(harness.context, 'incidents', 'fr');
  assert.ok(template.columns.some((column) => column.column === 'title'));
  console.log('  a person who holds the right still gets the card: OK');
}

async function testAReaderKeepsTheWriteSideRefusal() {
  const harness = createImport({ ai_chat: 'reader', incidents: 'admin', budget: 'admin' }, 'fr');
  const error = await refused(harness.previews.createPreview(harness.context, 'prepare_import_mapping', INCIDENT_INPUT));
  const body = coded(error);
  assert.equal(body.code, 'MODULE_RIGHT_REQUIRED');
  assert.deepEqual(body.params, { resource: 'ai_chat', level: 'member' });
  assert.match(error.message, /not prepare changes/);
  assert.equal(error.message.includes('Import refused'), false);
  assert.equal(harness.manager.previews.length, 0);
  assert.equal(harness.fileReads(), 0);
  console.log('  a reader keeps the write-side refusal: OK');
}

async function run() {
  const original = Features.AI_CHAT_ENABLED;
  Features.AI_CHAT_ENABLED = true;
  try {
    testTheRefusalNamesEachImportRight();
    testTheImportIsOfferedToAnyoneWhoWrites();
    await testAWriterWithoutTheRightIsRefusedBeforeTheFile();
    await testAHolderStillGetsTheCard();
    await testAReaderKeepsTheWriteSideRefusal();
  } finally {
    Features.AI_CHAT_ENABLED = original;
  }
  console.log('ai-import-right-refusal.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

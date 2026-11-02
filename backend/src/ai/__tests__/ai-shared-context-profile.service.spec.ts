import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AiSharedContextProfileService } from '../control-plane/agent-control/ai-shared-context-profile.service';
import { AiAgentAuditEvent } from '../control-plane/entities/ai-agent-audit-event.entity';
import { AiSharedContextProfile } from '../control-plane/entities/ai-shared-context-profile.entity';
import { AiExecutionContextWithManager } from '../ai.types';

type Row = Record<string, any>;

function createHarness() {
  const profiles: Row[] = [];
  const events: Row[] = [];
  let seq = 0;
  const repoFor = (entity: unknown) => {
    const store = entity === AiSharedContextProfile ? profiles : entity === AiAgentAuditEvent ? events : null;
    if (!store) throw new Error(`Unexpected repository: ${String(entity)}`);
    return {
      create(row: Row) {
        return { ...row };
      },
      async save(row: Row) {
        if (!row.id) {
          seq += 1;
          row.id = `row-${seq}`;
        }
        const saved = { ...row };
        const index = store.findIndex((item) => item.id === saved.id);
        if (index >= 0) store[index] = saved;
        else store.push(saved);
        return saved;
      },
      async findOne({ where }: { where: Record<string, unknown> }) {
        return store.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
      },
      async find({ where }: { where?: Record<string, unknown> } = {}) {
        return store.filter((row) => !where || Object.entries(where).every(([key, value]) => row[key] === value));
      },
    };
  };
  const context = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'chat',
    authMethod: 'jwt',
    manager: { getRepository: repoFor },
  } as AiExecutionContextWithManager;
  return { context, profiles, events, service: new AiSharedContextProfileService() };
}

async function testArchiveThenRestore() {
  const { context, events, service } = createHarness();
  const created = await service.create(context, {
    name: 'House rules',
    profile_key: 'house-rules',
    lines: ['Never ask for passwords.'],
  });
  assert.equal(created.profile.status, 'active');
  assert.equal(created.profile.config_version, 1);

  const archived = await service.archive(context, String(created.profile.id));
  assert.equal(archived.profile.status, 'archived');
  assert.equal(archived.profile.config_version, 2);
  // The key stays taken while the profile is archived: a new profile cannot reuse it.
  await assert.rejects(
    () => service.create(context, { name: 'House rules', profile_key: 'house-rules', lines: ['Again.'] }),
    (error: unknown) => error instanceof BadRequestException && /key already exists/i.test(String((error as Error).message)),
  );

  const restored = await service.restore(context, String(created.profile.id));
  assert.equal(restored.profile.status, 'active');
  assert.equal(restored.profile.config_version, 3);
  assert.equal(restored.profile.profile_key, 'house-rules');

  const restoredEvents = events.filter((event) => event.event_type === 'shared_context_profile_restored');
  assert.equal(restoredEvents.length, 1);
  assert.equal(restoredEvents[0].tenant_id, 'tenant-1');
  assert.equal(restoredEvents[0].message, 'Shared context profile House rules was restored.');
  assert.equal(restoredEvents[0].metadata_json.shared_context_profile_id, created.profile.id);
  assert.equal(restoredEvents[0].metadata_json.shared_context_profile_key, 'house-rules');
  assert.equal(restoredEvents[0].metadata_json.shared_context_version, 3);
  assert.ok(events.some((event) => event.event_type === 'shared_context_profile_archived'));

  // A second restore is a no-op: the profile is already active.
  const again = await service.restore(context, String(created.profile.id));
  assert.equal(again.profile.status, 'active');
  assert.equal(again.profile.config_version, 3);
  assert.equal(events.filter((event) => event.event_type === 'shared_context_profile_restored').length, 1);
}

async function testRestoreOfActiveProfileIsNoOp() {
  const { context, events, service } = createHarness();
  const created = await service.create(context, { name: 'Still active', lines: ['One line.'] });
  const before = events.length;
  const restored = await service.restore(context, String(created.profile.id));
  assert.equal(restored.profile.status, 'active');
  assert.equal(restored.profile.config_version, 1);
  assert.equal(events.length, before);
  assert.equal(events.some((event) => event.event_type === 'shared_context_profile_restored'), false);
}

async function testRestoreMissingOrOtherTenant() {
  const { context, profiles, service } = createHarness();
  await assert.rejects(
    () => service.restore(context, 'missing'),
    (error: unknown) => error instanceof NotFoundException,
  );
  profiles.push({
    id: 'other',
    tenant_id: 'tenant-2',
    profile_key: 'other',
    name: 'Other tenant',
    description: null,
    content_json: { lines: ['Hidden.'] },
    status: 'archived',
    config_version: 2,
    updated_by_user_id: null,
    metadata_json: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await assert.rejects(
    () => service.restore(context, 'other'),
    (error: unknown) => error instanceof NotFoundException,
  );
  assert.equal(profiles.find((row) => row.id === 'other')?.status, 'archived');
}

async function run() {
  await testArchiveThenRestore();
  await testRestoreOfActiveProfileIsNoOp();
  await testRestoreMissingOrOtherTenant();
  console.log('ai-shared-context-profile.service.spec.ts: ok');
}

void run();

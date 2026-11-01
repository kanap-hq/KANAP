import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiAgentAuditEvent } from '../entities/ai-agent-audit-event.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiSharedContextProfile } from '../entities/ai-shared-context-profile.entity';
import { ResolvedSharedContext } from './ai-agent-prompt-compiler.service';
import { isRecord } from '../../../common/object-guards';

export type SharedContextResolutionReason =
  | 'disabled'
  | 'not_configured'
  | 'invalid_profile_id'
  | 'not_found'
  | 'archived';

export type SharedContextResolution = {
  resolved: boolean;
  reason: SharedContextResolutionReason | null;
  requested_profile_id: string | null;
  context: ResolvedSharedContext | null;
};

export type SharedContextProfileInput = {
  profile_key?: string | null;
  name?: string | null;
  description?: string | null;
  content_json?: Record<string, unknown> | null;
  lines?: string[] | null;
};

const MAX_NAME_CHARS = 160;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_PROFILE_KEY_CHARS = 120;
const MAX_LINES = 60;
const MAX_LINE_CHARS = 800;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanSingleLine(value: unknown, max: number): string | null {
  if (value == null) return null;
  const normalized = String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  return normalized.length > max ? normalized.slice(0, max).trimEnd() : normalized;
}

function cleanProfileKey(value: unknown, fallbackName?: string | null): string {
  const raw = cleanSingleLine(value, MAX_PROFILE_KEY_CHARS)
    ?? cleanSingleLine(fallbackName, MAX_PROFILE_KEY_CHARS)
    ?? 'shared-context';
  const slug = raw
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_PROFILE_KEY_CHARS);
  return slug || 'shared-context';
}

function cleanLines(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.lines)
      ? value.lines
      : [];
  return source
    .map((line) => cleanSingleLine(line, MAX_LINE_CHARS))
    .filter((line): line is string => !!line)
    .slice(0, MAX_LINES);
}

function profileContent(input: SharedContextProfileInput): Record<string, unknown> {
  return {
    lines: cleanLines(input.lines ?? input.content_json),
  };
}

function personaSharedContext(definition: AiAgentDefinition): { enabled: boolean; profile_id: string | null } {
  const persona = isRecord(definition.persona_json) ? definition.persona_json : {};
  const shared = isRecord(persona.shared_context) ? persona.shared_context : {};
  const enabled = shared.enabled === true;
  const profileId = cleanSingleLine(shared.profile_id, 80);
  return {
    enabled,
    profile_id: profileId,
  };
}

function serializeProfile(profile: AiSharedContextProfile): Record<string, unknown> {
  const content = isRecord(profile.content_json) ? profile.content_json : {};
  return {
    id: profile.id,
    profile_key: profile.profile_key,
    name: profile.name,
    description: profile.description,
    content_json: {
      lines: cleanLines(content),
    },
    status: profile.status,
    config_version: profile.config_version,
    updated_by_user_id: profile.updated_by_user_id,
    metadata_json: profile.metadata_json,
    created_at: profile.created_at?.toISOString?.() ?? String(profile.created_at),
    updated_at: profile.updated_at?.toISOString?.() ?? String(profile.updated_at),
  };
}

@Injectable()
export class AiSharedContextProfileService {
  async list(context: AiExecutionContextWithManager): Promise<{ items: Record<string, unknown>[] }> {
    const rows = await context.manager.getRepository(AiSharedContextProfile).find({
      where: { tenant_id: context.tenantId },
      order: { status: 'ASC', name: 'ASC' },
    });
    return { items: rows.map(serializeProfile) };
  }

  async create(context: AiExecutionContextWithManager, input: SharedContextProfileInput = {}): Promise<{ profile: Record<string, unknown> }> {
    const name = cleanSingleLine(input.name, MAX_NAME_CHARS);
    if (!name) {
      throw new BadRequestException('Shared context profile name is required.');
    }
    const profileKey = cleanProfileKey(input.profile_key, name);
    const repo = context.manager.getRepository(AiSharedContextProfile);
    const existing = await repo.findOne({ where: { tenant_id: context.tenantId, profile_key: profileKey } });
    if (existing) {
      throw new BadRequestException('Shared context profile key already exists.');
    }
    const now = new Date();
    const profile = await repo.save(repo.create({
      tenant_id: context.tenantId,
      profile_key: profileKey,
      name,
      description: cleanSingleLine(input.description, MAX_DESCRIPTION_CHARS),
      content_json: profileContent(input),
      status: 'active',
      config_version: 1,
      updated_by_user_id: context.userId || null,
      metadata_json: null,
      created_at: now,
      updated_at: now,
    }));
    await this.recordAuditEvent(context, 'shared_context_profile_created', `Shared context profile ${profile.name} was created.`, profile);
    return { profile: serializeProfile(profile) };
  }

  async update(
    context: AiExecutionContextWithManager,
    id: string,
    input: SharedContextProfileInput = {},
  ): Promise<{ profile: Record<string, unknown> }> {
    const repo = context.manager.getRepository(AiSharedContextProfile);
    const profile = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!profile) {
      throw new NotFoundException('Shared context profile not found.');
    }
    if (Object.prototype.hasOwnProperty.call(input, 'profile_key')) {
      const nextKey = cleanProfileKey(input.profile_key, profile.name);
      if (nextKey !== profile.profile_key) {
        const existing = await repo.findOne({ where: { tenant_id: context.tenantId, profile_key: nextKey } });
        if (existing && existing.id !== profile.id) {
          throw new BadRequestException('Shared context profile key already exists.');
        }
        profile.profile_key = nextKey;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'name')) {
      const name = cleanSingleLine(input.name, MAX_NAME_CHARS);
      if (!name) throw new BadRequestException('Shared context profile name is required.');
      profile.name = name;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'description')) {
      profile.description = cleanSingleLine(input.description, MAX_DESCRIPTION_CHARS);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'content_json') || Object.prototype.hasOwnProperty.call(input, 'lines')) {
      profile.content_json = profileContent(input);
    }
    profile.config_version = Math.max(1, Number(profile.config_version) || 1) + 1;
    profile.updated_by_user_id = context.userId || null;
    profile.updated_at = new Date();
    const saved = await repo.save(profile);
    await this.recordAuditEvent(context, 'shared_context_profile_updated', `Shared context profile ${saved.name} was updated.`, saved);
    return { profile: serializeProfile(saved) };
  }

  async archive(context: AiExecutionContextWithManager, id: string): Promise<{ profile: Record<string, unknown> }> {
    const repo = context.manager.getRepository(AiSharedContextProfile);
    const profile = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!profile) {
      throw new NotFoundException('Shared context profile not found.');
    }
    profile.status = 'archived';
    profile.config_version = Math.max(1, Number(profile.config_version) || 1) + 1;
    profile.updated_by_user_id = context.userId || null;
    profile.updated_at = new Date();
    const saved = await repo.save(profile);
    await this.recordAuditEvent(context, 'shared_context_profile_archived', `Shared context profile ${saved.name} was archived.`, saved);
    return { profile: serializeProfile(saved) };
  }

  async restore(context: AiExecutionContextWithManager, id: string): Promise<{ profile: Record<string, unknown> }> {
    const repo = context.manager.getRepository(AiSharedContextProfile);
    const profile = await repo.findOne({ where: { id, tenant_id: context.tenantId } });
    if (!profile) {
      throw new NotFoundException('Shared context profile not found.');
    }
    // An active profile is already in the state restore would reach. A second
    // call leaves the version and the audit trail unchanged.
    if (profile.status === 'active') {
      return { profile: serializeProfile(profile) };
    }
    profile.status = 'active';
    profile.config_version = Math.max(1, Number(profile.config_version) || 1) + 1;
    profile.updated_by_user_id = context.userId || null;
    profile.updated_at = new Date();
    const saved = await repo.save(profile);
    await this.recordAuditEvent(context, 'shared_context_profile_restored', `Shared context profile ${saved.name} was restored.`, saved);
    return { profile: serializeProfile(saved) };
  }

  async resolveForAgent(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition | null,
  ): Promise<SharedContextResolution> {
    if (!definition) {
      return { resolved: false, reason: 'not_configured', requested_profile_id: null, context: null };
    }
    const shared = personaSharedContext(definition);
    if (!shared.enabled) {
      return { resolved: false, reason: 'disabled', requested_profile_id: shared.profile_id, context: null };
    }
    if (!shared.profile_id) {
      return { resolved: false, reason: 'not_configured', requested_profile_id: null, context: null };
    }
    if (!UUID_RE.test(shared.profile_id)) {
      return { resolved: false, reason: 'invalid_profile_id', requested_profile_id: shared.profile_id, context: null };
    }
    const profile = await context.manager.getRepository(AiSharedContextProfile).findOne({
      where: {
        id: shared.profile_id,
        tenant_id: context.tenantId,
      },
    });
    if (!profile) {
      return { resolved: false, reason: 'not_found', requested_profile_id: shared.profile_id, context: null };
    }
    if (profile.status !== 'active') {
      return { resolved: false, reason: 'archived', requested_profile_id: shared.profile_id, context: null };
    }
    const lines = cleanLines(profile.content_json);
    return {
      resolved: true,
      reason: null,
      requested_profile_id: shared.profile_id,
      context: {
        profile_id: profile.id,
        version: profile.config_version,
        name: profile.name,
        lines,
      },
    };
  }

  private async recordAuditEvent(
    context: AiExecutionContextWithManager,
    eventType: string,
    message: string,
    profile: AiSharedContextProfile,
  ): Promise<void> {
    const repo = context.manager.getRepository(AiAgentAuditEvent);
    await repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_definition_id: null,
      work_item_id: null,
      event_type: eventType,
      severity: 'info',
      message,
      metadata_json: {
        shared_context_profile_id: profile.id,
        shared_context_profile_key: profile.profile_key,
        shared_context_version: profile.config_version,
      },
      created_at: new Date(),
    }));
  }
}

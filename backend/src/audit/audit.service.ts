import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit.entity';

export type AuditSourceOptions = {
  source?: 'user' | 'system' | 'webhook' | string;
  sourceRef?: string | null;
};

/** Keys never written to `before_json` / `after_json`, at any depth and for every table. */
export const AUDIT_OMITTED_KEYS: ReadonlySet<string> = new Set(['password_hash', 'mfa_secret']);

/**
 * A copy of `value` without the omitted keys, at any depth of plain objects and arrays. Values
 * that serialize themselves (dates and anything else with `toJSON`) and primitives are kept as
 * they are; the input is never modified. A value that contains none of the keys is returned
 * as is.
 */
export function omitAuditSecrets<T>(value: T): T {
  return strip(value, new WeakMap()) as T;
}

function strip(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (typeof (value as { toJSON?: unknown }).toJSON === 'function') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    let changed = false;
    for (const item of value) {
      const next = strip(item, seen);
      if (next !== item) changed = true;
      copy.push(next);
    }
    if (changed) return copy;
    seen.set(value, value);
    return value;
  }
  const copy: Record<string, unknown> = {};
  seen.set(value, copy);
  let changed = false;
  for (const [key, item] of Object.entries(value)) {
    if (AUDIT_OMITTED_KEYS.has(key)) {
      changed = true;
      continue;
    }
    const next = strip(item, seen);
    if (next !== item) changed = true;
    copy[key] = next;
  }
  if (changed) return copy;
  seen.set(value, value);
  return value;
}

export type AuditEntry = {
  table: string;
  recordId?: string | null;
  action: string;
  before?: any | null;
  after?: any | null;
  userId?: string | null;
  source?: 'user' | 'system' | 'webhook' | string;
  sourceRef?: string | null;
};

/**
 * Writes one `audit_log` row with `manager`, whose transaction carries the tenant
 * (`app.current_tenant`, the default of `tenant_id`). `AuditService.log` and the security
 * events (security-events.service.ts, export-events.interceptor.ts) write through here.
 */
export async function writeAuditLog(manager: EntityManager, params: AuditEntry): Promise<void> {
  await manager.getRepository(AuditLog).insert({
    table_name: params.table,
    record_id: params.recordId ?? null,
    action: params.action,
    before_json: omitAuditSecrets(params.before ?? null),
    after_json: omitAuditSecrets(params.after ?? null),
    user_id: params.userId ?? null,
    source: params.source ?? (params.userId ? 'user' : 'system'),
    source_ref: params.sourceRef ?? null,
    // The moment of the write, not the start of its transaction (`now()`): a write that waited
    // for a row lock is stamped after the one it waited for, so a record's history follows the
    // order its changes were committed in (plan planning/perf-scale, lot 3B).
    created_at: () => 'clock_timestamp()',
  } as any);
}

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(params: AuditEntry & { action: 'create' | 'update' | 'disable' | 'delete' }, opts?: { manager?: EntityManager }) {
    await writeAuditLog(opts?.manager ?? this.repo.manager, params);
  }
}

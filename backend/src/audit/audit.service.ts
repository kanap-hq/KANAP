import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit.entity';

export type AuditSourceOptions = {
  source?: 'user' | 'system' | 'webhook' | string;
  sourceRef?: string | null;
};

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async log(params: {
    table: string;
    recordId?: string | null;
    action: 'create' | 'update' | 'disable' | 'delete';
    before?: any | null;
    after?: any | null;
    userId?: string | null;
    source?: 'user' | 'system' | 'webhook' | string;
    sourceRef?: string | null;
  }, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(AuditLog);
    await repo.insert({
      table_name: params.table,
      record_id: params.recordId ?? null,
      action: params.action,
      before_json: params.before ?? null,
      after_json: params.after ?? null,
      user_id: params.userId ?? null,
      source: params.source ?? (params.userId ? 'user' : 'system'),
      source_ref: params.sourceRef ?? null,
      // The moment of the write, not the start of its transaction (`now()`): a write that waited
      // for a row lock is stamped after the one it waited for, so a record's history follows the
      // order its changes were committed in (plan planning/perf-scale, lot 3B).
      created_at: () => 'clock_timestamp()',
    } as any);
  }
}

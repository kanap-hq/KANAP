import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { RelatedType } from '../../tasks/tasks-unified.service';
import { AiExecutionContextWithManager } from '../ai.types';
import {
  participantConditionForAiEntity,
  ParticipationScopedAiEntityType,
  resolveAiParticipationAccessScope,
} from '../query/ai-query-scope.util';

const TASK_REF_RE = /^T-(\d+)$/i;
const PROJECT_REF_RE = /^(?:PRJ-|project\s+#?|prj\s+#?|#)?(\d+)$/i;

type AiTaskUserCandidate = {
  id: string;
  email: string | null;
  label: string;
};

type AiTaskCreateTargetMode = 'standalone' | 'project' | 'spend_item' | 'capex_item';

type AiTaskCreateTargetCandidate = {
  id: string;
  ref: string | null;
  label: string;
  name: string | null;
  updated_at: string | null;
};

type AiTaskTargetQueryConfig = {
  mode: Exclude<AiTaskCreateTargetMode, 'standalone'>;
  type: Exclude<RelatedType, null>;
  table: string;
  nameColumn: string;
  subject: string;
  displayPrefix: string;
  itemPrefix?: string;
  /** A predicate on the target row: a `spend_item` names an OPEX line, a `capex_item` a CAPEX line (`spend/budget-nature.ts`). */
  where?: string;
};

const TARGET_QUERY_CONFIG: Record<Exclude<AiTaskCreateTargetMode, 'standalone'>, AiTaskTargetQueryConfig> = {
  project: {
    mode: 'project',
    type: 'project',
    table: 'portfolio_projects',
    nameColumn: 'name',
    subject: 'project',
    displayPrefix: 'Project',
    itemPrefix: 'PRJ',
  },
  spend_item: {
    mode: 'spend_item',
    type: 'spend_item',
    table: 'spend_items',
    nameColumn: 'product_name',
    subject: 'OPEX item',
    displayPrefix: 'OPEX',
    where: `target.nature = 'opex'`,
  },
  capex_item: {
    mode: 'capex_item',
    type: 'capex_item',
    table: 'spend_items',
    // The CAPEX title (lot Z1).
    nameColumn: 'product_name',
    subject: 'CAPEX item',
    displayPrefix: 'CAPEX',
    where: `target.nature = 'capex'`,
  },
};

export type AiTaskSnapshot = {
  task_id: string;
  target_ref: string | null;
  target_title: string | null;
  status: string | null;
  assignee_user_id: string | null;
  assignee_label: string | null;
};

export type AiTaskUserReference = {
  id: string;
  email: string | null;
  label: string;
};

export type AiTaskCreateTarget = {
  mode: AiTaskCreateTargetMode;
  type: RelatedType;
  id: string | null;
  ref: string | null;
  label: string;
};

export type AiTaskTypeReference = {
  id: string;
  label: string;
};

export type AiTaskPhaseReference = {
  id: string;
  label: string;
};

function buildTaskRef(itemNumber: number | null | undefined): string | null {
  return itemNumber ? `T-${itemNumber}` : null;
}

function buildProjectRef(itemNumber: number | null | undefined): string | null {
  return itemNumber ? `PRJ-${itemNumber}` : null;
}

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function appendParticipationScopeSql(
  entityType: ParticipationScopedAiEntityType,
  alias: string,
  params: unknown[],
  accessScope?: { userId: string },
): string {
  if (!accessScope) return '';
  params.push(accessScope.userId);
  return `AND ${participantConditionForAiEntity(entityType, alias, `$${params.length}`)}`;
}

export function toDisplayStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).replace(/_/g, ' ');
}

export function toDisplayAssignee(value: string | null | undefined): string | null {
  return value ?? 'Unassigned';
}

@Injectable()
export class AiTaskMutationSupportService {
  private buildTargetRef(mode: Exclude<AiTaskCreateTargetMode, 'standalone'>, itemNumber: unknown): string | null {
    const numeric = itemNumber == null ? null : Number(itemNumber);
    if (!Number.isFinite(numeric) || numeric == null) {
      return null;
    }

    if (mode === 'project') {
      return buildProjectRef(numeric);
    }

    return null;
  }

  private buildTargetLabel(
    config: AiTaskTargetQueryConfig,
    row: Record<string, unknown>,
  ): string {
    const ref = this.buildTargetRef(config.mode, row.item_number);
    const name = textOrNull(row.name) ?? String(row.id);
    if (ref) {
      return `${ref} - ${name}`;
    }
    return `${config.displayPrefix} - ${name}`;
  }

  private toTargetCandidate(
    config: AiTaskTargetQueryConfig,
    row: Record<string, unknown>,
  ): AiTaskCreateTargetCandidate {
    return {
      id: String(row.id),
      ref: this.buildTargetRef(config.mode, row.item_number),
      label: this.buildTargetLabel(config, row),
      name: textOrNull(row.name),
      updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    };
  }

  private formatTargetCandidate(candidate: AiTaskCreateTargetCandidate): string {
    const details = candidate.updated_at
      ? `updated ${candidate.updated_at.slice(0, 10)}`
      : null;
    return details ? `${candidate.label} (${details})` : candidate.label;
  }

  private buildTargetAmbiguityMessage(
    config: AiTaskTargetQueryConfig,
    query: string,
    candidates: AiTaskCreateTargetCandidate[],
    opts?: { exactNameAmbiguous?: boolean },
  ): string {
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => this.formatTargetCandidate(candidate));
    const reason = opts?.exactNameAmbiguous
      ? 'is ambiguous'
      : 'was not an exact unique match';

    return [
      `${config.subject} "${query}" ${reason}.`,
      `Most likely: ${this.formatTargetCandidate(primary)}.`,
      others.length > 0 ? `Also found: ${others.join('; ')}.` : null,
      `Ask the user to confirm which ${config.subject} to use before retrying.`,
    ].filter(Boolean).join(' ');
  }

  private formatUserCandidate(candidate: AiTaskUserCandidate): string {
    if (!candidate.email || candidate.label.toLowerCase() === candidate.email.toLowerCase()) {
      return candidate.label;
    }
    return `${candidate.label} <${candidate.email}>`;
  }

  private buildUserAmbiguityMessage(
    query: string,
    candidates: AiTaskUserCandidate[],
  ): string {
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => this.formatUserCandidate(candidate));
    return [
      `Assignee "${query}" is ambiguous.`,
      `Most likely: ${this.formatUserCandidate(primary)}.`,
      others.length > 0 ? `Also found: ${others.join('; ')}.` : null,
      'Ask the user to confirm which user to assign before retrying.',
    ].filter(Boolean).join(' ');
  }

  private buildTaskTypeAmbiguityMessage(
    query: string,
    candidates: AiTaskTypeReference[],
  ): string {
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => candidate.label);
    return [
      `Task type "${query}" is ambiguous.`,
      `Most likely: ${primary.label}.`,
      others.length > 0 ? `Also found: ${others.join('; ')}.` : null,
      'Ask the user to confirm which task type to use before retrying.',
    ].filter(Boolean).join(' ');
  }

  private buildPhaseAmbiguityMessage(
    query: string,
    projectLabel: string,
    candidates: AiTaskPhaseReference[],
  ): string {
    const [primary, ...rest] = candidates;
    const others = rest.slice(0, 2).map((candidate) => candidate.label);
    return [
      `Project phase "${query}" is ambiguous for ${projectLabel}.`,
      `Most likely: ${primary.label}.`,
      others.length > 0 ? `Also found: ${others.join('; ')}.` : null,
      'Ask the user to confirm which project phase to use before retrying.',
    ].filter(Boolean).join(' ');
  }

  private parseProjectItemNumber(input: string): number | null {
    const match = String(input || '').trim().match(PROJECT_REF_RE);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  private toTaskSnapshot(row: any): AiTaskSnapshot {
    return {
      task_id: row.id,
      target_ref: buildTaskRef(row.item_number ?? null),
      target_title: row.title ?? null,
      status: row.status ?? null,
      assignee_user_id: row.assignee_user_id ?? null,
      assignee_label: row.assignee_label ?? null,
    };
  }

  private async getExactTarget(
    context: AiExecutionContextWithManager,
    mode: Exclude<AiTaskCreateTargetMode, 'standalone'>,
    input: string,
  ): Promise<AiTaskCreateTarget> {
    const config = TARGET_QUERY_CONFIG[mode];
    const normalized = String(input || '').trim();
    let rows: Array<Record<string, unknown>> = [];
    const accessScope = mode === 'project'
      ? await resolveAiParticipationAccessScope(context, 'projects')
      : undefined;

    if (isUuid(normalized)) {
      const params: unknown[] = [context.tenantId, normalized];
      const accessScopeSql = mode === 'project'
        ? appendParticipationScopeSql('projects', 'target', params, accessScope)
        : '';
      rows = await context.manager.query(
        `SELECT id,
                target.${config.nameColumn} AS name,
                ${config.itemPrefix ? 'target.item_number,' : 'NULL::int AS item_number,'}
                target.updated_at
         FROM ${config.table} target
         WHERE target.tenant_id = $1${config.where ? ` AND ${config.where}` : ''}
           AND target.id = $2
           ${accessScopeSql}
         LIMIT 1`,
        params,
      );
    } else if (mode === 'project') {
      const itemNumber = this.parseProjectItemNumber(normalized);
      if (itemNumber != null) {
        const params: unknown[] = [context.tenantId, itemNumber];
        const accessScopeSql = appendParticipationScopeSql('projects', 'target', params, accessScope);
        rows = await context.manager.query(
          `SELECT id,
                  target.${config.nameColumn} AS name,
                  target.item_number,
                  target.updated_at
           FROM ${config.table} target
           WHERE target.tenant_id = $1
             AND target.item_number = $2
             ${accessScopeSql}
           LIMIT 1`,
          params,
        );
      }
    }

    if (!rows[0]) {
      throw new NotFoundException(`No ${config.subject} found matching "${normalized}".`);
    }

    const candidate = this.toTargetCandidate(config, rows[0]);
    return {
      mode,
      type: config.type,
      id: candidate.id,
      ref: candidate.ref,
      label: candidate.label,
    };
  }

  private async searchTargetCandidates(
    context: AiExecutionContextWithManager,
    mode: Exclude<AiTaskCreateTargetMode, 'standalone'>,
    query: string,
    limit = 5,
  ): Promise<AiTaskCreateTargetCandidate[]> {
    const config = TARGET_QUERY_CONFIG[mode];
    const normalized = String(query || '').trim();
    const like = `%${normalized}%`;
    const prefix = `${normalized}%`;
    const params: unknown[] = [context.tenantId, like, normalized, prefix];
    let itemNumberSql = '';
    const accessScope = mode === 'project'
      ? await resolveAiParticipationAccessScope(context, 'projects')
      : undefined;

    if (mode === 'project') {
      const itemNumber = this.parseProjectItemNumber(normalized);
      if (itemNumber != null) {
        params.push(itemNumber);
        itemNumberSql = ` OR target.item_number = $${params.length}`;
      }
    }

    const accessScopeSql = mode === 'project'
      ? appendParticipationScopeSql('projects', 'target', params, accessScope)
      : '';
    params.push(Math.min(Math.max(limit, 1), 10));
    const limitRef = `$${params.length}`;

    const rows = await context.manager.query(
      `SELECT id,
              target.${config.nameColumn} AS name,
              ${config.itemPrefix ? 'target.item_number,' : 'NULL::int AS item_number,'}
              target.updated_at
       FROM ${config.table} target
       WHERE target.tenant_id = $1${config.where ? ` AND ${config.where}` : ''}
         ${accessScopeSql}
         AND (
           COALESCE(target.${config.nameColumn}, '') ILIKE $2
           ${itemNumberSql}
         )
       ORDER BY
         CASE
           WHEN lower(COALESCE(target.${config.nameColumn}, '')) = lower($3) THEN 0
           WHEN COALESCE(target.${config.nameColumn}, '') ILIKE $4 THEN 1
           WHEN COALESCE(target.${config.nameColumn}, '') ILIKE $2 THEN 2
           ELSE 3
         END ASC,
         target.updated_at DESC
       LIMIT ${limitRef}`,
      params,
    );

    return rows.map((row: Record<string, unknown>) => this.toTargetCandidate(config, row));
  }

  private async searchUserCandidates(
    context: AiExecutionContextWithManager,
    query: string,
    limit = 5,
  ): Promise<AiTaskUserCandidate[]> {
    const normalized = String(query || '').trim();
    const exact = normalized;
    const like = `%${normalized}%`;
    const prefix = `${normalized}%`;

    const rows = await context.manager.query(
      `
      SELECT u.id,
             u.email,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
      FROM users u
      WHERE u.tenant_id = $1
        AND u.status = 'enabled'
        AND (
          COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) ILIKE $2
          OR u.email ILIKE $2
        )
      ORDER BY
        CASE
          WHEN LOWER(u.email) = LOWER($3) THEN 0
          WHEN LOWER(COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)) = LOWER($3) THEN 1
          WHEN COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) ILIKE $4 THEN 2
          WHEN u.email ILIKE $4 THEN 3
          ELSE 4
        END ASC,
        u.last_name ASC NULLS LAST,
        u.first_name ASC NULLS LAST,
        u.email ASC
      LIMIT $5
      `,
      [context.tenantId, like, exact, prefix, Math.min(Math.max(limit, 1), 10)],
    );

    return rows.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      email: textOrNull(row.email),
      label: String(row.label || row.email || row.id),
    }));
  }

  async resolveTaskSnapshot(
    context: AiExecutionContextWithManager,
    ref: string,
  ): Promise<AiTaskSnapshot> {
    const normalized = String(ref || '').trim();
    if (!normalized) {
      throw new BadRequestException('Task reference is required.');
    }

    let rows: any[] = [];
    const accessScope = await resolveAiParticipationAccessScope(context, 'tasks');
    if (isUuid(normalized)) {
      const params: unknown[] = [context.tenantId, normalized];
      const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
      rows = await context.manager.query(
        `
        SELECT t.id,
               t.item_number,
               t.title,
               t.status,
               t.assignee_user_id,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS assignee_label
        FROM tasks t
        LEFT JOIN users u
          ON u.id = t.assignee_user_id
         AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND t.id = $2
          ${accessScopeSql}
        LIMIT 1
        `,
        params,
      );
    } else {
      const match = normalized.match(TASK_REF_RE);
      if (!match) {
        throw new BadRequestException('Task reference must be a task UUID or a T-123 style reference.');
      }
      const params: unknown[] = [context.tenantId, Number.parseInt(match[1], 10)];
      const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
      rows = await context.manager.query(
        `
        SELECT t.id,
               t.item_number,
               t.title,
               t.status,
               t.assignee_user_id,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS assignee_label
        FROM tasks t
        LEFT JOIN users u
          ON u.id = t.assignee_user_id
         AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND t.item_number = $2
          ${accessScopeSql}
        LIMIT 1
        `,
        params,
      );
    }

    if (!rows[0]) {
      throw new NotFoundException('Task not found.');
    }

    return this.toTaskSnapshot(rows[0]);
  }

  async resolveAssignee(
    context: AiExecutionContextWithManager,
    assigneeEmail: string,
  ): Promise<{ id: string; email: string; label: string }> {
    const normalized = String(assigneeEmail || '').trim();
    if (!normalized) {
      throw new BadRequestException('Assignee email is required.');
    }

    const rows = await context.manager.query(
      `
      SELECT u.id,
             u.email,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
      FROM users u
      WHERE u.tenant_id = $1
        AND LOWER(u.email) = LOWER($2)
        AND u.status = 'enabled'
      LIMIT 1
      `,
      [context.tenantId, normalized],
    );

    if (!rows[0]) {
      throw new NotFoundException('Assignee not found.');
    }

    return rows[0];
  }

  async resolveCurrentUser(
    context: AiExecutionContextWithManager,
  ): Promise<AiTaskUserReference> {
    const rows = await context.manager.query(
      `
      SELECT u.id,
             u.email,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
      FROM users u
      WHERE u.tenant_id = $1
        AND u.id = $2
        AND u.status = 'enabled'
      LIMIT 1
      `,
      [context.tenantId, context.userId],
    );

    if (!rows[0]) {
      throw new NotFoundException('Current user not found.');
    }

    return {
      id: String(rows[0].id),
      email: textOrNull(rows[0].email),
      label: String(rows[0].label || rows[0].email || rows[0].id),
    };
  }

  async resolveUserReference(
    context: AiExecutionContextWithManager,
    assignee: string,
  ): Promise<AiTaskUserReference> {
    const normalized = String(assignee || '').trim();
    if (!normalized) {
      throw new BadRequestException('Assignee is required.');
    }

    if (isUuid(normalized)) {
      const rows = await context.manager.query(
        `
        SELECT u.id,
               u.email,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
        FROM users u
        WHERE u.tenant_id = $1
          AND u.id = $2
          AND u.status = 'enabled'
        LIMIT 1
        `,
        [context.tenantId, normalized],
      );
      if (!rows[0]) {
        throw new NotFoundException('Assignee not found.');
      }
      return {
        id: String(rows[0].id),
        email: textOrNull(rows[0].email),
        label: String(rows[0].label || rows[0].email || rows[0].id),
      };
    }

    const exactEmailRows = await context.manager.query(
      `
      SELECT u.id,
             u.email,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
      FROM users u
      WHERE u.tenant_id = $1
        AND LOWER(u.email) = LOWER($2)
        AND u.status = 'enabled'
      LIMIT 1
      `,
      [context.tenantId, normalized],
    );
    if (exactEmailRows[0]) {
      return {
        id: String(exactEmailRows[0].id),
        email: textOrNull(exactEmailRows[0].email),
        label: String(exactEmailRows[0].label || exactEmailRows[0].email || exactEmailRows[0].id),
      };
    }

    const candidates = await this.searchUserCandidates(context, normalized);
    if (candidates.length === 0) {
      throw new NotFoundException(`No assignee found matching "${normalized}".`);
    }

    const exactLabelMatches = candidates.filter((candidate) =>
      candidate.label.trim().toLowerCase() === normalized.toLowerCase(),
    );
    if (exactLabelMatches.length === 1) {
      return exactLabelMatches[0];
    }
    if (exactLabelMatches.length > 1) {
      throw new BadRequestException(this.buildUserAmbiguityMessage(normalized, exactLabelMatches));
    }
    if (candidates.length === 1) {
      return candidates[0];
    }

    throw new BadRequestException(this.buildUserAmbiguityMessage(normalized, candidates));
  }

  async resolveCreateTarget(
    context: AiExecutionContextWithManager,
    relationType?: AiTaskCreateTargetMode | null,
    relationRef?: string | null,
  ): Promise<AiTaskCreateTarget> {
    const mode = relationType ?? 'standalone';
    const normalizedRef = textOrNull(relationRef);

    if (mode === 'standalone') {
      if (normalizedRef) {
        throw new BadRequestException('relation_ref must be omitted when relation_type is standalone.');
      }
      return {
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      };
    }

    if (!normalizedRef) {
      throw new BadRequestException(`relation_ref is required when relation_type is ${mode}.`);
    }

    if (isUuid(normalizedRef) || (mode === 'project' && this.parseProjectItemNumber(normalizedRef) != null)) {
      return this.getExactTarget(context, mode, normalizedRef);
    }

    const config = TARGET_QUERY_CONFIG[mode];
    const candidates = await this.searchTargetCandidates(context, mode, normalizedRef);
    if (candidates.length === 0) {
      throw new NotFoundException(`No ${config.subject} found matching "${normalizedRef}".`);
    }

    const exactNameMatches = candidates.filter((candidate) =>
      String(candidate.name || '').trim().toLowerCase() === normalizedRef.toLowerCase(),
    );
    if (exactNameMatches.length === 1) {
      const exact = exactNameMatches[0];
      return {
        mode,
        type: config.type,
        id: exact.id,
        ref: exact.ref,
        label: exact.label,
      };
    }
    if (exactNameMatches.length > 1) {
      throw new BadRequestException(
        this.buildTargetAmbiguityMessage(config, normalizedRef, exactNameMatches, { exactNameAmbiguous: true }),
      );
    }
    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        mode,
        type: config.type,
        id: candidate.id,
        ref: candidate.ref,
        label: candidate.label,
      };
    }

    throw new BadRequestException(this.buildTargetAmbiguityMessage(config, normalizedRef, candidates));
  }

  async resolveStoredCreateTarget(
    context: AiExecutionContextWithManager,
    relationType: AiTaskCreateTargetMode,
    relationId: string | null,
  ): Promise<AiTaskCreateTarget> {
    if (relationType === 'standalone') {
      return {
        mode: 'standalone',
        type: null,
        id: null,
        ref: null,
        label: 'Standalone',
      };
    }

    if (!relationId) {
      throw new BadRequestException('Stored relation is missing its target identifier.');
    }

    return this.getExactTarget(context, relationType, relationId);
  }

  async resolveTaskType(
    context: AiExecutionContextWithManager,
    taskType: string,
  ): Promise<AiTaskTypeReference> {
    const normalized = String(taskType || '').trim();
    if (!normalized) {
      throw new BadRequestException('Task type is required.');
    }

    let rows: Array<Record<string, unknown>> = [];
    if (isUuid(normalized)) {
      rows = await context.manager.query(
        `
        SELECT id, name, updated_at
        FROM portfolio_task_types
        WHERE tenant_id = $1
          AND id = $2
          AND is_active = true
        LIMIT 1
        `,
        [context.tenantId, normalized],
      );
    } else {
      const like = `%${normalized}%`;
      const prefix = `${normalized}%`;
      rows = await context.manager.query(
        `
        SELECT id, name, updated_at
        FROM portfolio_task_types
        WHERE tenant_id = $1
          AND is_active = true
          AND name ILIKE $2
        ORDER BY
          CASE
            WHEN lower(name) = lower($3) THEN 0
            WHEN name ILIKE $4 THEN 1
            WHEN name ILIKE $2 THEN 2
            ELSE 3
          END ASC,
          display_order ASC,
          updated_at DESC
        LIMIT 5
        `,
        [context.tenantId, like, normalized, prefix],
      );
    }

    if (rows.length === 0) {
      throw new NotFoundException(`No task type found matching "${normalized}".`);
    }

    const candidates = rows.map((row) => ({
      id: String(row.id),
      label: String(row.name || row.id),
    }));
    const exactMatches = candidates.filter((candidate) =>
      candidate.label.trim().toLowerCase() === normalized.toLowerCase(),
    );
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }
    if (exactMatches.length > 1) {
      throw new BadRequestException(this.buildTaskTypeAmbiguityMessage(normalized, exactMatches));
    }
    if (candidates.length === 1) {
      return candidates[0];
    }

    throw new BadRequestException(this.buildTaskTypeAmbiguityMessage(normalized, candidates));
  }

  async resolveProjectPhase(
    context: AiExecutionContextWithManager,
    projectId: string,
    projectLabel: string,
    phase: string,
  ): Promise<AiTaskPhaseReference | null> {
    const normalized = String(phase || '').trim();
    if (!normalized) {
      throw new BadRequestException('Project phase is required.');
    }

    if (['project level', 'project-level', 'none', 'no phase'].includes(normalized.toLowerCase())) {
      return null;
    }

    let rows: Array<Record<string, unknown>> = [];
    if (isUuid(normalized)) {
      rows = await context.manager.query(
        `
        SELECT id, name
        FROM portfolio_project_phases
        WHERE tenant_id = $1
          AND project_id = $2
          AND id = $3
        LIMIT 1
        `,
        [context.tenantId, projectId, normalized],
      );
    } else {
      const like = `%${normalized}%`;
      const prefix = `${normalized}%`;
      rows = await context.manager.query(
        `
        SELECT id, name
        FROM portfolio_project_phases
        WHERE tenant_id = $1
          AND project_id = $2
          AND name ILIKE $3
        ORDER BY
          CASE
            WHEN lower(name) = lower($4) THEN 0
            WHEN name ILIKE $5 THEN 1
            WHEN name ILIKE $3 THEN 2
            ELSE 3
          END ASC,
          sequence ASC,
          created_at ASC
        LIMIT 5
        `,
        [context.tenantId, projectId, like, normalized, prefix],
      );
    }

    if (rows.length === 0) {
      throw new NotFoundException(`No project phase found matching "${normalized}" for ${projectLabel}.`);
    }

    const candidates = rows.map((row) => ({
      id: String(row.id),
      label: String(row.name || row.id),
    }));
    const exactMatches = candidates.filter((candidate) =>
      candidate.label.trim().toLowerCase() === normalized.toLowerCase(),
    );
    if (exactMatches.length === 1) {
      return exactMatches[0];
    }
    if (exactMatches.length > 1) {
      throw new BadRequestException(this.buildPhaseAmbiguityMessage(normalized, projectLabel, exactMatches));
    }
    if (candidates.length === 1) {
      return candidates[0];
    }

    throw new BadRequestException(this.buildPhaseAmbiguityMessage(normalized, projectLabel, candidates));
  }
}

import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertLinesEditable } from '../../data-access/line-write-checks';
import { validate as isUuid } from 'uuid';
import { RelatedType } from '../../tasks/tasks-unified.service';
import { AiExecutionContextWithManager } from '../ai.types';
import {
  participantConditionForAiEntity,
  ParticipationScopedAiEntityType,
  resolveAiIncidentViewer,
  resolveAiParticipationAccessScope,
} from '../query/ai-query-scope.util';
import {
  INCIDENT_LOCKED_MESSAGE,
  incidentVisibilitySql,
  isFrozenIncidentStatus,
  taskIncidentVisibilitySql,
} from '../../incidents/incident-visibility';
import { parseItemNumber } from '../../common/parse-item-number';
import { budgetLineReferenceNumbers } from '../../common/resolve-item-id';
import { BUDGET_LINE_PREFIX } from '../../spend/budget-nature';

const TASK_REF_RE = /^T-(\d+)$/i;
const PROJECT_REF_RE = /^(?:PRJ-|project\s+#?|prj\s+#?|#)?(\d+)$/i;

type AiTaskUserCandidate = {
  id: string;
  email: string | null;
  label: string;
};

type AiTaskCreateTargetMode = 'standalone' | 'project' | 'budget_line' | 'incident';

type AiTaskCreateTargetCandidate = {
  id: string;
  ref: string | null;
  label: string;
  name: string | null;
  /** The line's nature for a `budget_line` target, the stored type it becomes. */
  nature: 'opex' | 'capex' | null;
  updated_at: string | null;
};

type AiTaskTargetQueryConfig = {
  mode: Exclude<AiTaskCreateTargetMode, 'standalone'>;
  /** The stored task object type; null for `budget_line`, whose nature gives `spend_item` or `capex_item`. */
  type: Exclude<RelatedType, null> | null;
  table: string;
  nameColumn: string;
  subject: string;
  displayPrefix: string;
  itemPrefix?: string;
  /** A predicate on the target row: a `budget_line` names both natures (`spend/budget-nature.ts`). */
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
  budget_line: {
    mode: 'budget_line',
    type: null,
    table: 'spend_items',
    nameColumn: 'product_name',
    subject: 'budget line',
    displayPrefix: 'BL',
    itemPrefix: 'BL',
    // Both natures in one family (`spend/budget-nature.ts`); the line's nature gives the stored type.
    where: `target.nature IN ('opex', 'capex')`,
  },
  incident: {
    mode: 'incident',
    type: 'incident',
    table: 'incidents',
    nameColumn: 'title',
    subject: 'incident',
    displayPrefix: 'Incident',
    itemPrefix: 'INC',
  },
};

export type AiTaskSnapshot = {
  task_id: string;
  target_ref: string | null;
  target_title: string | null;
  status: string | null;
  assignee_user_id: string | null;
  assignee_label: string | null;
  /** The task's object, for the delete refusal of a scoped budget line or contract (`assertTaskDeletable`). */
  related_object_type: string | null;
  related_object_id: string | null;
  /** The record's last change, for the drift check of a delete preview. */
  updated_at: string | null;
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
    if (mode === 'budget_line') {
      return `${BUDGET_LINE_PREFIX}-${numeric}`;
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
    const nature = row.nature === 'opex' || row.nature === 'capex' ? row.nature : null;
    return {
      id: String(row.id),
      ref: this.buildTargetRef(config.mode, row.item_number),
      label: this.buildTargetLabel(config, row),
      name: textOrNull(row.name),
      nature,
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
    return match ? parseItemNumber(match[1]) : null;
  }

  /**
   * The incident a follow-up task is created on or moved to, as the incident sub-route reads it:
   * an INC-n, a uuid or an exact title, with the caller's confidentiality. A hidden incident reads
   * as missing; a closed or cancelled one refuses the write (`ensureEditable` on the screen).
   */
  async resolveIncidentTarget(
    context: AiExecutionContextWithManager,
    reference: string | null | undefined,
  ): Promise<AiTaskCreateTarget> {
    const raw = textOrNull(reference);
    if (!raw) throw new BadRequestException('relation_ref is required when relation_type is incident.');
    const uuid = isUuid(raw);
    const itemNumber = parseItemNumber(raw.match(/^INC-(\d+)$/i)?.[1]);
    const viewer = await resolveAiIncidentViewer(context);
    const params: unknown[] = [context.tenantId, raw, itemNumber];
    const visibility = incidentVisibilitySql('target', viewer, params);
    const rows: Array<{
      id: string;
      item_number: number | null;
      title: string | null;
      status: string | null;
      confidential: boolean;
    }> = await context.manager.query(
      `SELECT target.id, target.item_number, target.title, target.status, target.confidential
         FROM incidents target
        WHERE target.tenant_id = $1
          AND (${uuid ? 'target.id = $2 OR ' : ''}(($3::int IS NOT NULL AND target.item_number = $3::int) OR LOWER(target.title) = LOWER($2::text)))
          ${visibility}
        ORDER BY target.item_number
        LIMIT 6`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`No incident found matching "${raw}".`);
    if (rows.length > 1) throw new BadRequestException(`Multiple incidents matched "${raw}". Use an INC reference.`);
    const row = rows[0];
    if (isFrozenIncidentStatus(row.status)) throw new ForbiddenException(INCIDENT_LOCKED_MESSAGE);
    const ref = row.item_number == null ? raw : `INC-${row.item_number}`;
    return {
      mode: 'incident',
      type: 'incident',
      id: String(row.id),
      ref,
      label: row.confidential
        ? ref
        : [ref, String(row.title ?? '').trim()].filter(Boolean).join(' - '),
    };
  }

  private toTaskSnapshot(row: any): AiTaskSnapshot {
    return {
      task_id: row.id,
      target_ref: buildTaskRef(row.item_number ?? null),
      target_title: row.title ?? null,
      status: row.status ?? null,
      assignee_user_id: row.assignee_user_id ?? null,
      assignee_label: row.assignee_label ?? null,
      related_object_type: row.related_object_type ?? null,
      related_object_id: row.related_object_id ?? null,
      updated_at: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
    };
  }

  /** The task's stored object type: a project, or the line's nature (`spend_item` / `capex_item`). */
  private storedTargetType(
    config: AiTaskTargetQueryConfig,
    candidate: AiTaskCreateTargetCandidate,
  ): Exclude<RelatedType, null> {
    return config.type ?? (candidate.nature === 'capex' ? 'capex_item' : 'spend_item');
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
                ${config.mode === 'budget_line' ? 'target.nature,' : 'NULL::text AS nature,'}
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
    } else if (mode === 'budget_line') {
      const numbers = budgetLineReferenceNumbers(normalized);
      const byNumber = numbers.itemNumber != null || numbers.legacyNumber != null;
      rows = await context.manager.query(
        `SELECT id,
                target.${config.nameColumn} AS name,
                target.nature,
                target.item_number,
                target.updated_at
         FROM ${config.table} target
         WHERE target.tenant_id = $1${config.where ? ` AND ${config.where}` : ''}
           AND (${byNumber ? 'item_number = $2 OR legacy_number = $3' : 'FALSE'})
         LIMIT 1`,
        [context.tenantId, numbers.itemNumber, numbers.legacyNumber],
      );
      if (!rows[0]) {
        // A title, as the task screen searches (the reference above names a number only).
        rows = await context.manager.query(
          `SELECT id,
                  target.${config.nameColumn} AS name,
                  target.nature,
                  target.item_number,
                  target.updated_at
           FROM ${config.table} target
           WHERE target.tenant_id = $1${config.where ? ` AND ${config.where}` : ''}
             AND LOWER(target.${config.nameColumn}) = LOWER($2::text)
           LIMIT 2`,
          [context.tenantId, normalized],
        );
        if (rows.length > 1) {
          throw new BadRequestException(`Multiple ${config.subject}s matched "${normalized}". Use its BL-n reference.`);
        }
      }
    }

    if (!rows[0]) {
      throw new NotFoundException(`No ${config.subject} found matching "${normalized}".`);
    }

    const candidate = this.toTargetCandidate(config, rows[0]);
    return {
      mode,
      type: config.type ?? (candidate.nature === 'capex' ? 'capex_item' : 'spend_item'),
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
    } else if (mode === 'budget_line') {
      const numbers = budgetLineReferenceNumbers(normalized);
      if (numbers.itemNumber != null || numbers.legacyNumber != null) {
        params.push(numbers.itemNumber, numbers.legacyNumber);
        itemNumberSql = ` OR target.item_number = $${params.length - 1} OR target.legacy_number = $${params.length}::text`;
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
              ${config.mode === 'budget_line' ? 'target.nature,' : 'NULL::text AS nature,'}
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
    const viewer = await resolveAiIncidentViewer(context);
    if (isUuid(normalized)) {
      const params: unknown[] = [context.tenantId, normalized];
      const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
      const incidentSql = taskIncidentVisibilitySql('t', viewer, params);
      rows = await context.manager.query(
        `
        SELECT t.id,
               t.item_number,
               t.title,
               t.status,
               t.assignee_user_id,
               t.related_object_type,
               t.related_object_id,
               t.updated_at,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS assignee_label
        FROM tasks t
        LEFT JOIN users u
          ON u.id = t.assignee_user_id
         AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND t.id = $2
          ${accessScopeSql}
          ${incidentSql}
        LIMIT 1
        `,
        params,
      );
    } else {
      const match = normalized.match(TASK_REF_RE);
      if (!match) {
        throw new BadRequestException('Task reference must be a task UUID or a T-123 style reference.');
      }
      const itemNumber = parseItemNumber(match[1]);
      if (itemNumber == null) throw new NotFoundException('Task not found.');
      const params: unknown[] = [context.tenantId, itemNumber];
      const accessScopeSql = appendParticipationScopeSql('tasks', 't', params, accessScope);
      const incidentSql = taskIncidentVisibilitySql('t', viewer, params);
      rows = await context.manager.query(
        `
        SELECT t.id,
               t.item_number,
               t.title,
               t.status,
               t.assignee_user_id,
               t.related_object_type,
               t.related_object_id,
               t.updated_at,
               COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS assignee_label
        FROM tasks t
        LEFT JOIN users u
          ON u.id = t.assignee_user_id
         AND u.tenant_id = t.tenant_id
        WHERE t.tenant_id = $1
          AND t.item_number = $2
          ${accessScopeSql}
          ${incidentSql}
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

  /**
   * The object a task is written on (create, GLPI import, relation change). A budget line the person
   * reads but may not modify is refused when the preview is asked, with the 403 the routes give
   * (lot 3), as the write's trigger would refuse it at the approval.
   */
  async resolveCreateTarget(
    context: AiExecutionContextWithManager,
    relationType?: AiTaskCreateTargetMode | null,
    relationRef?: string | null,
  ): Promise<AiTaskCreateTarget> {
    const target = await this.findCreateTarget(context, relationType, relationRef);
    if (target.mode === 'budget_line') await assertLinesEditable(context.manager, [target.id]);
    return target;
  }

  private async findCreateTarget(
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

    if (mode === 'incident') {
      return this.resolveIncidentTarget(context, normalizedRef);
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
        type: this.storedTargetType(config, exact),
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
        type: this.storedTargetType(config, candidate),
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

    if (relationType === 'incident') {
      return this.resolveIncidentTarget(context, relationId);
    }

    return this.getExactTarget(context, relationType, relationId);
  }

  /**
   * The type a new task gets when none is named, as the task screen preselects it: the shipped
   * `task` type, or an active type named "Task"; null when the tenant has neither.
   */
  async resolveDefaultTaskType(context: AiExecutionContextWithManager): Promise<AiTaskTypeReference | null> {
    const rows: Array<Record<string, unknown>> = await context.manager.query(
      `
      SELECT id, name
      FROM portfolio_task_types
      WHERE tenant_id = $1
        AND is_active = true
        AND (code = 'task' OR name = 'Task')
      ORDER BY (code = 'task') DESC NULLS LAST, display_order ASC
      LIMIT 1
      `,
      [context.tenantId],
    );
    const row = rows[0];
    return row ? { id: String(row.id), label: String(row.name || row.id) } : null;
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

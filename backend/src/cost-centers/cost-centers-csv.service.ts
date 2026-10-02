import { BadRequestException, Injectable } from '@nestjs/common';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { randomUUID } from 'node:crypto';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { csvDataRowLines, rowLine } from '../common/csv/csv-row-lines';
import { isActiveAt, parseCsvEndOfValidity, resolveLifecycleState, StatusState } from '../common/status';
import { csvItemLifecycle, csvLifecycleConflict } from '../spend/item-write.util';
import { CostCenterKind } from './cost-center.entity';
import { loadCostCenterTree } from './cost-center-tree.util';
import {
  CostCenterContext,
  CostCenterGraphNode,
  CostCentersService,
  CostCenterValues,
  costCenterValuesEqual,
  normalizeCostCenterCode,
  normalizeCostCenterKind,
  normalizeCostCenterName,
  StoredCostCenter,
  validateCostCenterGraph,
} from './cost-centers.service';

export const COST_CENTER_CSV_HEADERS = [
  'code', 'kind', 'name', 'parent_code', 'company_name', 'owner_email', 'description', 'status', 'disabled_at',
] as const;
/** Accepted when absent (the file then sets the lifecycle through `status` alone). */
const OPTIONAL_HEADERS = new Set<string>(['disabled_at']);
const DELIMITER = ';';

export interface CostCenterImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: Array<{ row: number; message: string }>;
}

interface ParsedRow {
  line: number;
  id: string;
  existing: StoredCostCenter | null;
  parentCode: string;
  values: CostCenterValues;
}

const cell = (row: Record<string, string>, key: string) => (row[key] ?? '').toString().trim();

@Injectable()
export class CostCentersCsvService {
  constructor(private readonly costCenters: CostCentersService) {}

  async exportCsv(scope: 'data' | 'template', ctx: CostCenterContext): Promise<{ filename: string; content: string }> {
    const rows: Array<Record<string, string>> = [];
    if (scope === 'data') {
      // Tree order: a parent is always written before its children.
      const nodes = await loadCostCenterTree(ctx.manager, ctx.tenantId);
      const extras: Array<{ id: string; description: string | null; owner_email: string | null }> = await ctx.manager.query(
        `SELECT cc.id, cc.description, u.email AS owner_email
           FROM cost_centers cc
           LEFT JOIN users u ON u.id = cc.owner_user_id AND u.tenant_id = cc.tenant_id
          WHERE cc.tenant_id = $1`,
        [ctx.tenantId],
      );
      const extraById = new Map(extras.map((row) => [row.id, row]));
      const byId = new Map(nodes.map((node) => [node.id, node]));
      for (const node of nodes) {
        const extra = extraById.get(node.id);
        rows.push({
          code: node.code,
          kind: node.kind,
          name: node.name,
          parent_code: node.parent_id ? byId.get(node.parent_id)?.code ?? '' : '',
          company_name: node.company_name ?? '',
          owner_email: extra?.owner_email ?? '',
          description: extra?.description ?? '',
          // The tree reads it from the end of validity, so it never contradicts its own row.
          status: node.status,
          disabled_at: node.disabled_at ?? '',
        });
      }
    }
    const headers = [...COST_CENTER_CSV_HEADERS];
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter: DELIMITER, alwaysWriteHeaders: true, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      for (const row of rows) stream.write(row);
      stream.end();
    });
    return {
      filename: scope === 'template' ? 'cost_centers_template.csv' : 'cost_centers.csv',
      content: '\ufeff' + chunks.join(''),
    };
  }

  /**
   * Upsert by code (case-insensitive). Every row is parsed, parents are then
   * resolved against the file and the stored tree (any row order imports),
   * and the whole resulting tree is checked with the same rules as a single
   * write. Nothing is written unless the file is clean; a row identical to
   * the stored node is counted unchanged and writes nothing.
   */
  async importCsv(
    { file, dryRun }: { file: Express.Multer.File; dryRun: boolean },
    ctx: CostCenterContext,
  ): Promise<CostCenterImportResult> {
    const result = (errors: CostCenterImportResult['errors'], total = 0): CostCenterImportResult => ({
      ok: false, dryRun, total, inserted: 0, updated: 0, unchanged: 0, errors,
    });
    const parsed = await this.parseFile(file);
    if ('headerError' in parsed) return result([{ row: 0, message: parsed.headerError }]);
    const { rows, hasDisabledAt, lines } = parsed;

    await this.costCenters.lockTree(ctx);
    const stored = await this.costCenters.loadStored(ctx);
    const storedByCode = new Map(stored.map((row) => [row.code.toLowerCase(), row]));
    const companies: Array<{ id: string; name: string; disabled_at: Date | null }> = await ctx.manager.query(
      `SELECT id, name, disabled_at FROM companies WHERE tenant_id = $1`,
      [ctx.tenantId],
    );
    const companiesByName = new Map<string, typeof companies>();
    for (const company of companies) {
      const key = company.name.trim().toLowerCase();
      companiesByName.set(key, [...(companiesByName.get(key) ?? []), company]);
    }
    const emails = Array.from(new Set(rows.map((row) => cell(row, 'owner_email').toLowerCase()).filter(Boolean)));
    const users: Array<{ id: string; email: string; status: string }> = emails.length
      ? await ctx.manager.query(
        `SELECT id, email, status FROM users WHERE tenant_id = $1 AND lower(email) = ANY($2::text[])`,
        [ctx.tenantId, emails],
      )
      : [];
    const usersByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));

    // Pass 1: every row on its own.
    const errors: CostCenterImportResult['errors'] = [];
    const parsedRows: ParsedRow[] = [];
    const lineByCode = new Map<string, number>();
    const parentCodes: Array<{ line: number; parentCode: string }> = [];
    rows.forEach((raw, index) => {
      const line = rowLine(lines, index);
      const rowErrors: string[] = [];
      parentCodes.push({ line, parentCode: cell(raw, 'parent_code') });
      const attempt = <T>(fn: () => T): T | undefined => {
        try {
          return fn();
        } catch (err) {
          rowErrors.push((err as Error).message);
          return undefined;
        }
      };
      const code = attempt(() => normalizeCostCenterCode(cell(raw, 'code')));
      const kind = attempt(() => normalizeCostCenterKind(cell(raw, 'kind')));
      const name = attempt(() => normalizeCostCenterName(cell(raw, 'name')));
      const existing = code ? storedByCode.get(code.toLowerCase()) ?? null : null;
      if (code) {
        const firstLine = lineByCode.get(code.toLowerCase());
        if (firstLine) rowErrors.push(`Code ${code} is already used on row ${firstLine}.`);
        else lineByCode.set(code.toLowerCase(), line);
      }

      let companyId: string | null = null;
      const companyName = cell(raw, 'company_name');
      if (companyName) {
        const matches = companiesByName.get(companyName.toLowerCase()) ?? [];
        const company = matches.find((entry) => entry.name.trim() === companyName) ?? (matches.length === 1 ? matches[0] : undefined);
        if (!company) {
          rowErrors.push(matches.length > 1 ? `Company name '${companyName}' matches several companies.` : `Unknown company '${companyName}'.`);
        } else if (company.id !== existing?.company_id && !isActiveAt(company.disabled_at)) {
          rowErrors.push(`Company '${companyName}' is disabled.`);
        } else {
          companyId = company.id;
        }
      }

      let ownerId: string | null = null;
      const ownerEmail = cell(raw, 'owner_email');
      if (ownerEmail) {
        const user = usersByEmail.get(ownerEmail.toLowerCase());
        if (!user) rowErrors.push(`Unknown budget holder email '${ownerEmail}'.`);
        else if (user.id !== existing?.owner_user_id && user.status !== 'enabled') {
          rowErrors.push(`Budget holder '${ownerEmail}' is not an active user.`);
        } else ownerId = user.id;
      }

      const statusRaw = cell(raw, 'status').toLowerCase();
      if (statusRaw && statusRaw !== StatusState.ENABLED && statusRaw !== StatusState.DISABLED) {
        rowErrors.push(`Invalid status '${cell(raw, 'status')}'. Use 'enabled' or 'disabled'.`);
      }
      const status = statusRaw === StatusState.ENABLED || statusRaw === StatusState.DISABLED ? statusRaw : null;
      const disabledAtRaw = hasDisabledAt ? cell(raw, 'disabled_at') : '';
      let disabledAt: Date | null = null;
      if (disabledAtRaw) {
        disabledAt = attempt(() => parseCsvEndOfValidity(disabledAtRaw)) ?? null;
      }
      const lifecycleConflict = csvLifecycleConflict(status, disabledAt);
      if (lifecycleConflict) rowErrors.push(lifecycleConflict);

      if (rowErrors.length > 0 || !code || !kind || !name) {
        for (const message of rowErrors) errors.push({ row: line, message });
        return;
      }
      // Blank status or date: enabled for a new node, the stored value on an update (`csvItemLifecycle`).
      const next = csvItemLifecycle(status, disabledAt, !!existing);
      const lifecycle = resolveLifecycleState({
        currentDisabledAt: existing?.disabled_at ?? null,
        nextStatus: next.status,
        nextDisabledAt: next.disabled_at,
      });
      parsedRows.push({
        line,
        id: existing?.id ?? randomUUID(),
        existing,
        parentCode: cell(raw, 'parent_code'),
        values: {
          code,
          kind: kind as CostCenterKind,
          name,
          description: cell(raw, 'description') || null,
          parent_id: null,
          company_id: companyId,
          owner_user_id: ownerId,
          status: lifecycle.status,
          disabled_at: lifecycle.disabled_at,
          sort_order: existing ? Number(existing.sort_order) : 0,
        },
      });
    });

    // Pass 2: parents, against every code of the file first and then the stored tree.
    for (const { line, parentCode } of parentCodes) {
      const key = parentCode.toLowerCase();
      if (parentCode && !lineByCode.has(key) && !storedByCode.has(key)) {
        errors.push({ row: line, message: `Unknown parent code '${parentCode}'.` });
      }
    }
    if (errors.length > 0) return result(sortErrors(errors), rows.length);
    const fileIdByCode = new Map(parsedRows.map((row) => [row.values.code.toLowerCase(), row.id]));
    for (const row of parsedRows) {
      const key = row.parentCode.toLowerCase();
      row.values.parent_id = row.parentCode ? fileIdByCode.get(key) ?? storedByCode.get(key)?.id ?? null : null;
    }

    // The whole resulting tree, with the same rules as a single write.
    const before = new Map<string, CostCenterGraphNode>(stored.map((row) => [row.id, graphNode(row.id, row)]));
    const after = new Map(before);
    for (const row of parsedRows) after.set(row.id, graphNode(row.id, row.values));
    const turningIntoGroups = parsedRows
      .filter((row) => row.existing?.kind === 'cost_center' && row.values.kind === 'group')
      .map((row) => row.id);
    await this.costCenters.lockNodes(ctx, turningIntoGroups);
    const usage = await this.costCenters.countUsage(ctx, turningIntoGroups);
    const lineById = new Map(parsedRows.map((row) => [row.id, row.line]));
    for (const issue of validateCostCenterGraph({ before, after, usage })) {
      errors.push({ row: lineById.get(issue.id) ?? 0, message: issue.message });
    }
    if (errors.length > 0) return result(sortErrors(errors), rows.length);

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toWrite: ParsedRow[] = [];
    for (const row of parsedRows) {
      if (!row.existing) inserted += 1;
      else if (costCenterValuesEqual(row.existing, row.values)) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push(row);
    }
    if (!dryRun) {
      // Parents first: the (tenant_id, parent_id) key must find its parent when each row is written.
      const depth = depthIn(after);
      toWrite.sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.line - b.line);
      for (const row of toWrite) {
        await this.costCenters.persist(ctx, row.existing, row.values, row.id);
      }
    }
    return { ok: true, dryRun, total: rows.length, inserted, updated, unchanged, errors: [] };
  }

  private async parseFile(file: Express.Multer.File): Promise<{ rows: Array<Record<string, string>>; hasDisabledAt: boolean; lines: number[] } | { headerError: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    let content: string;
    try {
      content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
    } catch {
      throw new BadRequestException('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.');
    }
    const rows: Array<Record<string, string>> = [];
    let headers: string[] = [];
    await new Promise<void>((resolve, reject) => {
      parseString(content, { headers: true, delimiter: DELIMITER, ignoreEmpty: true, trim: true })
        .on('headers', (found: string[]) => { headers = found; })
        .on('error', (err) => reject(new BadRequestException(`The file could not be read: ${err.message}`)))
        .on('data', (row: Record<string, string>) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    const expected: readonly string[] = COST_CENTER_CSV_HEADERS;
    const missing = expected.filter((header) => !headers.includes(header) && !OPTIONAL_HEADERS.has(header));
    const extras = headers.filter((header) => !expected.includes(header));
    if (missing.length > 0 || extras.length > 0) {
      return { headerError: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` };
    }
    // Errors name the file's own line, blank lines included.
    return { rows, hasDisabledAt: headers.includes('disabled_at'), lines: await csvDataRowLines(content, DELIMITER) };
  }
}

function graphNode(id: string, values: Pick<CostCenterValues, 'code' | 'name' | 'kind' | 'parent_id' | 'company_id'>): CostCenterGraphNode {
  return { id, code: values.code, name: values.name, kind: values.kind, parent_id: values.parent_id ?? null, company_id: values.company_id ?? null };
}

/** Depth of each node in a graph already checked for loops (the walk is bounded anyway). */
function depthIn(graph: Map<string, CostCenterGraphNode>): Map<string, number> {
  const depth = new Map<string, number>();
  for (const id of graph.keys()) {
    let hops = 0;
    let current = graph.get(id)?.parent_id ?? null;
    while (current && hops <= graph.size) {
      hops += 1;
      current = graph.get(current)?.parent_id ?? null;
    }
    depth.set(id, hops);
  }
  return depth;
}

function sortErrors(errors: CostCenterImportResult['errors']) {
  return [...errors].sort((a, b) => a.row - b.row);
}

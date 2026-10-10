import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DeepPartial, EntityManager, In, Repository, Raw } from 'typeorm';
import { Contract } from './contract.entity';
import { ContractSpendItem } from './contract-spend-item.entity';
import { ContractLink } from './contract-link.entity';
import { ContractAttachment } from './contract-attachment.entity';
import { AuditService } from '../audit/audit.service';
import { parseExportPagination, parsePagination } from '../common/pagination';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import * as path from 'path';
import * as fs from 'fs';
import { deriveStatusFromDisabledAt, resolveLifecycleState } from '../common/status';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { ContractUpsertDto } from './dto/contract.dto';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { ContractCapexItem } from './contract-capex-item.entity';
import { StorageService } from '../common/storage/storage.service';
import { randomUUID } from 'crypto';
import { validate as isUuid } from 'uuid';
import { ContractContactsService } from './contract-contacts.service';
import { NotificationsService } from '../notifications/notifications.service';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import {
  buildQuickSearchConditions,
  compileAgFilterCondition,
  CompiledCondition,
  createParamNameGenerator,
  FilterTargetConfig,
} from '../common/ag-grid-filtering';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { syncSupplierContactsWithinUpdate } from '../contacts/contact-link-attach.util';

/**
 * The session tenant as a find condition: `app_current_tenant()`, the tenant RLS checks too,
 * written out on every read and write besides the policy. Once a record is resolved, its
 * own `tenant_id` is used instead.
 */
function sessionTenant() {
  return Raw((alias) => `${alias} = app_current_tenant()`);
}

// The ids a contract names, each resolved in the session tenant before a write
// (a foreign key does not check the tenant). Table names come only from here.
const CONTRACT_REFERENCES = {
  company_id: { table: 'companies', label: 'Company' },
  supplier_id: { table: 'suppliers', label: 'Supplier' },
  owner_user_id: { table: 'users', label: 'Owner' },
} as const;

// Never written from a body: the row's identity, tenant and timestamps.
const NOT_WRITABLE = ['id', 'tenant_id', 'created_at', 'updated_at'] as const;

type ListItem = Contract & {
  supplier?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
  end_date?: string;
  cancellation_deadline?: string;
  linked_opex_count?: number;
  latest_task?: { id: string; status?: string; description?: string; created_at?: Date } | null;
};

/** A contract link `l` to an OPEX line (`spend/budget-nature.ts`): the OPEX side lists, counts and replaces those only. */
const OPEX_LINK = `EXISTS (SELECT 1 FROM spend_items si WHERE si.tenant_id = l.tenant_id AND si.id = l.spend_item_id AND si.nature = 'opex')`;

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract) private readonly repo: Repository<Contract>,
    @InjectRepository(ContractSpendItem) private readonly linksRepo: Repository<ContractSpendItem>,
    @InjectRepository(ContractLink) private readonly urlsRepo: Repository<ContractLink>,
    @InjectRepository(ContractAttachment) private readonly attachRepo: Repository<ContractAttachment>,
    private readonly audit: AuditService,
    private readonly unifiedTasks: TasksUnifiedService,
    private readonly storage: StorageService,
    private readonly itemContacts: ContractContactsService,
    private readonly notifications: NotificationsService,
  ) {}

  private computeEndDate(start: string, durationMonths: number): string {
    const d = new Date(start + 'T00:00:00Z');
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + (durationMonths || 0), d.getUTCDate()));
    end.setUTCDate(end.getUTCDate() - 1); // minus 1 day
    return end.toISOString().slice(0, 10);
    }

  private addMonthsIso(dateIso: string, delta: number): string {
    const d = new Date(dateIso + 'T00:00:00Z');
    const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, d.getUTCDate()));
    return out.toISOString().slice(0, 10);
  }

  private computeCancellationDeadline(endDateIso: string, noticeMonths: number): string {
    const raw = this.addMonthsIso(endDateIso, -noticeMonths);
    return raw;
  }

  private contractFilterTargets(): Record<string, FilterTargetConfig> {
    return {
      id: { expression: 'c.id', dataType: 'string' },
      name: { expression: 'c.name', dataType: 'string' },
      status: { expression: 'c.status', textExpression: 'CAST(c.status AS TEXT)', dataType: 'string' },
      company_id: { expression: 'c.company_id', dataType: 'string' },
      supplier_id: { expression: 'c.supplier_id', dataType: 'string' },
      owner_user_id: { expression: 'c.owner_user_id', dataType: 'string' },
      start_date: { expression: 'c.start_date', dataType: 'string' },
      end_date: {
        expression: `(c.start_date + COALESCE(c.duration_months, 0) * INTERVAL '1 month' - INTERVAL '1 day')::date`,
        dataType: 'string',
      },
      cancellation_deadline: {
        expression: `(c.start_date + (COALESCE(c.duration_months, 0) - COALESCE(c.notice_period_months, 0)) * INTERVAL '1 month')::date`,
        dataType: 'string',
      },
      duration_months: {
        expression: 'c.duration_months',
        numericExpression: 'c.duration_months',
        textExpression: 'CAST(c.duration_months AS TEXT)',
        dataType: 'number',
      },
      auto_renewal: { expression: 'c.auto_renewal', dataType: 'boolean' },
      notice_period_months: {
        expression: 'c.notice_period_months',
        numericExpression: 'c.notice_period_months',
        textExpression: 'CAST(c.notice_period_months AS TEXT)',
        dataType: 'number',
      },
      yearly_amount_at_signature: {
        expression: 'c.yearly_amount_at_signature',
        numericExpression: 'c.yearly_amount_at_signature',
        textExpression: 'CAST(c.yearly_amount_at_signature AS TEXT)',
        dataType: 'number',
      },
      currency: { expression: 'c.currency', dataType: 'string' },
      billing_frequency: { expression: 'c.billing_frequency', dataType: 'string' },
      notes: { expression: 'c.notes', dataType: 'string' },
      created_at: { expression: 'c.created_at', textExpression: 'CAST(c.created_at AS TEXT)', dataType: 'string' },
      updated_at: { expression: 'c.updated_at', textExpression: 'CAST(c.updated_at AS TEXT)', dataType: 'string' },
      company_name: { expression: 'comp.name', dataType: 'string' },
      supplier_name: { expression: 'sup.name', dataType: 'string' },
    };
  }

  async list(query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll
      ? parseExportPagination(query, { field: 'created_at', direction: 'DESC' })
      : parsePagination(query, { field: 'created_at', direction: 'DESC' });
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const filterTargets = this.contractFilterTargets();
    const nextParam = createParamNameGenerator('c');
    const compiledFilters: CompiledCondition[] = [];
    if (filtersToApply && typeof filtersToApply === 'object') {
      for (const [field, model] of Object.entries(filtersToApply)) {
        const target = filterTargets[field];
        if (!target) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (condition) compiledFilters.push(condition);
      }
    }

    const quickSearchConditions = q
      ? buildQuickSearchConditions(q, ['c.name', 'comp.name', 'sup.name', 'c.notes'], nextParam)
      : [];
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';

    const applyCompiledFilters = (builder: ReturnType<typeof repo.createQueryBuilder>) => {
      // Parenthesized, so no condition can widen the tenant predicate above.
      compiledFilters.forEach((cond) => builder.andWhere(`(${cond.sql})`, cond.params));
    };
    const applyQuickSearch = (builder: ReturnType<typeof repo.createQueryBuilder>) => {
      if (quickSearchConditions.length === 0) return;
      builder.andWhere(
        new Brackets((sub) => {
          quickSearchConditions.forEach((cond, idx) => {
            if (idx === 0) sub.where(cond.sql, cond.params);
            else sub.orWhere(cond.sql, cond.params);
          });
        }),
      );
    };

    const qbBase = repo
      .createQueryBuilder('c')
      .leftJoin('companies', 'comp', 'comp.id = c.company_id AND comp.tenant_id = c.tenant_id')
      .leftJoin('suppliers', 'sup', 'sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id')
      .where('c.tenant_id = app_current_tenant()');
    // The status is read from the end of validity (the stored one is not updated when the date passes).
    applyStatusFilter(qbBase, { alias: 'c', explicitStatus: status ?? statusFromAg ?? null, includeDisabled, matchNone });
    applyCompiledFilters(qbBase);
    applyQuickSearch(qbBase);

    const total = await qbBase.clone().getCount();
    const sortExpressions: Record<string, string> = {
      name: 'c.name',
      status: 'c.status',
      company_name: 'comp.name',
      supplier_name: 'sup.name',
      start_date: 'c.start_date',
      end_date: `(c.start_date + COALESCE(c.duration_months, 0) * INTERVAL '1 month' - INTERVAL '1 day')::date`,
      cancellation_deadline: `(c.start_date + (COALESCE(c.duration_months, 0) - COALESCE(c.notice_period_months, 0)) * INTERVAL '1 month')::date`,
      duration_months: 'c.duration_months',
      auto_renewal: 'c.auto_renewal',
      notice_period_months: 'c.notice_period_months',
      yearly_amount_at_signature: 'c.yearly_amount_at_signature',
      currency: 'c.currency',
      billing_frequency: 'c.billing_frequency',
      created_at: 'c.created_at',
      updated_at: 'c.updated_at',
    };
    const sortField = sortExpressions[sort.field] ? sort.field : 'created_at';
    const sortExpr = sortExpressions[sortField];
    const qb = qbBase.clone();
    if (sortField === 'end_date') {
      qb.addSelect(sortExpr, 'sort_end_date');
      qb.orderBy('sort_end_date', sort.direction as any);
    } else if (sortField === 'cancellation_deadline') {
      qb.addSelect(sortExpr, 'sort_cancellation_deadline');
      qb.orderBy('sort_cancellation_deadline', sort.direction as any);
    } else {
      qb.orderBy(sortExpr, sort.direction as any);
    }
    if (sortExpr !== 'c.created_at') qb.addOrderBy('c.created_at', 'DESC');
    qb.skip(skip).take(limit);
    const items = await qb.getMany();

    // augment supplier/company names, linked count, and derived dates
    const supplierIds = Array.from(new Set(items.map(i => i.supplier_id).filter(Boolean))) as string[];
    const companyIds = Array.from(new Set(items.map(i => i.company_id).filter(Boolean))) as string[];
    const [suppliers, companies] = await Promise.all([
      supplierIds.length ? mg.query(`SELECT id, name FROM suppliers WHERE tenant_id = app_current_tenant() AND id = ANY($1)`, [supplierIds]) : [],
      companyIds.length ? mg.query(`SELECT id, name FROM companies WHERE tenant_id = app_current_tenant() AND id = ANY($1)`, [companyIds]) : [],
    ]);
    const sById = new Map<string, any>(suppliers.map((r: any) => [r.id, r]));
    const cById = new Map<string, any>(companies.map((r: any) => [r.id, r]));

    const contractIds = items.map(i => i.id);
    const counts: Array<{ contract_id: string; c: string }> = contractIds.length
      ? await mg.query(
          `SELECT l.contract_id, COUNT(*)::text as c FROM contract_spend_items l
            WHERE l.tenant_id = app_current_tenant() AND l.contract_id = ANY($1) AND ${OPEX_LINK}
            GROUP BY l.contract_id`,
          [contractIds],
        )
      : [];
    const countById = new Map<string, number>(counts.map((r) => [r.contract_id, Number(r.c)]));

    const latestTasks: Array<{ id: string; related_object_id: string; title: string | null; description: string | null; status: string; created_at: Date }> = contractIds.length
      ? await mg.query(
          `SELECT DISTINCT ON (related_object_id) id, related_object_id, title, description, status, created_at
           FROM tasks WHERE tenant_id = app_current_tenant() AND related_object_type = 'contract' AND related_object_id = ANY($1)
           ORDER BY related_object_id, created_at DESC`, [contractIds])
      : [];
    const latestById = new Map(latestTasks.map(t => [t.related_object_id, t]));

    const enriched: ListItem[] = items.map((i) => {
      const end = this.computeEndDate(i.start_date, i.duration_months || 0);
      const cancel = this.computeCancellationDeadline(end, i.notice_period_months || 0);
      return {
        ...i,
        // From the end of validity, like the filter: the stored status stays enabled once the date passes.
        status: deriveStatusFromDisabledAt(i.disabled_at),
        supplier: i.supplier_id ? { id: i.supplier_id, name: sById.get(i.supplier_id)?.name ?? '' } : null,
        company: i.company_id ? { id: i.company_id, name: cById.get(i.company_id)?.name ?? '' } : null,
        end_date: end,
        cancellation_deadline: cancel,
        linked_opex_count: countById.get(i.id) ?? 0,
        latest_task: latestById.get(i.id) ? {
          id: latestById.get(i.id)!.id,
          status: latestById.get(i.id)!.status,
          description: latestById.get(i.id)!.description || undefined,
          created_at: latestById.get(i.id)!.created_at,
        } : null,
      };
    });

    return { items: enriched, total, page, limit };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    const linksRepo = mg.getRepository(ContractSpendItem);
    const urlsRepo = mg.getRepository(ContractLink);
    const attachRepo = mg.getRepository(ContractAttachment);
    const found = await repo.findOne({ where: { id, tenant_id: sessionTenant() } });
    if (!found) throw new NotFoundException('Contract not found');
    const tenantId = found.tenant_id;
    const end = this.computeEndDate(found.start_date, found.duration_months || 0);
    const cancel = this.computeCancellationDeadline(end, found.notice_period_months || 0);
    const linked = await linksRepo.find({ where: { tenant_id: tenantId, contract_id: id } });
    const spendIds = linked.map(l => l.spend_item_id);
    const spendItems = spendIds.length
      ? await mg.query(`SELECT id, product_name FROM spend_items WHERE tenant_id = $1 AND id = ANY($2) AND nature = 'opex'`, [tenantId, spendIds])
      : [];
    const links = await urlsRepo.find({ where: { tenant_id: tenantId, contract_id: id } });
    const attachments = await attachRepo.find({ where: { tenant_id: tenantId, contract_id: id } });
    const latestTaskRows: Array<{ id: string; title: string | null; description: string | null; status: string; created_at: Date; due_date?: string | null; assignee_user_id?: string | null }>
      = await mg.query(
        `SELECT id, title, description, status, created_at, due_date, assignee_user_id FROM tasks
         WHERE tenant_id = $1 AND related_object_type = 'contract' AND related_object_id = $2
         ORDER BY created_at DESC LIMIT 1`, [tenantId, id]);
    const latest_task = latestTaskRows?.[0] ?? null;
    return { ...found, end_date: end, cancellation_deadline: cancel, linked_spend_items: spendItems, links, attachments, latest_task };
  }

  private validateInput(body: {
    start_date?: string | null;
    billing_frequency?: string | null;
    currency?: string | null;
    company_id?: string | null;
    supplier_id?: string | null;
  }) {
    const freq = (body.billing_frequency || 'annual').toString();
    const allowed = ['monthly','quarterly','annual','other'];
    if (!allowed.includes(freq)) throw new BadRequestException('billing_frequency must be monthly|quarterly|annual|other');
    if (!body.start_date) throw new BadRequestException('start_date is required');
    if (body.currency && body.currency.length !== 3) throw new BadRequestException('currency must be 3 letters');
    if (!body.company_id) throw new BadRequestException('company_id is required');
    if (!body.supplier_id) throw new BadRequestException('supplier_id is required');
  }

  /**
   * The body without the columns a write never takes, its referenced ids
   * checked in the session tenant (one query): an id of another tenant, or no
   * id at all, is refused as "<Field> not found.".
   */
  private async writableBody(mg: EntityManager, body: ContractUpsertDto): Promise<ContractUpsertDto> {
    const input = { ...(body ?? {}) } as Record<string, unknown>;
    for (const column of NOT_WRITABLE) delete input[column];
    const wanted: Array<{ table: string; label: string; id: string }> = [];
    for (const [column, ref] of Object.entries(CONTRACT_REFERENCES)) {
      const value = input[column];
      if (value == null || value === '') continue;
      if (typeof value !== 'string' || !isUuid(value)) throw new BadRequestException(`${ref.label} not found.`);
      wanted.push({ ...ref, id: value.toLowerCase() });
    }
    if (wanted.length > 0) {
      const params: unknown[] = [];
      const selects = wanted.map((w) => {
        params.push(w.id);
        return `SELECT '${w.table}' AS tbl, id::text AS id FROM ${w.table} WHERE tenant_id = app_current_tenant() AND id = $${params.length}::uuid`;
      });
      const rows: Array<{ tbl: string; id: string }> = await mg.query(selects.join(' UNION ALL '), params);
      const found = new Set(rows.map((row) => `${row.tbl}:${row.id}`));
      for (const w of wanted) {
        if (!found.has(`${w.table}:${w.id}`)) throw new BadRequestException(`${w.label} not found.`);
      }
    }
    return input as ContractUpsertDto;
  }

  async create(rawBody: ContractUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    if (!rawBody?.name) throw new BadRequestException('name is required');
    this.validateInput(rawBody);
    const body = await this.writableBody(mg, rawBody);
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    const toCreate: DeepPartial<Contract> = {
      ...rest,
      // These columns are NOT NULL on the entity while the DTO allows null
      name: rest.name ?? undefined,
      company_id: rest.company_id ?? undefined,
      supplier_id: rest.supplier_id ?? undefined,
      start_date: rest.start_date ?? undefined,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
      duration_months: body.duration_months ?? 12,
      auto_renewal: body.auto_renewal ?? true,
      notice_period_months: body.notice_period_months ?? 1,
      yearly_amount_at_signature: body.yearly_amount_at_signature ?? 0,
      currency: (body.currency || 'EUR').toUpperCase(),
      billing_frequency: body.billing_frequency || 'annual',
    };
    const entity = repo.create(toCreate);
    const saved = await repo.save(entity);
    await this.audit.log({ table: 'contracts', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }

  async update(id: string, rawBody: ContractUpsertDto, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    const existing = await repo.findOne({ where: { id, tenant_id: sessionTenant() } });
    if (!existing) throw new NotFoundException('Contract not found');
    this.validateInput({ ...existing, ...rawBody });
    const body = await this.writableBody(mg, rawBody);
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    Object.assign(existing, rest);
    const now = new Date();
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
      nowFactory: () => now,
    });
    // The status before this edit, from the stored end of validity: the stored
    // status lags until the hourly sync once that date passes.
    const statusBefore = deriveStatusFromDisabledAt(before.disabled_at, now);
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;

    // Detect supplier change for contact sync
    const oldSupplierId = before.supplier_id;
    const newSupplierId = existing.supplier_id;

    const saved = await repo.save(existing);
    await this.audit.log({ table: 'contracts', recordId: saved.id, action: 'update', before, after: saved, userId }, { manager: mg });

    // Sync contacts from supplier if supplier changed
    if (oldSupplierId !== newSupplierId) {
      await syncSupplierContactsWithinUpdate(mg, `contract ${saved.id}`, () =>
        this.itemContacts.syncFromSupplier(saved.id, newSupplierId, userId ?? null, { manager: mg, tenantId: saved.tenant_id }));
    }

    // Notify owner on status change
    if (statusBefore !== saved.status && saved.owner_user_id) {
      const tenantId = saved.tenant_id;
      const user = await mg.query('SELECT id, email, locale FROM users WHERE tenant_id = $1 AND id = $2 AND status = \'enabled\'', [tenantId, saved.owner_user_id]);
      if (user.length > 0) {
        this.notifications.notifyStatusChange({
          itemType: 'contract',
          itemId: saved.id,
          itemName: saved.name,
          oldStatus: statusBefore,
          newStatus: saved.status,
          recipients: [{ userId: user[0].id, email: user[0].email, locale: user[0].locale }],
          tenantId,
          excludeUserId: userId,
          manager: mg,
        });
      }
    }

    return saved;
  }

  /** The contract of the session tenant, or a 404. */
  private async findContract(id: string, mg: EntityManager): Promise<Contract> {
    const found = await mg.getRepository(Contract).findOne({ where: { id, tenant_id: sessionTenant() } });
    if (!found) throw new NotFoundException('Contract not found.');
    return found;
  }

  /** Refuses any id that is not a row of `table` in the tenant. */
  private async assertIdsInTenant(
    mg: EntityManager,
    table: 'spend_items' | 'capex_items' | 'contracts',
    tenantId: string,
    ids: string[],
    message: string,
  ) {
    if (ids.length === 0) return;
    // `spend_items`: its OPEX lines only (`spend/budget-nature.ts`).
    const rows: Array<{ id: string }> = await mg.query(
      `SELECT id FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])${table === 'spend_items' ? ` AND nature = 'opex'` : ''}`,
      [tenantId, ids],
    );
    if (rows.length !== ids.length) throw new BadRequestException(message);
  }

  // Links
  async listLinkedSpendItems(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const linksRepo = mg.getRepository(ContractSpendItem);
    const rows = await linksRepo.find({ where: { tenant_id: sessionTenant(), contract_id: contractId } });
    const ids = rows.map(r => r.spend_item_id);
    const items = ids.length
      ? await mg.query(`SELECT id, product_name FROM spend_items WHERE tenant_id = app_current_tenant() AND id = ANY($1) AND nature = 'opex'`, [ids])
      : [];
    return { items };
  }

  async bulkReplaceLinkedSpendItems(contractId: string, spendItemIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(ContractSpendItem);
    const contract = await this.findContract(contractId, mg);
    const tenantId = contract.tenant_id;
    const uniqueIds = Array.from(new Set((spendItemIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'spend_items', tenantId, uniqueIds, 'One or more spend items not found.');
    // The contract's links to OPEX lines only: a link to a line of another nature is kept as it is.
    const existing: Array<{ id: string; spend_item_id: string }> = await mg.query(
      `SELECT l.id, l.spend_item_id FROM contract_spend_items l WHERE l.tenant_id = $1 AND l.contract_id = $2 AND ${OPEX_LINK}`,
      [tenantId, contract.id],
    );
    const toDelete = existing.filter(e => !uniqueIds.includes(e.spend_item_id));
    const existingSet = new Set(existing.map(e => e.spend_item_id));
    const toInsert = uniqueIds.filter(id => !existingSet.has(id)).map(id => repo.create({ tenant_id: tenantId, contract_id: contract.id, spend_item_id: id }));
    if (toDelete.length > 0) await repo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await repo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Tasks (latest update pattern)
  async listTasks(contractId: string, opts?: { manager?: EntityManager }) {
    return this.unifiedTasks.listForTarget({ type: 'contract', id: contractId }, opts);
  }
  async createTask(contractId: string, body: any, userId?: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const saved = await this.unifiedTasks.createForTarget({ type: 'contract', id: contractId, payload: body as any }, userId, opts);
    await this.audit.log({ table: 'contract_tasks', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: opts?.manager ?? this.repo.manager });
    return saved;
  }
  async updateTask(contractId: string, body: any & { id: string }, userId?: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const saved = await this.unifiedTasks.updateForTarget({ type: 'contract', id: contractId, payload: body as any }, userId, opts);
    await this.audit.log({ table: 'contract_tasks', recordId: saved.id, action: 'update', before: null, after: saved, userId }, { manager: opts?.manager ?? this.repo.manager });
    return saved;
  }

  // URLs
  listUrls(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(ContractLink).find({ where: { tenant_id: sessionTenant(), contract_id: contractId }, order: { created_at: 'DESC' as any } });
  }
  async createUrl(contractId: string, body: Partial<ContractLink>, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const urlsRepo = mg.getRepository(ContractLink);
    if (!body.url) throw new BadRequestException('url is required');
    const contract = await this.findContract(contractId, mg);
    const entity = urlsRepo.create({ tenant_id: contract.tenant_id, contract_id: contract.id, url: body.url, description: body.description ?? null });
    const saved = await urlsRepo.save(entity);
    await this.audit.log({ table: 'contract_links', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }
  async updateUrl(contractId: string, linkId: string, body: Partial<ContractLink>, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const urlsRepo = mg.getRepository(ContractLink);
    const existing = await urlsRepo.findOne({ where: { id: linkId, contract_id: contractId, tenant_id: sessionTenant() } });
    if (!existing) throw new NotFoundException('Link not found');
    // Only the link's own fields: the contract and the tenant it belongs to stay as resolved above.
    const next = { ...existing } as ContractLink;
    if (body?.url !== undefined) next.url = body.url;
    if (body?.description !== undefined) next.description = body.description;
    const saved = await urlsRepo.save(next);
    await this.audit.log({ table: 'contract_links', recordId: saved.id, action: 'update', before: existing, after: saved, userId }, { manager: mg });
    return saved;
  }
  async deleteUrl(contractId: string, linkId: string, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const urlsRepo = mg.getRepository(ContractLink);
    const existing = await urlsRepo.findOne({ where: { id: linkId, contract_id: contractId, tenant_id: sessionTenant() } });
    if (!existing) throw new NotFoundException('Link not found');
    await urlsRepo.delete({ id: existing.id, contract_id: existing.contract_id, tenant_id: existing.tenant_id });
    await this.audit.log({ table: 'contract_links', recordId: existing.id, action: 'update', before: existing, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  async listIds(query: any, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    const { skip, sort, status, q, filters } = parsePagination(query, { field: 'created_at', direction: 'DESC' });
    // Not the parsed limit: parsePagination defaults to a page of 20, and the prev/next
    // navigation that calls this sends no limit, so it only ever knew 20 contracts.
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const filterTargets = this.contractFilterTargets();
    const nextParam = createParamNameGenerator('c');
    const compiledFilters: CompiledCondition[] = [];
    if (filtersToApply && typeof filtersToApply === 'object') {
      for (const [field, model] of Object.entries(filtersToApply)) {
        const target = filterTargets[field];
        if (!target) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (condition) compiledFilters.push(condition);
      }
    }

    const quickSearchConditions = q
      ? buildQuickSearchConditions(q, ['c.name', 'comp.name', 'sup.name', 'c.notes'], nextParam)
      : [];
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';

    const qb = repo
      .createQueryBuilder('c')
      .select(['c.id'])
      .leftJoin('companies', 'comp', 'comp.id = c.company_id AND comp.tenant_id = c.tenant_id')
      .leftJoin('suppliers', 'sup', 'sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id')
      .where('c.tenant_id = app_current_tenant()');
    // The status is read from the end of validity (the stored one is not updated when the date passes).
    applyStatusFilter(qb, { alias: 'c', explicitStatus: status ?? statusFromAg ?? null, includeDisabled, matchNone });
    // Parenthesized, so no condition can widen the tenant predicate above.
    compiledFilters.forEach((cond) => qb.andWhere(`(${cond.sql})`, cond.params));
    if (quickSearchConditions.length > 0) {
      qb.andWhere(
        new Brackets((sub) => {
          quickSearchConditions.forEach((cond, idx) => {
            if (idx === 0) sub.where(cond.sql, cond.params);
            else sub.orWhere(cond.sql, cond.params);
          });
        }),
      );
    }

    const sortExpressions: Record<string, string> = {
      name: 'c.name',
      status: 'c.status',
      company_name: 'comp.name',
      supplier_name: 'sup.name',
      start_date: 'c.start_date',
      end_date: `(c.start_date + COALESCE(c.duration_months, 0) * INTERVAL '1 month' - INTERVAL '1 day')::date`,
      cancellation_deadline: `(c.start_date + (COALESCE(c.duration_months, 0) - COALESCE(c.notice_period_months, 0)) * INTERVAL '1 month')::date`,
      duration_months: 'c.duration_months',
      auto_renewal: 'c.auto_renewal',
      notice_period_months: 'c.notice_period_months',
      yearly_amount_at_signature: 'c.yearly_amount_at_signature',
      currency: 'c.currency',
      billing_frequency: 'c.billing_frequency',
      created_at: 'c.created_at',
      updated_at: 'c.updated_at',
    };
    const sortField = sortExpressions[sort.field] ? sort.field : 'created_at';
    const sortExpr = sortExpressions[sortField];
    if (sortField === 'end_date') {
      qb.addSelect(sortExpr, 'sort_end_date');
      qb.orderBy('sort_end_date', sort.direction as any);
    } else if (sortField === 'cancellation_deadline') {
      qb.addSelect(sortExpr, 'sort_cancellation_deadline');
      qb.orderBy('sort_cancellation_deadline', sort.direction as any);
    } else {
      qb.orderBy(sortExpr, sort.direction as any);
    }
    if (sortExpr !== 'c.created_at') qb.addOrderBy('c.created_at', 'DESC');
    qb.offset(skip).limit(limit);

    const [rows, total] = await qb.getManyAndCount();
    return { ids: rows.map(r => (r as any).id as string), total };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const rawFields = String(query?.fields || query?.field || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(['currency', 'company_name', 'supplier_name']);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const parseFilters = (value: any): Record<string, any> => {
      if (!value) return {};
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return typeof value === 'object' ? { ...value } : {};
    };

    const baseFilters = parseFilters(query?.filters);
    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const filtersForField = { ...baseFilters };
      delete filtersForField[field];
      const result = await this.list(
        { ...query, page: 1, limit: 10000, filters: filtersForField, sort: 'name:ASC' },
        { ...opts, exportAll: true },
      );
      const values = new Set<string | null>();
      for (const item of result.items || []) {
        const rawValue = field === 'company_name'
          ? ((item as any)?.company?.name ?? null)
          : field === 'supplier_name'
            ? ((item as any)?.supplier?.name ?? null)
            : (item as any)?.[field];
        values.add(rawValue == null || rawValue === '' ? null : String(rawValue));
      }
      results[field] = Array.from(values).sort((a, b) => {
        if (a == null) return 1;
        if (b == null) return -1;
        return a.localeCompare(b);
      });
    }

    return results;
  }

  // Attachments stored via StorageService (S3)
  async listAttachments(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return mg.getRepository(ContractAttachment).find({ where: { tenant_id: sessionTenant(), contract_id: contractId }, order: { uploaded_at: 'DESC' as any } });
  }
  async uploadAttachment(contractId: string, file: Express.Multer.File, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(ContractAttachment);
    if (!file) throw new BadRequestException('No file uploaded');
    const contract = await this.findContract(contractId, mg);
    const tenant_id = contract.tenant_id;
    const id = randomUUID();
    const now = new Date();
    const decodedName = fixMulterFilename(file.originalname);
    const ext = path.extname(decodedName || '') || '';
    const rand = Math.random().toString(36).slice(2, 8);
    const key = [
      'files', tenant_id, 'contracts', contract.id,
      now.getUTCFullYear().toString(), String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${id}_${rand}${ext}`,
    ].join('/');
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : null);
    if (!buf) throw new BadRequestException('Empty upload');
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf as Buffer,
      size: (file as any).size,
    });
    await this.storage.putObject({ key, body: buf, contentType: validated.mimeType, contentLength: validated.size, sse: 'AES256' });
    const meta = attachRepo.create({
      id,
      tenant_id,
      contract_id: contract.id,
      original_filename: decodedName || `${id}${ext}`,
      stored_filename: path.basename(key),
      mime_type: (validated.mimeType || null) as any,
      size: validated.size,
      storage_path: key,
    });
    const saved = await attachRepo.save(meta as any);
    await this.audit.log({ table: 'contract_attachments', recordId: saved.id, action: 'create', before: null, after: saved, userId }, { manager: mg });
    return saved;
  }
  async downloadAttachment(attachmentId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(ContractAttachment);
    const found = await attachRepo.findOne({ where: { id: attachmentId, tenant_id: sessionTenant() } });
    if (!found) throw new NotFoundException('Attachment not found');
    return found;
  }
  async deleteAttachment(attachmentId: string, userId?: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const attachRepo = mg.getRepository(ContractAttachment);
    const found = await attachRepo.findOne({ where: { id: attachmentId, tenant_id: sessionTenant() } });
    if (!found) throw new NotFoundException('Attachment not found');
    try { await this.storage.deleteObject(found.storage_path); } catch {}
    await attachRepo.delete({ id: found.id, tenant_id: found.tenant_id });
    await this.audit.log({ table: 'contract_attachments', recordId: found.id, action: 'update', before: found, after: null, userId }, { manager: mg });
    return { ok: true };
  }

  // CSV
  private csvHeaders(): string[] {
    return [
      'name','company_name','supplier_name','start_date','duration_months','auto_renewal','notice_period_months','yearly_amount_at_signature','currency','billing_frequency','status','owner_email','notes'
    ];
  }
  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    const headers = this.csvHeaders();
    const delimiter = ';';
    const rows: any[] = [];
    const toIsoDate = (value: unknown): string => {
      if (value == null || value === '') return '';
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      const str = value.toString().trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
      const parsed = new Date(str);
      return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
    };
    if (scope === 'data') {
      const items = await repo.find({ where: { tenant_id: sessionTenant() }, order: { created_at: 'DESC' as any } });
      if (items.length) {
        const sIds = Array.from(new Set(items.map(i => i.supplier_id)));
        const cIds = Array.from(new Set(items.map(i => i.company_id)));
        const uIds = Array.from(new Set(items.map(i => i.owner_user_id).filter(Boolean)));
        const [sRows, cRows, uRows] = await Promise.all([
          mg.query(`SELECT id, name FROM suppliers WHERE tenant_id = app_current_tenant() AND id = ANY($1)`, [sIds]),
          mg.query(`SELECT id, name FROM companies WHERE tenant_id = app_current_tenant() AND id = ANY($1)`, [cIds]),
          uIds.length ? mg.query(`SELECT id, email FROM users WHERE tenant_id = app_current_tenant() AND id = ANY($1)`, [uIds]) : Promise.resolve([]),
        ]);
        const sMap = new Map<string, any>(sRows.map((r: any) => [r.id, r]));
        const cMap = new Map<string, any>(cRows.map((r: any) => [r.id, r]));
        const uMap = new Map<string, any>(uRows.map((r: any) => [r.id, r]));
        for (const it of items) {
          rows.push({
            name: it.name,
            company_name: cMap.get(it.company_id)?.name ?? '',
            supplier_name: sMap.get(it.supplier_id)?.name ?? '',
            start_date: toIsoDate(it.start_date),
            duration_months: it.duration_months,
            auto_renewal: it.auto_renewal ? 'yes' : 'no',
            notice_period_months: it.notice_period_months,
            yearly_amount_at_signature: it.yearly_amount_at_signature ?? 0,
            currency: it.currency,
            billing_frequency: it.billing_frequency,
            // Read from the end of validity: the stored status is not updated when the date passes.
            status: deriveStatusFromDisabledAt(it.disabled_at),
            owner_email: it.owner_user_id ? (uMap.get(it.owner_user_id)?.email ?? '') : '',
            notes: it.notes ?? '',
          });
        }
      }
    }
    const filename = scope === 'template' ? 'contracts_template.csv' : 'contracts.csv';
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      if (scope === 'template') {
        chunks.push(headers.join(delimiter) + '\n');
        stream.end();
      } else {
        for (const row of rows) stream.write(row);
        stream.end();
      }
    });
    const BOM = '\uFEFF';
    return { filename, content: BOM + chunks.join('') };
  }

  async importCsv({ file, dryRun, userId }: { file: Express.Multer.File; dryRun: boolean; userId?: string | null }, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(Contract);
    if (!file) throw new BadRequestException('No file uploaded');
    const buf = file.buffer || null;
    if (!buf) throw new BadRequestException('Empty upload');
    const text = decodeCsvBufferUtf8OrThrow(buf);
    const expectedHeaders = this.csvHeaders();
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    const rows = await new Promise<any[]>((resolve, reject) => {
      const out: any[] = [];
      parseString(text, { headers: true, delimiter: ';', ignoreEmpty: true })
        .on('headers', (headers: string[]) => {
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) {
            errors.push({ row: 0, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` });
          }
        })
        .on('error', (e) => reject(e))
        .on('data', (r) => out.push(denormalizeCsvRow(r)))
        .on('end', () => resolve(out));
    });
    if (!headerOk) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors };
    if (rows.length === 0) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors: [{ row: 0, message: 'Empty CSV' }] };

    // Preload reference maps by name/email for resolution
    const allCompanies = await mg.query(`SELECT id, name FROM companies WHERE tenant_id = app_current_tenant()`);
    const allSuppliers = await mg.query(`SELECT id, name FROM suppliers WHERE tenant_id = app_current_tenant()`);
    const allUsers = await mg.query(`SELECT id, email FROM users WHERE tenant_id = app_current_tenant()`);
    const cByName = new Map<string, any>(allCompanies.map((r: any) => [r.name, r]));
    const sByName = new Map<string, any>(allSuppliers.map((r: any) => [r.name, r]));
    const uByEmail = new Map<string, any>(allUsers.map((r: any) => [r.email.toLowerCase(), r]));

    const norm: Array<ContractUpsertDto & { supplier_name: string; company_name: string; owner_email?: string | null }> = [];
    let line = 1;
    for (const r of rows) {
      line += 1;
      const name = (r['name'] ?? '').toString().trim();
      const company_name = (r['company_name'] ?? '').toString().trim();
      const supplier_name = (r['supplier_name'] ?? '').toString().trim();
      const start_date = (r['start_date'] ?? '').toString().trim();
      const duration_months = parseInt((r['duration_months'] ?? '12').toString(), 10) || 12;
      const auto_raw = (r['auto_renewal'] ?? '').toString().trim().toLowerCase();
      const auto_renewal = ['yes','true','1','y','t'].includes(auto_raw);
      const notice_period_months = parseInt((r['notice_period_months'] ?? '1').toString(), 10) || 1;
      const yearly_amount_at_signature = Number((r['yearly_amount_at_signature'] ?? '0').toString().replace(/\s/g, '').replace(',', '.')) || 0;
      const currency = ((r['currency'] ?? 'EUR').toString().trim() || 'EUR').toUpperCase();
      const billing_frequency = (r['billing_frequency'] ?? 'annual').toString().trim();
      // Blank: enabled for a new contract, the current status on an update.
      const statusRaw = (r['status'] ?? '').toString().trim().toLowerCase();
      const status = statusRaw === 'disabled' ? 'disabled' : statusRaw ? 'enabled' : null;
      const owner_email = ((r['owner_email'] ?? '').toString().trim()) || null;
      const notes = ((r['notes'] ?? '').toString().trim()) || null;
      if (!name) errors.push({ row: line, message: 'name is required' });
      if (!company_name) errors.push({ row: line, message: 'company_name is required' });
      else if (!cByName.has(company_name)) errors.push({ row: line, message: `company '${company_name}' not found` });
      if (!supplier_name) errors.push({ row: line, message: 'supplier_name is required' });
      else if (!sByName.has(supplier_name)) errors.push({ row: line, message: `supplier '${supplier_name}' not found` });
      if (owner_email && !uByEmail.has(owner_email.toLowerCase())) errors.push({ row: line, message: `user '${owner_email}' not found` });
      if (!start_date) errors.push({ row: line, message: 'start_date is required' });
      if (currency && currency.length !== 3) errors.push({ row: line, message: 'currency must be 3 letters' });
      if (!['monthly','quarterly','annual','other'].includes(billing_frequency)) errors.push({ row: line, message: 'billing_frequency invalid' });
      norm.push({ name, company_name, supplier_name, start_date, duration_months, auto_renewal, notice_period_months, yearly_amount_at_signature, currency, billing_frequency, status, owner_email, notes } as any);
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };

    // Deduplicate by composite key name+supplier_name (first wins)
    const uniqMap = new Map<string, typeof norm[number]>();
    for (const item of norm) {
      const key = `${item.name}||${item.supplier_name}`.toLowerCase();
      if (!uniqMap.has(key)) uniqMap.set(key, item);
    }
    const unique = Array.from(uniqMap.values());

    // Determine inserts/updates by composite (name + supplier)
    let inserted = 0; let updated = 0;
    for (const item of unique) {
      const s = sByName.get(item.supplier_name);
      if (!s) { updated += 0; continue; }
      const exists = await repo.findOne({ where: { tenant_id: sessionTenant(), name: item.name as any, supplier_id: s.id as any } });
      if (exists) updated += 1; else inserted += 1;
    }
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };

    // Commit
    let processed = 0;
    for (const item of unique) {
      const company = cByName.get(item.company_name);
      const supplier = sByName.get(item.supplier_name);
      const owner = item.owner_email ? uByEmail.get(item.owner_email.toLowerCase()) : null;
      if (!company || !supplier) continue; // skip unresolved refs silently
      const exists = await repo.findOne({ where: { tenant_id: sessionTenant(), name: item.name as any, supplier_id: supplier.id as any } });
      // The file has no end of validity: a status equal to the current one (read from the date)
      // or blank keeps the stored date; a new contract is enabled unless the row says disabled.
      const status = exists
        ? (item.status && item.status !== deriveStatusFromDisabledAt(exists.disabled_at) ? item.status : undefined)
        : (item.status ?? 'enabled');
      const payload: ContractUpsertDto = {
        name: item.name as any,
        company_id: company.id,
        supplier_id: supplier.id,
        owner_user_id: owner?.id ?? null,
        start_date: item.start_date as any,
        duration_months: item.duration_months as any,
        auto_renewal: item.auto_renewal as any,
        notice_period_months: item.notice_period_months as any,
        yearly_amount_at_signature: item.yearly_amount_at_signature as any,
        currency: item.currency as any,
        billing_frequency: item.billing_frequency as any,
        ...(status ? { status: status as any } : {}),
        notes: (item.notes as any) ?? null,
      };
      if (exists) { await this.update(exists.id, payload, userId ?? undefined, { manager: mg }); processed += 1; }
      else { await this.create(payload, userId ?? undefined, { manager: mg }); processed += 1; }
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
  }

  // Symmetric linking from OPEX side
  async listContractsForSpendItem(spendItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const linksRepo = mg.getRepository(ContractSpendItem);
    const contractRepo = mg.getRepository(Contract);
    // The contracts of an OPEX line only (`spend/budget-nature.ts`): none for a line of another nature.
    const [line] = await mg.query(
      `SELECT 1 FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1 AND nature = 'opex'`,
      [spendItemId],
    );
    if (!line) return { items: [] };
    const rows = await linksRepo.find({ where: { tenant_id: sessionTenant(), spend_item_id: spendItemId } });
    const ids = rows.map(r => r.contract_id);
    const items = ids.length ? await contractRepo.findBy({ tenant_id: sessionTenant(), id: In(ids) }) : [];
    // Only return essentials
    return { items: items.map(i => ({ id: i.id, name: i.name })) };
  }

  async bulkReplaceContractsForSpendItem(spendItemId: string, contractIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(ContractSpendItem);
    const [spend]: Array<{ id: string; tenant_id: string }> = await mg.query(
      `SELECT id, tenant_id FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1 AND nature = 'opex'`,
      [spendItemId],
    );
    if (!spend) throw new NotFoundException('Spend item not found.');
    const tenantId = spend.tenant_id;
    const uniqueIds = Array.from(new Set((contractIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'contracts', tenantId, uniqueIds, 'One or more contracts not found.');
    const existing = await repo.find({ where: { tenant_id: tenantId, spend_item_id: spend.id } });
    const toDelete = existing.filter(e => !uniqueIds.includes(e.contract_id));
    const existingSet = new Set(existing.map(e => e.contract_id));
    const toInsert = uniqueIds.filter(id => !existingSet.has(id)).map(id => repo.create({ tenant_id: tenantId, contract_id: id, spend_item_id: spend.id }));
    if (toDelete.length > 0) await repo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await repo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Symmetric linking from CAPEX side
  async listContractsForCapexItem(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    // Use dedicated repo for CAPEX join
    const capexLinksRepo = mg.getRepository(ContractCapexItem);
    const contractRepo = mg.getRepository(Contract);
    const rows = await capexLinksRepo.find({ where: { tenant_id: sessionTenant(), capex_item_id: capexItemId } });
    const ids = rows.map((r) => r.contract_id);
    const items = ids.length ? await contractRepo.findBy({ tenant_id: sessionTenant(), id: In(ids) }) : [];
    return { items: items.map((i) => ({ id: i.id, name: i.name })) };
  }

  async bulkReplaceContractsForCapexItem(capexItemId: string, contractIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const capexLinksRepo = mg.getRepository(ContractCapexItem);
    const [capex]: Array<{ id: string; tenant_id: string }> = await mg.query(
      `SELECT id, tenant_id FROM capex_items WHERE tenant_id = app_current_tenant() AND id = $1`,
      [capexItemId],
    );
    if (!capex) throw new NotFoundException('CAPEX item not found.');
    const tenantId = capex.tenant_id;
    const uniqueIds = Array.from(new Set((contractIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'contracts', tenantId, uniqueIds, 'One or more contracts not found.');
    const existing = await capexLinksRepo.find({ where: { tenant_id: tenantId, capex_item_id: capex.id } });
    const toDelete = existing.filter((e) => !uniqueIds.includes(e.contract_id));
    const existingSet = new Set(existing.map((e) => e.contract_id));
    const toInsert = uniqueIds
      .filter((id) => !existingSet.has(id))
      .map((id) => capexLinksRepo.create({ tenant_id: tenantId, contract_id: id, capex_item_id: capex.id }));
    if (toDelete.length > 0) await capexLinksRepo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await capexLinksRepo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Inverse links from Contract side
  async listLinkedCapexItems(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(ContractCapexItem);
    const capexRepo = mg.getRepository((await import('../capex/capex-item.entity')).CapexItem);
    const rows = await repo.find({ where: { tenant_id: sessionTenant(), contract_id: contractId } });
    const ids = rows.map((r) => r.capex_item_id);
    const items = ids.length ? await capexRepo.findBy({ tenant_id: sessionTenant(), id: In(ids) }) : [];
    return { items: items.map((i: any) => ({ id: i.id, description: i.description })) };
  }

  async bulkReplaceLinkedCapexItems(contractId: string, capexItemIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(ContractCapexItem);
    const contract = await this.findContract(contractId, mg);
    const tenantId = contract.tenant_id;
    const uniqueIds = Array.from(new Set((capexItemIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'capex_items', tenantId, uniqueIds, 'One or more CAPEX items not found.');
    const existing = await repo.find({ where: { tenant_id: tenantId, contract_id: contract.id } });
    const toDelete = existing.filter((e) => !uniqueIds.includes(e.capex_item_id));
    const existingSet = new Set(existing.map((e) => e.capex_item_id));
    const toInsert = uniqueIds.filter((id) => !existingSet.has(id)).map((id) => repo.create({ tenant_id: tenantId, contract_id: contract.id, capex_item_id: id }));
    if (toDelete.length > 0) await repo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await repo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }
}

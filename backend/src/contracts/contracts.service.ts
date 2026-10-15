import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { BUDGET_LINE_TABLE, BUDGET_NATURES, linkedLineOf, naturesAnd } from '../spend/budget-nature';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DeepPartial, EntityManager, In, Repository, Raw, SelectQueryBuilder } from 'typeorm';
import { Contract } from './contract.entity';
import { ContractSpendItem } from './contract-spend-item.entity';
import { ContractLink } from './contract-link.entity';
import { ContractAttachment } from './contract-attachment.entity';
import { AuditService } from '../audit/audit.service';
import { parseExportPagination, parsePagination, type Sort } from '../common/pagination';
import { textSortKey } from '../common/list-sort';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import { CsvDecodeError, decodeCsv } from '../common/csv-sheet/decode';
import * as path from 'path';
import * as fs from 'fs';
import { deriveStatusFromDisabledAt, resolveLifecycleState } from '../common/status';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { ContractUpsertDto } from './dto/contract.dto';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { shareRecipientsOf } from '../notifications/share-recipients';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
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
import { contractTermFields, contractTermsSql, sqlDateLiteral, turnsOffRenewalOfRenewedContract, type ContractTermFields } from './contract-terms';
import { readDecisionWindowDays } from './contract-settings.service';
import { renewalDecisionSql } from './contract-renewal';
import { readRenewalDecisions, renewalDecisionOf } from './contract-renewal.service';
import { utcDateYmd } from '../notifications/expiry-reminder-schedule';
import { centsToNumber } from '../common/amount';
import { FxRateService } from '../currency/fx-rate.service';
import {
  contractRelationCounts,
  listContractApplications,
  listContractAssets,
  listContractBudgetLines,
  replaceContractRelations,
  type ContractRelationSet,
} from './contract-relations';
import {
  contractBudgetCurrentYear,
  contractBudgetParams,
  contractBudgetSql,
  contractBudgetYears,
  contractFxRates,
  loadContractBudgetInputs,
  parseContractBudgetSelection,
  readContractBudgetRows,
  type ContractBudgetInputs,
  type ContractBudgetRow,
  type ContractBudgetState,
} from './contract-budget';
import {
  COMPLIANCE_SORT_EXPRESSION,
  complianceParams,
  complianceRegisterCsv,
  complianceSummarySql,
  contractComplianceView,
  loadContractComplianceInputs,
  readComplianceSummaries,
  updateContractComplianceItem,
  type ComplianceItemPatch,
  type ComplianceSummary,
  type ContractComplianceInputs,
} from './contract-compliance';
import { headerMismatchError, type CsvLanguage } from '../common/csv-sheet';
import { sameStoredValues } from '../common/csv-sheet/unchanged';

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

/** The refusal of an edit that turns off the renewal of a contract already renewed (`turnsOffRenewalOfRenewedContract`). */
const RENEWED_CONTRACT_RENEWAL_OFF =
  'This contract has already been renewed: turning off its tacit renewal without an end of validity would remove the terms it has run. Set an end of validity in the same request.';

// Never written from a body: the row's identity, tenant and timestamps.
const NOT_WRITABLE = ['id', 'tenant_id', 'created_at', 'updated_at'] as const;

/**
 * True when re-importing a CSV row over the stored contract writes nothing (`importCsv`): every
 * column the row sets holds its value (company and owner resolved to their ids), and the status
 * the row leaves is the stored one. A blank status, or one equal to the status read from the end
 * of validity, keeps that date; the update would still rewrite a stored status that lags behind
 * the date. The import writes no link, so there is nothing else to compare.
 */
function importRowUnchanged(stored: Contract, next: Partial<Record<keyof Contract, unknown>>, rowStatus: string | null, now: Date): boolean {
  const status = deriveStatusFromDisabledAt(stored.disabled_at, now);
  if (rowStatus && rowStatus !== status) return false;
  if (stored.status !== status) return false;
  return sameStoredValues(stored as unknown as Record<string, unknown>, next);
}

type ListItem = Contract & ContractTermFields & {
  supplier?: { id: string; name: string } | null;
  company?: { id: string; name: string } | null;
  /** Links to budget lines of both natures. */
  linked_lines_count?: number;
  latest_task?: { id: string; status?: string; description?: string; created_at?: Date } | null;
  /**
   * With a budget year and column (`budget_year`, `budget_column`) and the right to read the
   * budget: the contract against its budget lines (`contract-budget.ts`), in the reporting currency.
   */
  budget_committed?: number | null;
  budget_linked?: number;
  budget_gap?: number | null;
  budget_state?: ContractBudgetState | null;
  /** What the compliance register expects of the contract and what is missing (`contract-compliance.ts`). */
  compliance?: ComplianceSummary;
};

/** Who reads a list: the budget figures need the right to read the budget too. */
type ListReadOptions = { manager?: EntityManager; budgetAccess?: boolean };
/** The list columns that sort alphabetically. */
const CONTRACT_TEXT_SORTS = new Set(['name', 'company_name', 'supplier_name', 'currency', 'billing_frequency']);

/** A contract link `l` to an OPEX line (`spend/budget-nature.ts`): the OPEX side lists, counts and replaces those only. */
const OPEX_LINK = linkedLineOf('l.tenant_id', 'l.spend_item_id', 'opex');
const CAPEX_LINK = linkedLineOf('l.tenant_id', 'l.spend_item_id', 'capex');
/** A contract link `l` to a budget line of either nature: the list counts both. */
const ANY_LINE_LINK = ` AND EXISTS (SELECT 1 FROM ${BUDGET_LINE_TABLE} nl WHERE nl.tenant_id = l.tenant_id AND nl.id = l.spend_item_id${naturesAnd('nl', BUDGET_NATURES)})`;

/** The list's order without a valid `sort`: the next due date first (`contract-terms.ts`). */
const DEFAULT_LIST_SORT: Sort = { field: 'next_due_date', direction: 'ASC' };
/**
 * The sort fields ordered through a selected alias: the ones computed from the contract terms, and
 * the joined names (the paginated query cannot order on a column of a join it does not select).
 */
const ALIAS_SORT_FIELDS = new Set(['end_date', 'cancellation_deadline', 'next_due_date', 'company_name', 'supplier_name']);
/** The budget figures of the list (`contract-budget.ts`, joined as `cb`), in units of the reporting currency. */
const BUDGET_FIELDS: Record<string, string> = {
  budget_committed: '(cb.committed::numeric / 100)',
  budget_linked: '(cb.linked / 100)',
  budget_gap: '(cb.gap / 100)',
};

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
    private readonly fxRates: FxRateService,
  ) {}

  /**
   * The list's filter targets. The end date, the cancellation deadline, the next due date and the
   * state are those of the current term as of `today` (`contract-terms.ts`), like the values the
   * list returns; the state with the tenant's decision window (`windowDays`) and the decisions
   * recorded in the audit log (`renewalDecisionSql`).
   */
  private contractFilterTargets(today: string, windowDays: number, withBudget = false, withCompliance = false): Record<string, FilterTargetConfig> {
    const terms = contractTermsSql('c', sqlDateLiteral(today), { decisionWindowDays: windowDays, renewalDecision: renewalDecisionSql('c') });
    // The compliance summary, when the list joins it as `cc` (its sort or its filter is asked for).
    const compliance: Record<string, FilterTargetConfig> = withCompliance
      ? { compliance_state: { expression: 'cc.state', dataType: 'string' } }
      : {};
    const budget: Record<string, FilterTargetConfig> = withBudget
      ? {
          ...Object.fromEntries(Object.entries(BUDGET_FIELDS).map(([field, expression]) => [
            field,
            { expression, numericExpression: expression, textExpression: `CAST(${expression} AS TEXT)`, dataType: 'number' as const },
          ])),
          budget_state: { expression: 'cb.state', dataType: 'string' },
        }
      : {};
    return {
      ...budget,
      ...compliance,
      id: { expression: 'c.id', dataType: 'string' },
      name: { expression: 'c.name', dataType: 'string' },
      status: { expression: 'c.status', textExpression: 'CAST(c.status AS TEXT)', dataType: 'string' },
      company_id: { expression: 'c.company_id', dataType: 'string' },
      supplier_id: { expression: 'c.supplier_id', dataType: 'string' },
      owner_user_id: { expression: 'c.owner_user_id', dataType: 'string' },
      start_date: { expression: 'c.start_date', dataType: 'date' },
      end_date: { expression: terms.currentTermEnd, dataType: 'date' },
      cancellation_deadline: { expression: terms.cancellationDeadline, dataType: 'date' },
      next_due_date: { expression: terms.nextDueDate, dataType: 'date' },
      term_state: { expression: terms.termState, dataType: 'string' },
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
      // The budget lines linked to the contract, of both natures, as the list counts them.
      linked_lines_count: {
        expression: `(SELECT COUNT(*) FROM contract_spend_items l WHERE l.tenant_id = c.tenant_id AND l.contract_id = c.id${ANY_LINE_LINK})`,
        dataType: 'number',
      },
      // The Task column: the status and the description of the contract's latest task.
      latest_task_text: {
        expression: `(SELECT concat_ws(': ', NULLIF(lt.status::text, ''), lt.description) FROM tasks lt
          WHERE lt.tenant_id = c.tenant_id AND lt.related_object_type = 'contract' AND lt.related_object_id = c.id
          ORDER BY lt.created_at DESC LIMIT 1)`,
        dataType: 'string',
      },
    };
  }

  /**
   * The contracts a list request selects: the tenant, the status scope (read from the end of
   * validity), the column filters and the quick search. `omitFilters` leaves column filters out
   * (the count behind a quick filter ignores the filter it sets). Shared by the rows, the ids
   * and the totals, so they always cover the same contracts. With `budget`, the contracts' budget
   * figures (`contract-budget.ts`) join as `cb`, for the filters, the sort and the totals. With
   * `compliance`, the compliance summaries (`contract-compliance.ts`) join as `cc` when the request
   * sorts or filters on them, and only then. `windowDays`: the tenant's decision window
   * (`readDecisionWindowDays`), for the state.
   */
  private listQuery(
    mg: EntityManager,
    query: any,
    opts: { windowDays: number; exportAll?: boolean; omitFilters?: string[]; budget?: ContractBudgetInputs | null; compliance?: ContractComplianceInputs | null },
  ) {
    const repo = mg.getRepository(Contract);
    const parsed = opts.exportAll
      ? parseExportPagination(query, DEFAULT_LIST_SORT)
      : parsePagination(query, DEFAULT_LIST_SORT);
    const { status, q, filters } = parsed;
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const today = utcDateYmd(new Date());
    const budget = opts.budget ?? null;
    const complianceFiltered = !!filtersToApply && typeof filtersToApply === 'object'
      && Object.prototype.hasOwnProperty.call(filtersToApply, 'compliance_state')
      && !opts?.omitFilters?.includes('compliance_state');
    const compliance = opts?.compliance && (parsed.sort.field === 'compliance_state' || complianceFiltered) ? opts.compliance : null;
    const filterTargets = this.contractFilterTargets(today, opts.windowDays, budget !== null, compliance !== null);
    const nextParam = createParamNameGenerator('c');
    const compiledFilters: CompiledCondition[] = [];
    if (filtersToApply && typeof filtersToApply === 'object') {
      for (const [field, model] of Object.entries(filtersToApply)) {
        if (opts?.omitFilters?.includes(field)) continue;
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
      .leftJoin('companies', 'comp', 'comp.id = c.company_id AND comp.tenant_id = c.tenant_id')
      .leftJoin('suppliers', 'sup', 'sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id')
      .where('c.tenant_id = app_current_tenant()');
    if (budget) {
      // One row per contract of the tenant for the one year asked for, computed once.
      qb.addCommonTableExpression(contractBudgetSql({ contractIds: null }), 'cb', { materialized: true })
        .leftJoin('cb', 'cb', 'cb.contract_id = c.id')
        .setParameters(contractBudgetParams(budget));
    }
    if (compliance) {
      // One row per contract of the tenant, computed once.
      qb.addCommonTableExpression(complianceSummarySql(false), 'cc', { materialized: true })
        .leftJoin('cc', 'cc', 'cc.contract_id = c.id')
        .setParameters(complianceParams(compliance));
    }
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
    return { qb, parsed, today, filterTargets };
  }

  /**
   * Orders a list query. The term values sort through a selected alias; the next due date puts
   * the contracts without one (ended) last in both directions.
   */
  private async applyListSort(qb: SelectQueryBuilder<Contract>, sort: Sort, filterTargets: Record<string, FilterTargetConfig>) {
    // The budget figures sort when the list joins them (a budget year and column were given).
    const budgetSorts = filterTargets.budget_state ? BUDGET_FIELDS : {};
    // The compliance summary sorts when the list joins it (`listQuery`).
    const complianceSorts: Record<string, string> = filterTargets.compliance_state ? { compliance_state: COMPLIANCE_SORT_EXPRESSION } : {};
    const sortExpressions: Record<string, string> = {
      ...budgetSorts,
      ...complianceSorts,
      name: 'c.name',
      status: 'c.status',
      company_name: 'comp.name',
      supplier_name: 'sup.name',
      start_date: 'c.start_date',
      end_date: filterTargets.end_date.expression,
      cancellation_deadline: filterTargets.cancellation_deadline.expression,
      next_due_date: filterTargets.next_due_date.expression,
      duration_months: 'c.duration_months',
      auto_renewal: 'c.auto_renewal',
      notice_period_months: 'c.notice_period_months',
      yearly_amount_at_signature: 'c.yearly_amount_at_signature',
      currency: 'c.currency',
      billing_frequency: 'c.billing_frequency',
      created_at: 'c.created_at',
      updated_at: 'c.updated_at',
    };
    const sortField = sortExpressions[sort.field] ? sort.field : DEFAULT_LIST_SORT.field;
    const sortExpr = sortExpressions[sortField];
    const direction = sort.field === sortField ? sort.direction : DEFAULT_LIST_SORT.direction;
    if (ALIAS_SORT_FIELDS.has(sortField) || budgetSorts[sortField] || complianceSorts[sortField]) {
      qb.addSelect(sortExpr, `sort_${sortField}`);
      // Without a value (no next due date, no rate for the currency): last in both directions.
      qb.orderBy(`sort_${sortField}`, direction, sortField === 'next_due_date' || budgetSorts[sortField] ? 'NULLS LAST' : undefined);
    } else if (CONTRACT_TEXT_SORTS.has(sortField)) {
      // Text alphabetically, case and accents ignored, through a selected alias (paged over joins).
      const textKey = await textSortKey(qb.connection.manager);
      qb.addSelect(textKey(sortExpr), `sort_${sortField}`);
      qb.orderBy(`sort_${sortField}`, direction);
    } else {
      qb.orderBy(sortExpr, direction);
    }
    if (sortExpr !== 'c.created_at') qb.addOrderBy('c.created_at', 'DESC');
    // Last, so equal rows keep one order from page to page.
    qb.addOrderBy('c.id', 'ASC');
  }

  /**
   * The budget figures a list request asks for: its `budget_year` and `budget_column`, when the
   * caller may read the budget (otherwise they are ignored). Their inputs cover every contract of
   * the tenant, so the list can sort and filter on them.
   */
  private async listBudgetInputs(mg: EntityManager, query: any, opts?: ListReadOptions): Promise<ContractBudgetInputs | null> {
    if (!opts?.budgetAccess) return null;
    const selection = parseContractBudgetSelection(query, contractBudgetCurrentYear());
    if (!selection) return null;
    const tenantId = await this.sessionTenantId(mg);
    return loadContractBudgetInputs({ fxRates: this.fxRates }, mg, tenantId, [selection.year], selection.column);
  }

  private async sessionTenantId(mg: EntityManager): Promise<string> {
    const [row] = await mg.query(`SELECT app_current_tenant() AS id`);
    if (!row?.id) throw new BadRequestException('Tenant context is required');
    return row.id as string;
  }

  async list(query: any, opts?: ListReadOptions & { exportAll?: boolean }) {
    const mg = opts?.manager ?? this.repo.manager;
    const budget = await this.listBudgetInputs(mg, query, opts);
    const compliance = await loadContractComplianceInputs(mg);
    const windowDays = await readDecisionWindowDays(mg);
    const { qb: qbBase, parsed, today, filterTargets } = this.listQuery(mg, query, { windowDays, exportAll: opts?.exportAll, budget, compliance });
    const { page, limit, skip, sort } = parsed;

    const total = await qbBase.clone().getCount();
    const qb = qbBase.clone();
    await this.applyListSort(qb, sort, filterTargets);
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
    // The budget lines of both natures (spend/budget-nature.ts).
    const counts: Array<{ contract_id: string; c: string }> = contractIds.length
      ? await mg.query(
          `SELECT l.contract_id, COUNT(*)::text as c FROM contract_spend_items l
            WHERE l.tenant_id = app_current_tenant() AND l.contract_id = ANY($1)${ANY_LINE_LINK}
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

    // The page's budget figures, from the same statement the list sorted and filtered on.
    const budgetById = new Map<string, ContractBudgetRow>(
      budget && contractIds.length
        ? (await readContractBudgetRows(mg, { ...budget, contractIds })).map((row) => [row.contract_id, row])
        : [],
    );
    // The page's compliance summaries, by batch of ids (`contract-compliance.ts`).
    const complianceById = await readComplianceSummaries(mg, compliance, contractIds);
    // The decisions recorded for the page's contracts: a contract renewed, or left to end, is not to decide.
    const decisions = await readRenewalDecisions(mg, contractIds);

    const enriched: ListItem[] = items.map((i) => {
      const figures = budgetById.get(i.id);
      return {
        ...i,
        ...contractTermFields(i, today, { decisionWindowDays: windowDays, renewalDecision: renewalDecisionOf(decisions, i.id) }),
        // From the end of validity, like the filter: the stored status stays enabled once the date passes.
        status: deriveStatusFromDisabledAt(i.disabled_at),
        supplier: i.supplier_id ? { id: i.supplier_id, name: sById.get(i.supplier_id)?.name ?? '' } : null,
        company: i.company_id ? { id: i.company_id, name: cById.get(i.company_id)?.name ?? '' } : null,
        linked_lines_count: countById.get(i.id) ?? 0,
        latest_task: latestById.get(i.id) ? {
          id: latestById.get(i.id)!.id,
          status: latestById.get(i.id)!.status,
          description: latestById.get(i.id)!.description || undefined,
          created_at: latestById.get(i.id)!.created_at,
        } : null,
        compliance: complianceById.get(i.id) ?? { expected: 0, missing: 0, to_check: 0, state: 'none' },
        ...(budget
          ? {
              budget_committed: figures?.committed ?? null,
              budget_linked: figures?.linked ?? 0,
              budget_gap: figures?.gap ?? null,
              budget_state: figures?.state ?? null,
            }
          : {}),
      };
    });

    return { items: enriched, total, page, limit };
  }

  /**
   * The footer of the list for the same request (search, filters, status scope): the number of
   * contracts and the sum of their yearly amounts in the tenant's reporting currency, converted
   * with the rates of this year's budget (the latest rate set of the year, as the budget's live
   * columns: `contractFxRates`). Contracts in a currency without a rate stay out of the sum and are
   * counted by currency in `excluded`. `to_decide_count`: the contracts the "to decide" quick filter
   * shows, the state filter itself left out; `decision_window_days`: the tenant's window it uses.
   *
   * With a budget year and column (`budget_year`, `budget_column`) and the right to read the
   * budget, `budget` sums the list's budget figures (`contract-budget.ts`): committed (contracts
   * whose currency has no rate that year left out and counted in `excluded`), linked, gap (over
   * the contracts with a committed amount), the counts of the "no budget line" and "under-budgeted"
   * quick filters (the budget state filter left out), and the years the selector offers.
   */
  async totals(query: any, opts?: ListReadOptions & { tenantId?: string }) {
    const mg = opts?.manager ?? this.repo.manager;
    const budget = await this.listBudgetInputs(mg, query, opts);
    const compliance = await loadContractComplianceInputs(mg);
    const windowDays = await readDecisionWindowDays(mg, opts?.tenantId);
    const { qb } = this.listQuery(mg, query, { windowDays, exportAll: true, budget, compliance });
    const groups: Array<{ currency: string; count: string; amount: string }> = await qb
      .clone()
      .select(`UPPER(TRIM(COALESCE(c.currency, '')))`, 'currency')
      .addSelect('COUNT(*)::text', 'count')
      .addSelect('COALESCE(SUM(c.yearly_amount_at_signature), 0)::text', 'amount')
      .groupBy(`UPPER(TRIM(COALESCE(c.currency, '')))`)
      .getRawMany();
    groups.sort((a, b) => a.currency.localeCompare(b.currency));

    const { qb: stateBase, filterTargets } = this.listQuery(mg, query, { windowDays, exportAll: true, omitFilters: ['term_state'], budget, compliance });
    const toDecideCount = await stateBase
      .andWhere(`${filterTargets.term_state.expression} = 'to_decide'`)
      .getCount();

    const tenantId = opts?.tenantId ?? (await this.sessionTenantId(mg));
    const year = Number(utcDateYmd(new Date()).slice(0, 4));
    const fx = await contractFxRates(this.fxRates, mg, tenantId, [year]);

    let count = 0;
    let amount = 0;
    const excluded: Array<{ currency: string; count: number }> = [];
    for (const group of groups) {
      const n = Number(group.count);
      count += n;
      const currency = group.currency || 'EUR';
      const rate = fx.rateOf(year, currency);
      if (rate === null) {
        excluded.push({ currency, count: n });
        continue;
      }
      amount += this.fxRates.convertValue(Number(group.amount), rate);
    }
    return {
      count,
      yearly_amount: Math.round(amount * 100) / 100,
      reporting_currency: fx.reportingCurrency,
      fx_year: year,
      excluded,
      to_decide_count: toDecideCount,
      decision_window_days: windowDays,
      ...(budget ? { budget: await this.budgetTotals(mg, query, budget, compliance, windowDays) } : {}),
    };
  }

  /** The `budget` part of the totals (see `totals`). */
  private async budgetTotals(mg: EntityManager, query: any, budget: ContractBudgetInputs, compliance: ContractComplianceInputs, windowDays: number) {
    const { qb } = this.listQuery(mg, query, { windowDays, exportAll: true, budget, compliance });
    const sums: { committed: string | null; linked: string | null; gap: string | null } = await qb
      .clone()
      .select('SUM(cb.committed::numeric)::text', 'committed')
      .addSelect('SUM(cb.linked)::text', 'linked')
      .addSelect('SUM(cb.gap)::text', 'gap')
      .getRawOne() ?? { committed: null, linked: null, gap: null };
    const excluded: Array<{ currency: string; count: string }> = await qb
      .clone()
      .select(`COALESCE(NULLIF(UPPER(TRIM(c.currency)), ''), 'EUR')`, 'currency')
      .addSelect('COUNT(*)::text', 'count')
      .andWhere('cb.committed IS NULL')
      .groupBy(`COALESCE(NULLIF(UPPER(TRIM(c.currency)), ''), 'EUR')`)
      .getRawMany();
    excluded.sort((a, b) => a.currency.localeCompare(b.currency));
    const { qb: stateBase } = this.listQuery(mg, query, { windowDays, exportAll: true, omitFilters: ['budget_state'], budget, compliance });
    const counts: { no_line: string; under: string } = await stateBase
      .select(`COUNT(*) FILTER (WHERE cb.state = 'no_line')::text`, 'no_line')
      .addSelect(`COUNT(*) FILTER (WHERE cb.state = 'under')::text`, 'under')
      .getRawOne() ?? { no_line: '0', under: '0' };
    const units = (cents: string | null) => (cents == null ? 0 : Math.round(Number(cents)) / 100);
    const [year] = budget.years;
    return {
      year,
      column: budget.column,
      reporting_currency: budget.reportingCurrency,
      committed: units(sums.committed),
      linked: units(sums.linked),
      gap: units(sums.gap),
      excluded: excluded.map((entry) => ({ currency: entry.currency, count: Number(entry.count) })),
      no_line_count: Number(counts.no_line),
      under_count: Number(counts.under),
      years: await contractBudgetYears(mg, budget.tenantId, contractBudgetCurrentYear(), year),
    };
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
    const windowDays = await readDecisionWindowDays(mg, tenantId);
    const decisions = await readRenewalDecisions(mg, [found.id]);
    const terms = contractTermFields(found, utcDateYmd(new Date()), { decisionWindowDays: windowDays, renewalDecision: renewalDecisionOf(decisions, found.id) });
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
    // The names the page's header shows, read with the contract (no request per picker).
    const [names]: Array<{ supplier_name: string | null; company_name: string | null; owner_name: string | null }> = await mg.query(
      `SELECT sup.name AS supplier_name, comp.name AS company_name,
              NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS owner_name
         FROM contracts c
         LEFT JOIN suppliers sup ON sup.tenant_id = c.tenant_id AND sup.id = c.supplier_id
         LEFT JOIN companies comp ON comp.tenant_id = c.tenant_id AND comp.id = c.company_id
         LEFT JOIN users u ON u.tenant_id = c.tenant_id AND u.id = c.owner_user_id
        WHERE c.tenant_id = $1 AND c.id = $2`,
      [tenantId, id],
    );
    return {
      ...found,
      ...terms,
      // The tenant's decision window: the page draws it on the timeline (`contract-settings.service.ts`).
      decision_window_days: windowDays,
      supplier_name: names?.supplier_name ?? null,
      company_name: names?.company_name ?? null,
      owner_name: names?.owner_name ?? null,
      linked_spend_items: spendItems,
      links,
      attachments,
      latest_task,
    };
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
    // A contract already renewed keeps its terms: without renewal nor end of validity, the term rule ends it after its first term.
    if (turnsOffRenewalOfRenewedContract(before, existing, utcDateYmd(now))) throw new BadRequestException(RENEWED_CONTRACT_RENEWAL_OFF);

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

  /**
   * Refuses any id that is not a row of `target` in the tenant: `opex` / `capex`, a line of
   * `spend_items` of that nature (`spend/budget-nature.ts`), or a contract.
   */
  private async assertIdsInTenant(
    mg: EntityManager,
    target: 'opex' | 'capex' | 'contracts',
    tenantId: string,
    ids: string[],
    message: string,
  ) {
    if (ids.length === 0) return;
    const rows: Array<{ id: string }> = target === 'contracts'
      ? await mg.query(`SELECT id FROM contracts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids])
      : await mg.query(`SELECT id FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND nature = $3`, [tenantId, ids, target]);
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
    await this.assertIdsInTenant(mg, 'opex', tenantId, uniqueIds, 'One or more spend items not found.');
    // The contract's links to OPEX lines only: a link to a line of another nature is kept as it is.
    const existing: Array<{ id: string; spend_item_id: string }> = await mg.query(
      `SELECT l.id, l.spend_item_id FROM contract_spend_items l WHERE l.tenant_id = $1 AND l.contract_id = $2${OPEX_LINK}`,
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

  async listIds(query: any, opts?: ListReadOptions) {
    const mg = opts?.manager ?? this.repo.manager;
    // The workspace walks the list in its order, a budget figure's included.
    const budget = await this.listBudgetInputs(mg, query, opts);
    const compliance = await loadContractComplianceInputs(mg);
    const windowDays = await readDecisionWindowDays(mg);
    const { qb, parsed, filterTargets } = this.listQuery(mg, query, { windowDays, budget, compliance });
    const { skip, sort } = parsed;
    // Not the parsed limit: parsePagination defaults to a page of 20, and the prev/next
    // navigation that calls this sends no limit, so it only ever knew 20 contracts.
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    qb.select(['c.id']);
    await this.applyListSort(qb, sort, filterTargets);
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
  async exportCsv(scope: 'template' | 'data' = 'data', opts?: ListReadOptions & { listQuery?: Record<string, unknown> }) {
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
      // What the list shows (its search, filters, scope and sort), or the whole register, newest first.
      let items: Contract[];
      if (opts?.listQuery) {
        const listed = (await this.list(opts.listQuery, { ...opts, exportAll: true })).items as Array<{ id: string }>;
        const byId = new Map((listed.length ? await repo.find({ where: { tenant_id: sessionTenant(), id: In(listed.map((row) => row.id)) } }) : []).map((row) => [row.id, row]));
        items = listed.map((row) => byId.get(row.id)!).filter(Boolean);
      } else {
        items = await repo.find({ where: { tenant_id: sessionTenant() }, order: { created_at: 'DESC' as any, id: 'ASC' as any } });
      }
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
    let text: string;
    try {
      text = decodeCsv(buf).text;
    } catch (err) {
      if (err instanceof CsvDecodeError) throw new BadRequestException({ message: err.message, code: err.code });
      throw err;
    }
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
          const headerError = headerMismatchError(missing, extras);
          if (headerError) errors.push(headerError);
        })
        .on('error', (e) => reject(e))
        .on('data', (r) => out.push(denormalizeCsvRow(r)))
        .on('end', () => resolve(out));
    });
    if (!headerOk) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors };
    if (rows.length === 0) return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, unchanged: 0, errors: [{ row: 0, message: 'Empty CSV' }] };

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
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors };

    // Deduplicate by composite key name+supplier_name (first wins)
    const uniqMap = new Map<string, typeof norm[number]>();
    for (const item of norm) {
      const key = `${item.name}||${item.supplier_name}`.toLowerCase();
      if (!uniqMap.has(key)) uniqMap.set(key, item);
    }
    const unique = Array.from(uniqMap.values());

    // Determine inserts/updates by composite (name + supplier). A row identical to the stored
    // contract counts as unchanged and is not written: no audit line, no new `updated_at`.
    let inserted = 0; let updated = 0; let unchanged = 0;
    const toWrite: typeof unique = [];
    const now = new Date();
    const today = utcDateYmd(now);
    for (const item of unique) {
      const s = sByName.get(item.supplier_name);
      if (!s) { updated += 0; continue; }
      const exists = await repo.findOne({ where: { tenant_id: sessionTenant(), name: item.name as any, supplier_id: s.id as any } });
      if (!exists) inserted += 1;
      else if (importRowUnchanged(exists, {
        company_id: cByName.get(item.company_name)?.id,
        owner_user_id: item.owner_email ? uByEmail.get(item.owner_email.toLowerCase())?.id : null,
        start_date: item.start_date,
        duration_months: item.duration_months,
        auto_renewal: item.auto_renewal,
        notice_period_months: item.notice_period_months,
        yearly_amount_at_signature: item.yearly_amount_at_signature,
        currency: item.currency,
        billing_frequency: item.billing_frequency,
        notes: item.notes ?? null,
      }, item.status ?? null, now)) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push(item);
      // The update would be refused (`update`): said for the row, dry run included.
      if (exists && turnsOffRenewalOfRenewedContract(exists, { ...exists, start_date: item.start_date as any, duration_months: item.duration_months, auto_renewal: item.auto_renewal }, today)) {
        errors.push({ row: norm.indexOf(item) + 2, message: `auto_renewal: ${RENEWED_CONTRACT_RENEWAL_OFF}` });
      }
    }
    if (errors.length > 0) return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, unchanged: 0, errors };
    if (dryRun) return { ok: true, dryRun: true, total: rows.length, inserted, updated, unchanged, errors: [] };

    // Commit
    let processed = 0;
    for (const item of toWrite) {
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
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, unchanged, processed, errors: [] };
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

  // Symmetric linking from CAPEX side: the CAPEX lines share `contract_spend_items` since lot Z1.
  async listContractsForCapexItem(capexItemId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const linksRepo = mg.getRepository(ContractSpendItem);
    const contractRepo = mg.getRepository(Contract);
    // The contracts of a CAPEX line only (`spend/budget-nature.ts`): none for a line of another nature.
    const [line] = await mg.query(
      `SELECT 1 FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1 AND nature = 'capex'`,
      [capexItemId],
    );
    if (!line) return { items: [] };
    const rows = await linksRepo.find({ where: { tenant_id: sessionTenant(), spend_item_id: capexItemId } });
    const ids = rows.map((r) => r.contract_id);
    const items = ids.length ? await contractRepo.findBy({ tenant_id: sessionTenant(), id: In(ids) }) : [];
    return { items: items.map((i) => ({ id: i.id, name: i.name })) };
  }

  async bulkReplaceContractsForCapexItem(capexItemId: string, contractIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const linksRepo = mg.getRepository(ContractSpendItem);
    const [capex]: Array<{ id: string; tenant_id: string }> = await mg.query(
      `SELECT id, tenant_id FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1 AND nature = 'capex'`,
      [capexItemId],
    );
    if (!capex) throw new NotFoundException('CAPEX item not found.');
    const tenantId = capex.tenant_id;
    const uniqueIds = Array.from(new Set((contractIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'contracts', tenantId, uniqueIds, 'One or more contracts not found.');
    const existing = await linksRepo.find({ where: { tenant_id: tenantId, spend_item_id: capex.id } });
    const toDelete = existing.filter((e) => !uniqueIds.includes(e.contract_id));
    const existingSet = new Set(existing.map((e) => e.contract_id));
    const toInsert = uniqueIds
      .filter((id) => !existingSet.has(id))
      .map((id) => linksRepo.create({ tenant_id: tenantId, contract_id: id, spend_item_id: capex.id }));
    if (toDelete.length > 0) await linksRepo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await linksRepo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Inverse links from Contract side: the contract's CAPEX lines, their title as `description`.
  async listLinkedCapexItems(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const items: Array<{ id: string; description: string }> = await mg.query(
      `SELECT i.id, i.product_name AS description
         FROM contract_spend_items l
         JOIN spend_items i ON i.tenant_id = l.tenant_id AND i.id = l.spend_item_id AND i.nature = 'capex'
        WHERE l.tenant_id = app_current_tenant() AND l.contract_id = $1`,
      [contractId],
    );
    return { items };
  }

  async bulkReplaceLinkedCapexItems(contractId: string, capexItemIds: string[], opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(ContractSpendItem);
    const contract = await this.findContract(contractId, mg);
    const tenantId = contract.tenant_id;
    const uniqueIds = Array.from(new Set((capexItemIds || []).filter(Boolean)));
    await this.assertIdsInTenant(mg, 'capex', tenantId, uniqueIds, 'One or more CAPEX items not found.');
    // The contract's links to CAPEX lines only: a link to an OPEX line is kept as it is.
    const existing: Array<{ id: string; spend_item_id: string }> = await mg.query(
      `SELECT l.id, l.spend_item_id FROM contract_spend_items l WHERE l.tenant_id = $1 AND l.contract_id = $2${CAPEX_LINK}`,
      [tenantId, contract.id],
    );
    const toDelete = existing.filter((e) => !uniqueIds.includes(e.spend_item_id));
    const existingSet = new Set(existing.map((e) => e.spend_item_id));
    const toInsert = uniqueIds.filter((id) => !existingSet.has(id)).map((id) => repo.create({ tenant_id: tenantId, contract_id: contract.id, spend_item_id: id }));
    if (toDelete.length > 0) await repo.delete({ tenant_id: tenantId, id: In(toDelete.map((e) => e.id)) });
    if (toInsert.length > 0) await repo.save(toInsert);
    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // Relations from the contract's side (`contract-relations.ts`): budget lines of both natures,
  // applications, assets, and the counts of the page's tabs.
  async listBudgetLines(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return listContractBudgetLines(mg, await this.findContract(contractId, mg));
  }

  /**
   * The Budget tab's figures for a year and column (`year`, `column`): the amount of each linked
   * budget line in that year and column, as the budget list shows it, and for each year the
   * selector offers, the commitment, the linked lines' sum, the gap and the state
   * (`contract-budget.ts`). Amounts in the reporting currency; the commitment also in the
   * contract's currency. Needs the right to read the budget.
   */
  async budgetCoverage(contractId: string, query: any, opts?: ListReadOptions) {
    const mg = opts?.manager ?? this.repo.manager;
    if (!opts?.budgetAccess) throw new ForbiddenException('Reading the budget figures of a contract needs access to the budget.');
    const contract = await this.findContract(contractId, mg);
    const currentYear = contractBudgetCurrentYear();
    const selection = parseContractBudgetSelection(query, currentYear, { year: 'year', column: 'column' });
    if (!selection) throw new BadRequestException('year and column are required.');
    const years = await contractBudgetYears(mg, contract.tenant_id, currentYear, selection.year);
    const inputs = await loadContractBudgetInputs({ fxRates: this.fxRates }, mg, contract.tenant_id, years, selection.column, [contract.id]);
    const rows = await readContractBudgetRows(mg, inputs);
    const { items } = await listContractBudgetLines(mg, contract);
    return {
      year: selection.year,
      column: selection.column,
      reporting_currency: inputs.reportingCurrency,
      currency: String(contract.currency || 'EUR').trim().toUpperCase() || 'EUR',
      lines: items.map((line) => {
        const cents = inputs.lineAmounts.get(line.id)?.get(selection.year) ?? 0n;
        return { id: line.id, amount: centsToNumber(cents) };
      }),
      years: rows.map(({ contract_id: _contract, ...row }) => row),
    };
  }

  async listApplications(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return listContractApplications(mg, await this.findContract(contractId, mg));
  }

  async listAssets(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return listContractAssets(mg, await this.findContract(contractId, mg));
  }

  async replaceRelations(contractId: string, set: ContractRelationSet, ids: string[], userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const contract = await this.findContract(contractId, mg);
    return replaceContractRelations({ manager: mg, audit: this.audit }, set, contract, ids, userId ?? null);
  }

  /** The Compliance tab: every requirement, whether it is expected and why, and what was recorded (`contract-compliance.ts`). */
  async compliance(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const contract = await this.findContract(contractId, mg);
    return contractComplianceView(mg, await loadContractComplianceInputs(mg), contract);
  }

  /** Records the state and / or reference of one requirement, then answers the tab as `compliance` does. */
  async updateCompliance(contractId: string, requirement: string, body: ComplianceItemPatch, userId?: string | null, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    const contract = await this.findContract(contractId, mg);
    await updateContractComplianceItem({ manager: mg, audit: this.audit }, contract, requirement, body, userId ?? null);
    return contractComplianceView(mg, await loadContractComplianceInputs(mg), contract);
  }

  /**
   * The compliance register (CSV) of the contracts a list request selects (search, filters, status
   * scope), by name: one line per contract and requirement (`complianceRegisterCsv`).
   */
  async exportComplianceRegister(query: any, language: CsvLanguage, opts?: ListReadOptions) {
    const mg = opts?.manager ?? this.repo.manager;
    // The list's budget filters apply too, for a reader of the budget (as on the list).
    const budget = await this.listBudgetInputs(mg, query, opts);
    const compliance = await loadContractComplianceInputs(mg);
    const windowDays = await readDecisionWindowDays(mg);
    const { qb } = this.listQuery(mg, query, { windowDays, exportAll: true, budget, compliance });
    const contracts: Array<{ id: string; name: string; supplier_name: string | null; company_name: string | null }> = await qb
      .select('c.id', 'id')
      .addSelect('c.name', 'name')
      .addSelect('sup.name', 'supplier_name')
      .addSelect('comp.name', 'company_name')
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .getRawMany();
    const content = await complianceRegisterCsv(mg, compliance, contracts, language);
    return { filename: 'contract-compliance-register.csv', content };
  }

  async relationCounts(contractId: string, opts?: { manager?: EntityManager }) {
    const mg = opts?.manager ?? this.repo.manager;
    return contractRelationCounts(mg, await this.findContract(contractId, mg));
  }

  /**
   * Send a link to the contract (`notifications.notifyShare`), like the other objects' "Send link":
   * to people of the tenant who can sign in, and to plain email addresses. A contract of another
   * tenant is not found.
   */
  async shareContract(contractId: string, dto: ShareItemDto, userId: string, opts?: { manager?: EntityManager }) {
    const { userIds, rawEmails } = shareRecipientsOf(dto);
    const mg = opts?.manager ?? this.repo.manager;
    const contract = await this.findContract(contractId, mg);
    const tenantId = contract.tenant_id;
    const senderRows: Array<{ first_name: string | null; last_name: string | null }> = await mg.query(
      'SELECT first_name, last_name FROM users WHERE tenant_id = $1 AND id = $2',
      [tenantId, userId],
    );
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name || ''} ${senderRows[0].last_name || ''}`.trim() || 'Someone'
      : 'Someone';
    const validIds = userIds.filter((id) => isUuid(String(id)));
    const recipients = validIds.length > 0
      ? await mg.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
             FROM users u
             JOIN roles ro ON ro.id = u.role_id
            WHERE u.tenant_id = $1 AND u.id = ANY($2::uuid[]) AND u.status = 'enabled'
              AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [tenantId, validIds],
        )
      : [];
    if (recipients.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: 'contract',
        itemId: contract.id,
        itemName: contract.name,
        senderName,
        message: dto.message,
        recipients,
        rawEmails,
        tenantId,
        // No request manager: the send outlives the request (a contract link needs no lookup).
      });
    }
    return { ok: true };
  }
}

import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, In } from 'typeorm';
import { SpendVersion } from './spend-version.entity';
import { SpendAmount } from './spend-amount.entity';
import { SpendItem } from './spend-item.entity';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import { CompanyMetric } from '../companies/company-metric.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';
import { AllocationCalculatorService, AllocationComputation } from './allocation-calculator.service';
import { FxRateService, FxLookupKey, FxResolvedRate } from '../currency/fx-rate.service';
import { BUDGET_COLUMN_MEASURE, BudgetColumn } from './amounts-write.util';
import { DEFAULT_BUDGET_COLUMNS, readBudgetColumns } from '../budget-columns/budget-columns.util';

/** A chargeback runs on one budget column, named by its API name. */
export type ChargebackMetricKey = BudgetColumn;

type ResolvedAllocationMethod = AllocationComputation['resolvedMethod'];

const METRIC_COLUMN_MAP: Record<ChargebackMetricKey, keyof SpendAmount> = BUDGET_COLUMN_MEASURE;

function isMetric(value: unknown): value is ChargebackMetricKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(METRIC_COLUMN_MAP, value);
}

function invalidMetric(value: unknown): BadRequestException {
  return new BadRequestException(`Unknown column '${String(value)}'. Use ${Object.keys(METRIC_COLUMN_MAP).join(', ')}.`);
}

const ALLOCATION_METHOD_LABELS: Record<ResolvedAllocationMethod, string> = {
  headcount: 'Headcount',
  it_users: 'IT users',
  turnover: 'Turnover',
  manual_company: 'Manual (company)',
  manual_department: 'Manual (department)',
  manual_pct: 'Manual (%)',
};

function toCurrency(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

type ChargebackComputationContext = {
  year: number;
  metric: ChargebackMetricKey;
  totalRaw: number;
  total: number;
  companyTotalsRaw: Map<string, number>;
  companyTotals: Map<string, number>;
  paidTotalsRaw: Map<string, number>;
  paidTotals: Map<string, number>;
  companyDepartmentTotals: Map<string, Map<string | null, number>>;
  companyDepartmentTotalsRaw: Map<string, Map<string | null, number>>;
  versionCompanyTotals: Map<string, Map<string, number>>;
  versionCompanyTotalsRaw: Map<string, Map<string, number>>;
  intercompanyRaw: Map<string, Map<string, number>>; // payer -> consumer -> raw
  intercompany: Map<string, Map<string, number>>;     // payer -> consumer -> converted
  companyById: Map<string, Company>;
  departmentById: Map<string, Department>;
  companyMetrics: Map<string, CompanyMetric>;
  departmentMetrics: Map<string, DepartmentMetric>;
  versionMeta: Map<string, { version: SpendVersion; item?: SpendItem; method: ResolvedAllocationMethod }>;
  reportingCurrency: string;
  fxByVersion: Map<string, FxResolvedRate>;
  warnings: string[];
};

export type CompanyChargebackDepartmentRow = {
  departmentId: string | null;
  departmentName: string;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
  headcount: number | null;
  costPerUser: number | null;
};

export type CompanyChargebackItemRow = {
  versionId: string;
  itemId: string | null;
  itemName: string;
  allocationMethod: ResolvedAllocationMethod;
  allocationMethodLabel: string;
  amount: number;
  amountRaw: number;
  sharePct: number | null;
};

export type CompanyChargebackReportResponse = {
  year: number;
  metric: ChargebackMetricKey;
  total: number;
  totalRaw: number;
  company: {
    id: string;
    name: string;
    total: number;
    totalRaw: number;
    paid?: number;
    paidRaw?: number;
    net?: number;
    netRaw?: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerUserRaw: number | null;
    costPerItUser: number | null;
    costPerItUserRaw: number | null;
    costVsTurnoverPct: number | null;
  };
  departments: CompanyChargebackDepartmentRow[];
  items: CompanyChargebackItemRow[];
  itemsTotal: number;
  itemsTotalRaw: number;
  kpis: Array<{
    companyId: string;
    companyName: string;
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  }>;
  globalKpi: {
    amount: number;
    amountRaw: number;
    headcount: number | null;
    itUsers: number | null;
    turnover: number | null;
    turnoverRaw: number | null;
    costPerUser: number | null;
    costPerItUser: number | null;
    costVsTurnoverPct: number | null;
  };
  intercompany?: {
    receivables: Array<{ consumerId: string; consumerName: string; amount: number; amountRaw: number }>;
    payables: Array<{ payerId: string; payerName: string; amount: number; amountRaw: number }>;
  };
  reportingCurrency: string;
  warnings: string[];
};

@Injectable()
export class ChargebackReportService {
  constructor(
    @InjectRepository(SpendVersion) private readonly versionsRepo: Repository<SpendVersion>,
    private readonly allocationCalculator: AllocationCalculatorService,
    private readonly fxRates: FxRateService,
  ) {}

  /** The column a request names; none given is the tenant's default column. */
  async resolveMetric(raw: unknown, tenantId: string | null, opts?: { manager?: EntityManager }): Promise<ChargebackMetricKey> {
    if (raw === undefined || raw === null || raw === '') {
      const manager = opts?.manager ?? this.versionsRepo.manager;
      const settings = tenantId ? await readBudgetColumns(manager, tenantId) : DEFAULT_BUDGET_COLUMNS;
      return (Object.keys(METRIC_COLUMN_MAP) as ChargebackMetricKey[]).find((key) => METRIC_COLUMN_MAP[key] === settings.default_column)!;
    }
    if (!isMetric(raw)) throw invalidMetric(raw);
    return raw;
  }

  /** The report of the request's tenant (`tenantId` is `req.tenant.id`); every read is scoped to it. */
  async generateGlobal(
    year: number,
    metric: ChargebackMetricKey,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    const ctx = await this.computeBase(year, metric, tenantId, opts);

    const detailed: Array<{
      companyId: string;
      companyName: string;
      departmentId: string | null;
      departmentName: string | null;
      amount: number;
      amountRaw: number;
      headcount: number | null;
      costPerUser: number | null;
    }> = [];

    for (const [companyId, deptMap] of ctx.companyDepartmentTotals.entries()) {
      const company = ctx.companyById.get(companyId);
      const companyName = company?.name ?? 'Unknown company';
      const companyMetric = ctx.companyMetrics.get(companyId);
      const companyHeadcount = companyMetric != null && companyMetric.headcount != null ? Number(companyMetric.headcount) : null;
      const deptMapRaw = ctx.companyDepartmentTotalsRaw.get(companyId) ?? new Map<string | null, number>();
      for (const [departmentId, amount] of deptMap.entries()) {
        const amountRaw = deptMapRaw.get(departmentId) ?? 0;
        if (Math.abs(amount) < 0.0001 && Math.abs(amountRaw) < 0.0001) continue;
        const department = departmentId ? ctx.departmentById.get(departmentId) : undefined;
        let headcount: number | null = null;
        if (departmentId) {
          const deptMetric = ctx.departmentMetrics.get(departmentId);
          const deptHeadcount = deptMetric != null && deptMetric.headcount != null ? Number(deptMetric.headcount) : null;
          headcount = deptHeadcount && deptHeadcount > 0 ? deptHeadcount : null;
        } else if (companyHeadcount && companyHeadcount > 0) {
          headcount = companyHeadcount;
        }
        const costPerUser = headcount && headcount > 0 ? amount / headcount : null;
        detailed.push({
          companyId,
          companyName,
          departmentId,
          departmentName: departmentId ? (department?.name ?? 'Unknown department') : 'Common Costs',
          amount: toCurrency(amount),
          amountRaw,
          headcount,
          costPerUser: costPerUser != null ? toCurrency(costPerUser) : null,
        });
      }
    }

    detailed.sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      if (a.companyName !== b.companyName) return a.companyName.localeCompare(b.companyName);
      return (a.departmentName ?? 'Common Costs').localeCompare(b.departmentName ?? 'Common Costs');
    });

    const companies = Array.from(ctx.companyTotals.entries())
      .map(([companyId, amount]) => {
        const company = ctx.companyById.get(companyId);
        const amountRaw = ctx.companyTotalsRaw.get(companyId) ?? 0;
        const paid = ctx.paidTotals.get(companyId) ?? 0;
        const paidRaw = ctx.paidTotalsRaw.get(companyId) ?? 0;
        const net = amount - paid;
        return {
          companyId,
          companyName: company?.name ?? 'Unknown company',
          amount: toCurrency(amount),
          amountRaw,
          paid: toCurrency(paid),
          paidRaw,
          net: toCurrency(net),
          netRaw: amountRaw - paidRaw,
        };
      })
      .filter((row) => Math.abs(row.amount) > 0.0001)
      .sort((a, b) => (b.amount !== a.amount ? b.amount - a.amount : a.companyName.localeCompare(b.companyName)));

    const kpis = companies.map((row) => {
      const amount = ctx.companyTotals.get(row.companyId) ?? 0;
      const amountRaw = ctx.companyTotalsRaw.get(row.companyId) ?? 0;
      const metricRow = ctx.companyMetrics.get(row.companyId);
      const headcount = metricRow ? Number(metricRow.headcount ?? 0) : 0;
      const itUsers = metricRow && metricRow.it_users != null ? Number(metricRow.it_users) : null;
      const turnoverMillions = metricRow && metricRow.turnover != null ? Number(metricRow.turnover) : null;
      const turnoverAbsolute = turnoverMillions != null ? turnoverMillions * 1_000_000 : null;
      const perUser = headcount > 0 ? amount / headcount : null;
      const perItUser = itUsers && itUsers > 0 ? amount / itUsers : null;
      const vsTurnover = turnoverAbsolute && turnoverAbsolute !== 0 ? (amount / turnoverAbsolute) * 100 : null;
      return {
        companyId: row.companyId,
        companyName: row.companyName,
        amount: toCurrency(amount),
        amountRaw,
        headcount: headcount > 0 ? headcount : null,
        itUsers,
        turnover: turnoverAbsolute != null ? toCurrency(turnoverAbsolute) : null,
        turnoverRaw: turnoverAbsolute,
        costPerUser: perUser != null ? toCurrency(perUser) : null,
        costPerItUser: perItUser != null ? toCurrency(perItUser) : null,
        costVsTurnoverPct: vsTurnover != null ? Math.round(vsTurnover * 100) / 100 : null,
      };
    });

    // Build intercompany flows (gross) list for UI
    const flowRows: Array<{
      payerId: string;
      payerName: string;
      consumerId: string;
      consumerName: string;
      amount: number;
      amountRaw: number;
    }> = [];
    for (const [payerId, row] of ctx.intercompany.entries()) {
      const payer = ctx.companyById.get(payerId);
      const rowRaw = ctx.intercompanyRaw.get(payerId) ?? new Map<string, number>();
      for (const [consumerId, value] of row.entries()) {
        const raw = rowRaw.get(consumerId) ?? 0;
        if (Math.abs(value) < 0.0001 && Math.abs(raw) < 0.0001) continue;
        const consumer = ctx.companyById.get(consumerId);
        flowRows.push({
          payerId,
          payerName: payer?.name ?? 'Unknown company',
          consumerId,
          consumerName: consumer?.name ?? 'Unknown company',
          amount: toCurrency(value),
          amountRaw: raw,
        });
      }
    }

    return {
      year: ctx.year,
      metric: ctx.metric,
      total: toCurrency(ctx.total),
      totalRaw: toCurrency(ctx.totalRaw),
      detailed,
      companies,
      kpis,
      intercompanyFlows: flowRows,
      reportingCurrency: ctx.reportingCurrency,
      warnings: ctx.warnings,
    };
  }

  async generateCompany(
    year: number,
    metric: ChargebackMetricKey,
    companyId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<CompanyChargebackReportResponse> {
    if (!companyId) {
      throw new BadRequestException('companyId is required');
    }

    const ctx = await this.computeBase(year, metric, tenantId, opts);
    const manager = opts?.manager ?? this.versionsRepo.manager;

    let company = ctx.companyById.get(companyId);
    if (!company) {
      company = await manager.getRepository(Company).findOne({ where: { tenant_id: tenantId, id: companyId } as any }) ?? undefined;
      if (company) ctx.companyById.set(companyId, company);
    }

    const total = ctx.companyTotals.get(companyId) ?? 0; // consumed
    const totalRaw = ctx.companyTotalsRaw.get(companyId) ?? 0;
    const paid = ctx.paidTotals.get(companyId) ?? 0;
    const paidRaw = ctx.paidTotalsRaw.get(companyId) ?? 0;
    const net = total - paid;

    let companyMetric = ctx.companyMetrics.get(companyId);
    if (!companyMetric) {
      companyMetric = await manager.getRepository(CompanyMetric).findOne({ where: { tenant_id: tenantId, company_id: companyId, fiscal_year: ctx.year } as any }) ?? undefined;
      if (companyMetric) ctx.companyMetrics.set(companyId, companyMetric);
    }

    const headcount = companyMetric != null && companyMetric.headcount != null ? Number(companyMetric.headcount) : null;
    const itUsers = companyMetric != null && companyMetric.it_users != null ? Number(companyMetric.it_users) : null;
    const turnoverMillions = companyMetric != null && companyMetric.turnover != null ? Number(companyMetric.turnover) : null;
    const turnoverAbsolute = turnoverMillions != null ? turnoverMillions * 1_000_000 : null;

    const costPerUser = headcount && headcount > 0 ? total / headcount : null;
    const costPerUserRaw = headcount && headcount > 0 ? totalRaw / headcount : null;
    const costPerItUser = itUsers && itUsers > 0 ? total / itUsers : null;
    const costPerItUserRaw = itUsers && itUsers > 0 ? totalRaw / itUsers : null;
    const costVsTurnoverPctRaw = turnoverAbsolute && turnoverAbsolute !== 0 ? (total / turnoverAbsolute) * 100 : null;

    const companySummary = {
      id: company?.id ?? companyId,
      name: company?.name ?? 'Unknown company',
      total: toCurrency(total),
      totalRaw,
      paid: toCurrency(paid),
      paidRaw,
      net: toCurrency(net),
      netRaw: totalRaw - paidRaw,
      headcount: headcount && headcount > 0 ? headcount : null,
      itUsers: itUsers && itUsers > 0 ? itUsers : null,
      turnover: turnoverAbsolute != null ? toCurrency(turnoverAbsolute) : null,
      turnoverRaw: turnoverAbsolute,
      costPerUser: costPerUser != null ? toCurrency(costPerUser) : null,
      costPerUserRaw,
      costPerItUser: costPerItUser != null ? toCurrency(costPerItUser) : null,
      costPerItUserRaw,
      costVsTurnoverPct: costVsTurnoverPctRaw != null ? Math.round(costVsTurnoverPctRaw * 100) / 100 : null,
    };

    const deptMap = ctx.companyDepartmentTotals.get(companyId) ?? new Map<string | null, number>();
    const deptMapRaw = ctx.companyDepartmentTotalsRaw.get(companyId) ?? new Map<string | null, number>();
    const departments: CompanyChargebackDepartmentRow[] = [];
    for (const [departmentId, amount] of deptMap.entries()) {
      const amountRaw = deptMapRaw.get(departmentId) ?? 0;
      const department = departmentId ? ctx.departmentById.get(departmentId) : undefined;
      let localHeadcount: number | null = null;
      if (departmentId) {
        // computeBase already read the year's metrics of every department in the shares.
        const deptMetric = ctx.departmentMetrics.get(departmentId);
        localHeadcount = deptMetric != null && deptMetric.headcount != null ? Number(deptMetric.headcount) : null;
      } else if (headcount && headcount > 0) {
        localHeadcount = headcount;
      }
      const sharePct = total > 0 ? (amount / total) * 100 : null;
      const costPerUserDept = localHeadcount && localHeadcount > 0 ? amount / localHeadcount : null;
      departments.push({
        departmentId,
        departmentName: departmentId ? (department?.name ?? 'Unknown department') : 'Common Costs',
        amount: toCurrency(amount),
        amountRaw,
        sharePct: sharePct != null ? Math.round(sharePct * 100) / 100 : null,
        headcount: localHeadcount,
        costPerUser: costPerUserDept != null ? toCurrency(costPerUserDept) : null,
      });
    }

    departments.sort((a, b) => {
      if (Math.abs((b.amount ?? 0) - (a.amount ?? 0)) > 0.0001) return b.amount - a.amount;
      return a.departmentName.localeCompare(b.departmentName);
    });

    const items: CompanyChargebackItemRow[] = [];
    let itemsTotal = 0;
    let itemsTotalRaw = 0;
    for (const [versionId, companyMap] of ctx.versionCompanyTotals.entries()) {
      const companyMapRaw = ctx.versionCompanyTotalsRaw.get(versionId) ?? new Map<string, number>();
      const amount = companyMap.get(companyId) ?? 0;
      const amountRaw = companyMapRaw.get(companyId) ?? 0;
      if (Math.abs(amount) < 0.0001 && Math.abs(amountRaw) < 0.0001) continue;
      const meta = ctx.versionMeta.get(versionId);
      const method = meta?.method ?? 'headcount';
      const sharePct = total > 0 ? (amount / total) * 100 : null;
      const item = meta?.item;
      items.push({
        versionId,
        itemId: item?.id ?? null,
        itemName: item?.product_name ?? 'Unknown item',
        allocationMethod: method,
        allocationMethodLabel: ALLOCATION_METHOD_LABELS[method] ?? method,
        amount: toCurrency(amount),
        amountRaw,
        sharePct: sharePct != null ? Math.round(sharePct * 100) / 100 : null,
      });
      itemsTotal += amount;
      itemsTotalRaw += amountRaw;
    }

    items.sort((a, b) => {
      if (Math.abs((b.amount ?? 0) - (a.amount ?? 0)) > 0.0001) return b.amount - a.amount;
      return a.itemName.localeCompare(b.itemName);
    });

    const kpis = [
      {
        companyId: companySummary.id,
        companyName: companySummary.name,
        amount: companySummary.total,
        amountRaw: companySummary.totalRaw,
        headcount: headcount && headcount > 0 ? headcount : null,
        itUsers: itUsers && itUsers > 0 ? itUsers : null,
        turnover: companySummary.turnover,
        turnoverRaw: turnoverAbsolute,
        costPerUser: costPerUser != null ? toCurrency(costPerUser) : null,
        costPerItUser: costPerItUser != null ? toCurrency(costPerItUser) : null,
        costVsTurnoverPct: costVsTurnoverPctRaw != null ? Math.round(costVsTurnoverPctRaw * 100) / 100 : null,
      },
    ];

    let globalHeadcount = 0;
    let globalItUsers = 0;
    let globalTurnoverRaw = 0;
    for (const metricRow of ctx.companyMetrics.values()) {
      globalHeadcount += Number(metricRow.headcount ?? 0);
      if (metricRow.it_users != null) {
        globalItUsers += Number(metricRow.it_users);
      }
      if (metricRow.turnover != null) {
        globalTurnoverRaw += Number(metricRow.turnover) * 1_000_000;
      }
    }

    const globalCostPerUser = globalHeadcount > 0 ? ctx.total / globalHeadcount : null;
    const globalCostPerItUser = globalItUsers > 0 ? ctx.total / globalItUsers : null;
    const globalCostVsTurnoverPctRaw = globalTurnoverRaw > 0 ? (ctx.total / globalTurnoverRaw) * 100 : null;

    const globalKpi = {
      amount: toCurrency(ctx.total),
      amountRaw: ctx.totalRaw,
      headcount: globalHeadcount > 0 ? globalHeadcount : null,
      itUsers: globalItUsers > 0 ? globalItUsers : null,
      turnover: globalTurnoverRaw > 0 ? toCurrency(globalTurnoverRaw) : null,
      turnoverRaw: globalTurnoverRaw > 0 ? globalTurnoverRaw : null,
      costPerUser: globalCostPerUser != null ? toCurrency(globalCostPerUser) : null,
      costPerItUser: globalCostPerItUser != null ? toCurrency(globalCostPerItUser) : null,
      costVsTurnoverPct: globalCostVsTurnoverPctRaw != null ? Math.round(globalCostVsTurnoverPctRaw * 100) / 100 : null,
    };

    // Build company-centric intercompany flows lists
    const receivables: Array<{ consumerId: string; consumerName: string; amount: number; amountRaw: number }> = [];
    const payables: Array<{ payerId: string; payerName: string; amount: number; amountRaw: number }> = [];
    const payRow = ctx.intercompany.get(companyId) ?? new Map<string, number>();
    const payRowRaw = ctx.intercompanyRaw.get(companyId) ?? new Map<string, number>();
    for (const [consumerId, value] of payRow.entries()) {
      const raw = payRowRaw.get(consumerId) ?? 0;
      if (Math.abs(value) < 0.0001 && Math.abs(raw) < 0.0001) continue;
      const consumer = ctx.companyById.get(consumerId);
      receivables.push({ consumerId, consumerName: consumer?.name ?? 'Unknown company', amount: toCurrency(value), amountRaw: raw });
    }
    for (const [payerId, row] of ctx.intercompany.entries()) {
      if (payerId === companyId) continue;
      const amount = row.get(companyId) ?? 0;
      const raw = (ctx.intercompanyRaw.get(payerId) ?? new Map<string, number>()).get(companyId) ?? 0;
      if (Math.abs(amount) < 0.0001 && Math.abs(raw) < 0.0001) continue;
      const payer = ctx.companyById.get(payerId);
      payables.push({ payerId, payerName: payer?.name ?? 'Unknown company', amount: toCurrency(amount), amountRaw: raw });
    }

    return {
      year: ctx.year,
      metric: ctx.metric,
      total: companySummary.total,
      totalRaw,
      company: companySummary,
      departments,
      items,
      itemsTotal: toCurrency(itemsTotal),
      itemsTotalRaw,
      kpis,
      globalKpi,
      intercompany: {
        receivables,
        payables,
      },
      reportingCurrency: ctx.reportingCurrency,
      warnings: ctx.warnings,
    };
  }

  private async computeBase(
    year: number,
    metric: ChargebackMetricKey,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ): Promise<ChargebackComputationContext> {
    const yr = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
    if (!isMetric(metric)) throw invalidMetric(metric);
    if (!tenantId) throw new InternalServerErrorException('A chargeback report needs a tenant.');
    const metricColumn = METRIC_COLUMN_MAP[metric];

    const manager = opts?.manager ?? this.versionsRepo.manager;
    const versionRepo = manager.getRepository(SpendVersion);

    // Year-aware disabled filtering: include items throughout their disabled_at fiscal year.
    // If an item is disabled on 2025-06-30 and the report year is 2025, include it.
    // Exclude it for years strictly greater than disabled year. Fiscal year = calendar year.
    const periodStart = new Date(`${String(yr).padStart(4, '0')}-01-01T00:00:00.000Z`);
    const versions = await versionRepo
      .createQueryBuilder('v')
      .innerJoin(
        SpendItem,
        'item',
        `item.id = v.spend_item_id AND item.tenant_id = v.tenant_id AND (item.disabled_at IS NULL OR item.disabled_at >= :period_start)`,
      )
      .where('v.tenant_id = :tenantId', { tenantId })
      .andWhere('v.budget_year = :year', { year: yr })
      .setParameters({ period_start: periodStart })
      .select(['v.id AS id', 'v.spend_item_id AS spend_item_id'])
      .getRawMany<{ id: string; spend_item_id: string }>();

    if (versions.length === 0) {
      return {
        year: yr,
        metric,
        totalRaw: 0,
        total: 0,
        companyTotalsRaw: new Map(),
        companyTotals: new Map(),
        paidTotalsRaw: new Map(),
        paidTotals: new Map(),
        companyDepartmentTotals: new Map(),
        companyDepartmentTotalsRaw: new Map(),
        versionCompanyTotals: new Map(),
        versionCompanyTotalsRaw: new Map(),
        intercompanyRaw: new Map(),
        intercompany: new Map(),
        companyById: new Map(),
        departmentById: new Map(),
        companyMetrics: new Map(),
        departmentMetrics: new Map(),
        versionMeta: new Map(),
        reportingCurrency: 'EUR',
        fxByVersion: new Map(),
        warnings: [],
      };
    }

    const versionIds = versions.map((v) => v.id);
    const fullVersions = versionIds.length > 0
      ? await versionRepo.find({ where: { tenant_id: tenantId, id: In(versionIds) as any } as any })
      : [];

    const itemIds = Array.from(new Set(fullVersions.map((v) => v.spend_item_id)));
    const itemRepo = manager.getRepository(SpendItem);
    const itemEntities = itemIds.length > 0
      ? await itemRepo.find({ where: { tenant_id: tenantId, id: In(itemIds) as any } as any })
      : [];
    const itemById = new Map(itemEntities.map((item) => [item.id, item] as const));

    const lookupKeys: FxLookupKey[] = [];
    const versionCurrency = new Map<string, string>();
    for (const version of fullVersions) {
      const item = itemById.get(version.spend_item_id);
      const currency = (item?.currency || 'EUR').toString().toUpperCase();
      versionCurrency.set(version.id, currency);
      lookupKeys.push({
        key: '',
        rateSetId: version.fx_rate_set_id ?? null,
        fiscalYear: version.budget_year,
        sourceCurrency: currency,
      });
    }

    const fxResult = await this.fxRates.resolveRates(tenantId, lookupKeys, { manager });
    const reportingCurrency = fxResult.settings.reportingCurrency;
    const fxMap = fxResult.map;
    const fxByVersion = new Map<string, FxResolvedRate>();
    const getFx = (version: SpendVersion, currency: string): FxResolvedRate => {
      const upper = currency.toUpperCase();
      const key = `${version.fx_rate_set_id || 'live'}:${version.budget_year}:${upper}`;
      const found = fxMap.get(key);
      if (found) return found;
      return {
        rate: upper === reportingCurrency.toUpperCase() ? 1 : 1,
        rateSetId: null,
        fiscalYear: version.budget_year,
        reportingCurrency,
        source: upper === reportingCurrency.toUpperCase() ? 'identity' : 'missing',
        capturedAt: null,
      };
    };

    const amountsRepo = manager.getRepository(SpendAmount);
    const totalsRaw = await amountsRepo
      .createQueryBuilder('amount')
      .select('amount.version_id', 'version_id')
      .addSelect(`SUM(COALESCE(amount.${metricColumn}, 0))`, 'total')
      .where('amount.tenant_id = :tenantId', { tenantId })
      .andWhere('amount.version_id IN (:...ids)', { ids: versionIds })
      .andWhere('EXTRACT(YEAR FROM amount.period) = :year', { year: yr })
      .groupBy('amount.version_id')
      .getRawMany<{ version_id: string; total: string }>();

    const totalsByVersion = new Map<string, number>();
    for (const row of totalsRaw) {
      const total = Number(row.total ?? 0);
      if (!Number.isFinite(total)) continue;
      totalsByVersion.set(row.version_id, total);
    }

    const allocationData = await this.allocationCalculator.computeForVersions(fullVersions, { manager, tenantId, suppressErrors: true });

    const warningsSet = new Set<string>();
    const warnings: string[] = [];
    const recordWarning = (message: string) => {
      if (!message) return;
      if (warningsSet.has(message)) return;
      warningsSet.add(message);
      warnings.push(message);
    };

    const companyTotalsRaw = new Map<string, number>(); // consumed raw
    const companyTotals = new Map<string, number>();     // consumed converted
    const paidTotalsRaw = new Map<string, number>();
    const paidTotals = new Map<string, number>();
    const companyDepartmentTotalsRaw = new Map<string, Map<string | null, number>>();
    const companyDepartmentTotals = new Map<string, Map<string | null, number>>();
    const versionCompanyTotalsRaw = new Map<string, Map<string, number>>();
    const versionCompanyTotals = new Map<string, Map<string, number>>();
    const intercompanyRaw = new Map<string, Map<string, number>>();
    const intercompany = new Map<string, Map<string, number>>();
    const companyIds = new Set<string>();
    const departmentIds = new Set<string>();
    const versionMeta = new Map<string, { version: SpendVersion; item?: SpendItem; method: ResolvedAllocationMethod }>();

    for (const version of fullVersions) {
      const allocationInfo = allocationData.get(version.id);
      const fallbackMethod: ResolvedAllocationMethod =
        version.allocation_method === 'manual_company'
        || version.allocation_method === 'manual_department'
        || version.allocation_method === 'manual_pct'
          ? (version.allocation_method as ResolvedAllocationMethod)
          : 'headcount';
      const resolvedMethod = allocationInfo?.resolvedMethod ?? fallbackMethod;
      const item = itemById.get(version.spend_item_id);
      versionMeta.set(version.id, { version, item, method: resolvedMethod });

      const sourceCurrency = versionCurrency.get(version.id) ?? 'EUR';
      const fx = getFx(version, sourceCurrency);
      fxByVersion.set(version.id, fx);

      const shares = allocationInfo?.shares ?? [];
      if (allocationInfo?.error) {
        const itemLabel = item?.product_name?.trim() || item?.description?.trim() || version.spend_item_id;
        const verb = shares.length > 0 ? 'Used stored allocation for' : 'Skipped allocations for';
        recordWarning(`${verb} "${itemLabel}" (year ${version.budget_year}): ${allocationInfo.error}`);
      }
      const versionTotalRaw = totalsByVersion.get(version.id) ?? 0;
      if (Math.abs(versionTotalRaw) < 0.0001) continue;

      // Track paid totals for the paying company of the item version
      const payerId = (item as any)?.paying_company_id as string | null | undefined;
      if (!payerId) {
        const itemLabel = item?.product_name?.trim() || item?.description?.trim() || version.spend_item_id;
        recordWarning(`Missing paying company for "${itemLabel}" (year ${version.budget_year}). Paid totals excluded for this item.`);
      } else {
        companyIds.add(payerId);
        const paidConverted = this.fxRates.convertValue(versionTotalRaw, fx.rate);
        paidTotalsRaw.set(payerId, (paidTotalsRaw.get(payerId) ?? 0) + versionTotalRaw);
        paidTotals.set(payerId, (paidTotals.get(payerId) ?? 0) + paidConverted);
      }

      for (const share of shares) {
        const companyId = share.company_id;
        if (!companyId) continue;
        const pct = Number(share.allocation_pct ?? 0);
        if (!Number.isFinite(pct) || Math.abs(pct) < 0.0001) continue;
        const amountRaw = (versionTotalRaw * pct) / 100;
        if (Math.abs(amountRaw) < 0.0001) continue;
        const amount = this.fxRates.convertValue(amountRaw, fx.rate);

        const departmentId = share.department_id ?? null;
        companyIds.add(companyId);
        if (departmentId) departmentIds.add(departmentId);

        companyTotalsRaw.set(companyId, (companyTotalsRaw.get(companyId) ?? 0) + amountRaw);
        companyTotals.set(companyId, (companyTotals.get(companyId) ?? 0) + amount);

        let deptMapRaw = companyDepartmentTotalsRaw.get(companyId);
        if (!deptMapRaw) {
          deptMapRaw = new Map<string | null, number>();
          companyDepartmentTotalsRaw.set(companyId, deptMapRaw);
        }
        deptMapRaw.set(departmentId, (deptMapRaw.get(departmentId) ?? 0) + amountRaw);

        let deptMap = companyDepartmentTotals.get(companyId);
        if (!deptMap) {
          deptMap = new Map<string | null, number>();
          companyDepartmentTotals.set(companyId, deptMap);
        }
        deptMap.set(departmentId, (deptMap.get(departmentId) ?? 0) + amount);

        let versionMapRaw = versionCompanyTotalsRaw.get(version.id);
        if (!versionMapRaw) {
          versionMapRaw = new Map<string, number>();
          versionCompanyTotalsRaw.set(version.id, versionMapRaw);
        }
        versionMapRaw.set(companyId, (versionMapRaw.get(companyId) ?? 0) + amountRaw);

        let versionMap = versionCompanyTotals.get(version.id);
        if (!versionMap) {
          versionMap = new Map<string, number>();
          versionCompanyTotals.set(version.id, versionMap);
        }
        versionMap.set(companyId, (versionMap.get(companyId) ?? 0) + amount);

        // Intercompany flow (gross): payer -> consumer, exclude self-consumption
        if (payerId && payerId !== companyId) {
          let rowRaw = intercompanyRaw.get(payerId);
          if (!rowRaw) {
            rowRaw = new Map<string, number>();
            intercompanyRaw.set(payerId, rowRaw);
          }
          rowRaw.set(companyId, (rowRaw.get(companyId) ?? 0) + amountRaw);

          let row = intercompany.get(payerId);
          if (!row) {
            row = new Map<string, number>();
            intercompany.set(payerId, row);
          }
          row.set(companyId, (row.get(companyId) ?? 0) + amount);
        }
      }
    }

    const totalRaw = Array.from(companyTotalsRaw.values()).reduce((acc, value) => acc + value, 0);
    const total = Array.from(companyTotals.values()).reduce((acc, value) => acc + value, 0);

    const companyRepo = manager.getRepository(Company);
    const companies = companyIds.size > 0
      ? await companyRepo.find({ where: { tenant_id: tenantId, id: In([...companyIds]) } as any })
      : [];
    const companyById = new Map(companies.map((c) => [c.id, c] as const));

    const departmentRepo = manager.getRepository(Department);
    const departments = departmentIds.size > 0
      ? await departmentRepo.find({ where: { tenant_id: tenantId, id: In([...departmentIds]) } as any })
      : [];
    const departmentById = new Map(departments.map((d) => [d.id, d] as const));

    const metricsRepo = manager.getRepository(CompanyMetric);
    const metrics = companyIds.size > 0
      ? await metricsRepo.find({ where: { tenant_id: tenantId, company_id: In([...companyIds]) as any, fiscal_year: yr } as any })
      : [];
    const companyMetrics = new Map(metrics.map((m) => [m.company_id, m] as const));

    const deptMetricRepo = manager.getRepository(DepartmentMetric);
    const deptMetrics = departmentIds.size > 0
      ? await deptMetricRepo.find({ where: { tenant_id: tenantId, department_id: In([...departmentIds]) as any, fiscal_year: yr } as any })
      : [];
    const departmentMetrics = new Map(deptMetrics.map((m) => [m.department_id, m] as const));

    return {
      year: yr,
      metric,
      totalRaw,
      total,
      companyTotalsRaw,
      companyTotals,
      paidTotalsRaw,
      paidTotals,
      companyDepartmentTotals,
      companyDepartmentTotalsRaw,
      versionCompanyTotals,
      versionCompanyTotalsRaw,
      intercompanyRaw,
      intercompany,
      companyById,
      departmentById,
      companyMetrics,
      departmentMetrics,
      versionMeta,
      reportingCurrency,
      fxByVersion,
      warnings,
    };
  }
}

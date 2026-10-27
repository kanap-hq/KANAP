import type { CsvLanguage } from '../common/csv-sheet/types';
import type { ReportCell, ReportColumn, ReportExport, ReportTable } from '../common/report-export';
import type { ChargebackScope, CompanyChargebackReportResponse } from './chargeback-report.service';
import type {
  ChargebackKpiTotals,
  ChargebackNettedFlow,
  GlobalChargebackDetailedRow,
} from './chargeback-report.tables';

/**
 * The table exports of the chargeback reports (`GET reports/chargeback/global/export` and
 * `GET reports/chargeback/company/export`), built from the same service call as the screens and from
 * the rows it returns (`chargeback-report.tables.ts`): amounts in the reporting currency to the cent,
 * shares as percent cells, headcounts as numbers, the screens' words in the request language.
 *
 * Global: `detailed` (each company's total row, then its departments), `companies`, `flows` (netted)
 * and `kpis` (their totals as footer). Company: `departments`, `items` (payer, allocation and
 * departments for a person under data-scoped access, as the screen), `intercompany` (total as footer)
 * and `kpis` (the group's totals as footer, none for a limited person). A limited person's file has
 * no footer at all (`writeReportExport`).
 */

export const GLOBAL_CHARGEBACK_TABLES = ['detailed', 'companies', 'flows', 'kpis'] as const;
export const COMPANY_CHARGEBACK_TABLES = ['departments', 'items', 'intercompany', 'kpis'] as const;

/** Where each label comes from in `frontend/src/locales/<lang>/ops.json` (checked by a spec). */
export const CHARGEBACK_EXPORT_KEYS = {
  company: 'reports.columns.company',
  department: 'reports.columns.department',
  metricAmount: 'reports.columns.metricAmount',
  shareOfTotal: 'reports.columns.shareOfTotal',
  headcount: 'reports.columns.headcount',
  costPerUser: 'reports.columns.costPerUser',
  paidBooked: 'reports.columns.paidBooked',
  netConsumedPaid: 'reports.columns.netConsumedPaid',
  payer: 'reports.columns.payer',
  consumer: 'reports.columns.consumer',
  itUsers: 'reports.columns.itUsers',
  turnover: 'reports.columns.turnover',
  itCostsVsTurnover: 'reports.columns.itCostsVsTurnover',
  itCostsPerUser: 'reports.columns.itCostsPerUser',
  itCostsPerItUser: 'reports.columns.itCostsPerItUser',
  item: 'reports.columns.item',
  allocationMethod: 'reports.columns.allocationMethod',
  allocationPct: 'reports.columns.allocationPct',
  receivables: 'reports.columns.receivables',
  payables: 'reports.columns.payables',
  net: 'reports.columns.net',
  rowTotal: 'reports.columns.total',
  kpiTotal: 'shared.total',
  globalTotals: 'reports.companyChargeback.globalTotals',
  commonCosts: 'reports.globalChargeback.commonCosts',
  unknownDepartment: 'reports.shared.unknownDepartment',
  unknownCompany: 'reports.shared.unknownCompany',
  detailedSheet: 'reports.globalChargeback.detailedTitle',
  companiesSheet: 'reports.globalChargeback.companyTotalsTitle',
  flowsSheet: 'reports.globalChargeback.flowsTitle',
  kpisSheet: 'reports.globalChargeback.kpisTitle',
  departmentsSheet: 'reports.companyChargeback.departmentTotals',
  itemsSheet: 'reports.companyChargeback.chargebackItems',
  intercompanySheet: 'reports.companyChargeback.flowsTitle',
  scope: 'operations.scope.label',
  scope_opex: 'operations.scope.opex',
  scope_capex: 'operations.scope.capex',
  scope_all: 'operations.scope.all',
  year: 'reports.filters.year',
  column: 'reports.filters.column',
  companyFilter: 'reports.filters.company',
  reportingCurrency: 'operations.currency.reportingCurrency',
  method_headcount: 'opex.allocations.headcount',
  method_it_users: 'opex.allocations.itUsers',
  method_turnover: 'opex.allocations.turnover',
  method_manual_company: 'opex.allocations.manualByCompany',
  method_manual_department: 'opex.allocations.manualByDepartment',
  method_manual_pct: 'opex.allocations.manualByPct',
  method_default: 'reports.shared.allocationMethodDefault',
} as const;

export type ChargebackExportLabels = Record<keyof typeof CHARGEBACK_EXPORT_KEYS, string>;

export const CHARGEBACK_EXPORT_LABELS: Record<CsvLanguage, ChargebackExportLabels> = {
  en: {
    company: 'Company',
    department: 'Department',
    metricAmount: '{{metric}} amount',
    shareOfTotal: 'Share of total',
    headcount: 'Headcount',
    costPerUser: 'Cost per user',
    paidBooked: 'Paid (booked)',
    netConsumedPaid: 'Net (consumed - paid)',
    payer: 'Payer',
    consumer: 'Consumer',
    itUsers: 'IT users',
    turnover: 'Turnover',
    itCostsVsTurnover: 'IT costs vs turnover',
    itCostsPerUser: 'IT costs per user',
    itCostsPerItUser: 'IT costs per IT user',
    item: 'Line',
    allocationMethod: 'Allocation method',
    allocationPct: 'Allocation',
    receivables: 'Receivables',
    payables: 'Payables',
    net: 'Net',
    rowTotal: 'Total',
    kpiTotal: 'Total',
    globalTotals: 'Global totals',
    commonCosts: 'Common costs',
    unknownDepartment: 'Unknown department',
    unknownCompany: 'Unknown company',
    detailedSheet: 'Detailed allocations',
    companiesSheet: 'Global company totals',
    flowsSheet: 'Intercompany flows',
    kpisSheet: 'Chargeback KPIs',
    departmentsSheet: 'Department totals',
    itemsSheet: 'Chargeback lines',
    intercompanySheet: 'Intercompany flows',
    scope: 'Line type',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    scope_all: 'All',
    year: 'Year',
    column: 'Column',
    companyFilter: 'Company',
    reportingCurrency: 'Reporting currency',
    method_headcount: 'Headcount',
    method_it_users: 'IT users',
    method_turnover: 'Turnover',
    method_manual_company: 'Manual by company',
    method_manual_department: 'Manual by department',
    method_manual_pct: 'Manual percentages',
    method_default: 'Default',
  },
  fr: {
    company: 'Société',
    department: 'Département',
    metricAmount: 'Montant {{metric}}',
    shareOfTotal: 'Part du total',
    headcount: 'Effectif',
    costPerUser: 'Coût par utilisateur',
    paidBooked: 'Payé (comptabilisé)',
    netConsumedPaid: 'Net (consommé - payé)',
    payer: 'Payeur',
    consumer: 'Consommateur',
    itUsers: 'Utilisateurs IT',
    turnover: "Chiffre d'affaires",
    itCostsVsTurnover: "Coûts IT vs chiffre d'affaires",
    itCostsPerUser: 'Coûts IT par utilisateur',
    itCostsPerItUser: 'Coûts IT par utilisateur IT',
    item: 'Ligne',
    allocationMethod: 'Méthode de ventilation',
    allocationPct: 'Ventilation',
    receivables: 'Créances',
    payables: 'Dettes',
    net: 'Net',
    rowTotal: 'Total',
    kpiTotal: 'Total',
    globalTotals: 'Totaux globaux',
    commonCosts: 'Coûts communs',
    unknownDepartment: 'Département inconnu',
    unknownCompany: 'Société inconnue',
    detailedSheet: 'Ventilations détaillées',
    companiesSheet: 'Totaux globaux par société',
    flowsSheet: 'Flux interentreprises',
    kpisSheet: 'KPI de refacturation',
    departmentsSheet: 'Totaux par département',
    itemsSheet: 'Lignes de refacturation',
    intercompanySheet: 'Flux interentreprises',
    scope: 'Type de ligne',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    scope_all: 'Tout',
    year: 'Année',
    column: 'Colonne',
    companyFilter: 'Société',
    reportingCurrency: 'Devise de reporting',
    method_headcount: 'Effectif',
    method_it_users: 'Utilisateurs IT',
    method_turnover: "Chiffre d'affaires",
    method_manual_company: 'Manuel par société',
    method_manual_department: 'Manuel par département',
    method_manual_pct: 'Pourcentages manuels',
    method_default: 'Par défaut',
  },
  de: {
    company: 'Unternehmen',
    department: 'Abteilung',
    metricAmount: 'Betrag {{metric}}',
    shareOfTotal: 'Anteil am Gesamt',
    headcount: 'Mitarbeiterzahl',
    costPerUser: 'Kosten pro Benutzer',
    paidBooked: 'Bezahlt (gebucht)',
    netConsumedPaid: 'Netto (verbraucht - bezahlt)',
    payer: 'Zahler',
    consumer: 'Verbraucher',
    itUsers: 'IT-Benutzer',
    turnover: 'Umsatz',
    itCostsVsTurnover: 'IT-Kosten vs. Umsatz',
    itCostsPerUser: 'IT-Kosten pro Benutzer',
    itCostsPerItUser: 'IT-Kosten pro IT-Benutzer',
    item: 'Zeile',
    allocationMethod: 'Zuordnungsmethode',
    allocationPct: 'Zuordnung',
    receivables: 'Forderungen',
    payables: 'Verbindlichkeiten',
    net: 'Netto',
    rowTotal: 'Gesamt',
    kpiTotal: 'Gesamt',
    globalTotals: 'Globale Totale',
    commonCosts: 'Gemeinkosten',
    unknownDepartment: 'Unbekannte Abteilung',
    unknownCompany: 'Unbekanntes Unternehmen',
    detailedSheet: 'Detaillierte Zuordnungen',
    companiesSheet: 'Globale Unternehmenstotale',
    flowsSheet: 'Unternehmensübergreifende Flüsse',
    kpisSheet: 'KPIs der Leistungsverrechnung',
    departmentsSheet: 'Abteilungstotale',
    itemsSheet: 'Leistungsverrechnungszeilen',
    intercompanySheet: 'Unternehmensübergreifende Flüsse',
    scope: 'Zeilentyp',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    scope_all: 'Alle',
    year: 'Jahr',
    column: 'Spalte',
    companyFilter: 'Unternehmen',
    reportingCurrency: 'Reporting-Währung',
    method_headcount: 'Mitarbeiterzahl',
    method_it_users: 'IT-Benutzer',
    method_turnover: 'Umsatz',
    method_manual_company: 'Manuell nach Unternehmen',
    method_manual_department: 'Manuell nach Abteilung',
    method_manual_pct: 'Manuelle Prozentsätze',
    method_default: 'Standard',
  },
  es: {
    company: 'Empresa',
    department: 'Departamento',
    metricAmount: 'Importe {{metric}}',
    shareOfTotal: 'Participación del total',
    headcount: 'Plantilla',
    costPerUser: 'Coste por usuario',
    paidBooked: 'Pagado (contabilizado)',
    netConsumedPaid: 'Neto (consumido - pagado)',
    payer: 'Pagador',
    consumer: 'Consumidor',
    itUsers: 'Usuarios IT',
    turnover: 'Facturación',
    itCostsVsTurnover: 'Costes IT vs. facturación',
    itCostsPerUser: 'Costes IT por usuario',
    itCostsPerItUser: 'Costes IT por usuario IT',
    item: 'Línea',
    allocationMethod: 'Método de asignación',
    allocationPct: 'Asignación',
    receivables: 'Cuentas por cobrar',
    payables: 'Cuentas por pagar',
    net: 'Neto',
    rowTotal: 'Total',
    kpiTotal: 'Total',
    globalTotals: 'Totales globales',
    commonCosts: 'Costes comunes',
    unknownDepartment: 'Departamento desconocido',
    unknownCompany: 'Empresa desconocida',
    detailedSheet: 'Asignaciones detalladas',
    companiesSheet: 'Totales globales por empresa',
    flowsSheet: 'Flujos interempresariales',
    kpisSheet: 'KPI de contracargo',
    departmentsSheet: 'Totales por departamento',
    itemsSheet: 'Líneas de contracargo',
    intercompanySheet: 'Flujos interempresariales',
    scope: 'Tipo de línea',
    scope_opex: 'OPEX',
    scope_capex: 'CAPEX',
    scope_all: 'Todo',
    year: 'Año',
    column: 'Columna',
    companyFilter: 'Empresa',
    reportingCurrency: 'Moneda de reporting',
    method_headcount: 'Plantilla',
    method_it_users: 'Usuarios IT',
    method_turnover: 'Facturación',
    method_manual_company: 'Manual por empresa',
    method_manual_department: 'Manual por departamento',
    method_manual_pct: 'Porcentajes manuales',
    method_default: 'Por defecto',
  },
};

/** An amount cell to the cent; null stays empty. */
function amount(value: number | null | undefined): ReportCell {
  if (value == null || !Number.isFinite(value)) return null;
  return { kind: 'amount', value: (Math.round(value * 100) / 100).toFixed(2) };
}

function number(value: number | null | undefined): ReportCell {
  return value == null || !Number.isFinite(value) ? null : { kind: 'number', value };
}

function percent(fraction: number | null | undefined): ReportCell {
  return fraction == null || !Number.isFinite(fraction) ? null : { kind: 'percent', value: fraction };
}

/** A share sent in points (`sharePct`, `costVsTurnoverPct`), as a percent cell. */
function points(value: number | null | undefined): ReportCell {
  // Twelve significant digits: 44.44 points is 0.4444, not 0.44439999999999996.
  return value == null || !Number.isFinite(value) ? null : { kind: 'percent', value: Number((value / 100).toPrecision(12)) };
}

/** The screen's department cell: no department is common costs, an id without a name a missing department. */
export function chargebackDepartmentLabel(labels: ChargebackExportLabels, departmentId: string | null, departmentName: string | null): string {
  if (departmentId == null) return labels.commonCosts;
  return departmentName?.trim() || labels.unknownDepartment;
}

/** The screen's allocation method label; an unknown code is written as is. */
export function chargebackMethodLabel(labels: ChargebackExportLabels, method: string | null | undefined): string {
  const key = `method_${method}` as keyof ChargebackExportLabels;
  return method && key in labels ? labels[key] : method ?? '';
}

const amountHeader = (labels: ChargebackExportLabels, columnName: string) => labels.metricAmount.replace('{{metric}}', columnName);

type KpiRow = {
  companyName: string;
  amount: number;
  headcount: number | null;
  itUsers: number | null;
  turnover: number | null;
  costVsTurnoverPct: number | null;
  costPerUser: number | null;
  costPerItUser: number | null;
};

function kpiTable(labels: ChargebackExportLabels, columnName: string, rows: readonly KpiRow[], footer: ReportCell[] | null): ReportTable {
  const columns: ReportColumn[] = [
    { header: labels.company, kind: 'text' },
    { header: columnName, kind: 'amount' },
    { header: labels.headcount, kind: 'number' },
    { header: labels.itUsers, kind: 'number' },
    { header: labels.turnover, kind: 'amount' },
    { header: labels.itCostsVsTurnover, kind: 'percent' },
    { header: labels.itCostsPerUser, kind: 'amount' },
    { header: labels.itCostsPerItUser, kind: 'amount' },
  ];
  return {
    key: 'kpis',
    sheet: labels.kpisSheet,
    columns,
    rows: rows.map((row) => [
      row.companyName,
      amount(row.amount),
      number(row.headcount),
      number(row.itUsers),
      amount(row.turnover),
      points(row.costVsTurnoverPct),
      amount(row.costPerUser),
      amount(row.costPerItUser),
    ]),
    footer: footer ? [footer] : [],
  };
}

function parameters(
  labels: ChargebackExportLabels,
  scope: ChargebackScope,
  year: number,
  columnName: string,
  reportingCurrency: string,
  companyName?: string,
): Array<[string, string]> {
  return [
    [labels.scope, labels[`scope_${scope}`]],
    [labels.year, String(year)],
    [labels.column, columnName],
    ...(companyName !== undefined ? [[labels.companyFilter, companyName] as [string, string]] : []),
    [labels.reportingCurrency, reportingCurrency.toUpperCase()],
  ];
}

/** What the global export reads of `generateGlobal`'s result. */
export type GlobalChargebackExportInput = {
  year: number;
  scope: ChargebackScope;
  detailedRows: GlobalChargebackDetailedRow[];
  companies: Array<{ companyName: string; amount: number; paid: number; net: number; share: number | null }>;
  nettedFlows: ChargebackNettedFlow[];
  kpis: KpiRow[];
  kpiTotals: ChargebackKpiTotals | null;
  reportingCurrency: string;
};

export function globalChargebackExport(
  report: GlobalChargebackExportInput,
  options: { language: CsvLanguage; columnName: string; limited: boolean },
): ReportExport {
  const labels = CHARGEBACK_EXPORT_LABELS[options.language];
  const metricAmount = amountHeader(labels, options.columnName);
  const totals = report.kpiTotals;
  return {
    fileBase: `chargeback-global-${report.scope}-${report.year}`,
    limited: options.limited,
    parameters: parameters(labels, report.scope, report.year, options.columnName, report.reportingCurrency),
    tables: [
      {
        key: 'detailed',
        sheet: labels.detailedSheet,
        columns: [
          { header: labels.company, kind: 'text' },
          { header: labels.department, kind: 'text' },
          { header: metricAmount, kind: 'amount' },
          { header: labels.shareOfTotal, kind: 'percent' },
          { header: labels.headcount, kind: 'number' },
          { header: labels.costPerUser, kind: 'amount' },
        ],
        // The company on every row, so a filter on it keeps its departments.
        rows: report.detailedRows.map((row) => [
          row.companyName,
          row.rowType === 'company' ? labels.rowTotal : chargebackDepartmentLabel(labels, row.departmentId, row.departmentName),
          amount(row.amount),
          percent(row.share),
          number(row.headcount),
          amount(row.costPerUser),
        ]),
      },
      {
        key: 'companies',
        sheet: labels.companiesSheet,
        columns: [
          { header: labels.company, kind: 'text' },
          { header: metricAmount, kind: 'amount' },
          { header: labels.paidBooked, kind: 'amount' },
          { header: labels.netConsumedPaid, kind: 'amount' },
          { header: labels.shareOfTotal, kind: 'percent' },
        ],
        rows: report.companies.map((row) => [row.companyName, amount(row.amount), amount(row.paid), amount(row.net), percent(row.share)]),
      },
      {
        key: 'flows',
        sheet: labels.flowsSheet,
        columns: [
          { header: labels.payer, kind: 'text' },
          { header: labels.consumer, kind: 'text' },
          { header: metricAmount, kind: 'amount' },
        ],
        rows: report.nettedFlows.map((row) => [
          row.payerName || labels.unknownCompany,
          row.consumerName || labels.unknownCompany,
          amount(row.amount),
        ]),
      },
      kpiTable(labels, options.columnName, report.kpis, totals && report.kpis.length > 0 ? [
        labels.kpiTotal,
        amount(totals.amount),
        number(totals.headcount),
        number(totals.itUsers),
        totals.turnover > 0 ? amount(totals.turnover) : null,
        points(totals.costVsTurnoverPct),
        amount(totals.costPerUser),
        amount(totals.costPerItUser),
      ] : null),
    ],
  };
}

export function companyChargebackExport(
  report: CompanyChargebackReportResponse,
  options: { language: CsvLanguage; columnName: string },
): ReportExport {
  const labels = CHARGEBACK_EXPORT_LABELS[options.language];
  const metricAmount = amountHeader(labels, options.columnName);
  const limited = report.dataAccessLimited === true;
  const global = report.globalKpi;
  const intercompanyTotal = report.intercompanyTotal;
  const itemColumns: ReportColumn[] = [
    { header: labels.item, kind: 'text' },
    ...(limited ? [{ header: labels.payer, kind: 'text' } as ReportColumn] : []),
    { header: labels.allocationMethod, kind: 'text' },
    ...(limited ? [{ header: labels.allocationPct, kind: 'percent' }, { header: labels.department, kind: 'text' }] as ReportColumn[] : []),
    { header: metricAmount, kind: 'amount' },
    { header: labels.shareOfTotal, kind: 'percent' },
  ];
  return {
    fileBase: `chargeback-company-${report.scope}-${report.year}`,
    limited,
    parameters: parameters(labels, report.scope, report.year, options.columnName, report.reportingCurrency, report.company.name),
    tables: [
      {
        key: 'departments',
        sheet: labels.departmentsSheet,
        columns: [
          { header: labels.department, kind: 'text' },
          { header: metricAmount, kind: 'amount' },
          { header: labels.shareOfTotal, kind: 'percent' },
          { header: labels.headcount, kind: 'number' },
          { header: labels.costPerUser, kind: 'amount' },
        ],
        rows: report.departments.map((row) => [
          chargebackDepartmentLabel(labels, row.departmentId, row.departmentName),
          amount(row.amount),
          points(row.sharePct),
          number(row.headcount),
          amount(row.costPerUser),
        ]),
      },
      {
        key: 'items',
        sheet: labels.itemsSheet,
        columns: itemColumns,
        rows: report.items.map((row) => [
          row.itemLabel,
          ...(limited ? [row.payingCompanyName ?? null] : []),
          chargebackMethodLabel(labels, row.allocationMethod),
          ...(limited ? [
            points(row.allocationPct),
            (row.departments ?? []).map((name) => (name?.trim() ? name : labels.unknownDepartment)).join(', '),
          ] : []),
          amount(row.amount),
          points(row.sharePct),
        ]),
        footer: report.items.length === 0 ? [] : [[
          labels.rowTotal,
          ...(limited ? [null] : []),
          null,
          ...(limited ? [null, null] : []),
          amount(report.itemsTotal),
          percent(report.itemsTotalShare),
        ]],
      },
      {
        key: 'intercompany',
        sheet: labels.intercompanySheet,
        columns: [
          { header: labels.company, kind: 'text' },
          { header: labels.receivables, kind: 'amount' },
          { header: labels.payables, kind: 'amount' },
          { header: labels.net, kind: 'amount' },
        ],
        rows: report.intercompanyRows.map((row) => [
          row.partnerName || labels.unknownCompany,
          amount(row.receivables),
          amount(row.payables),
          amount(row.net),
        ]),
        footer: intercompanyTotal
          ? [[labels.rowTotal, amount(intercompanyTotal.receivables), amount(intercompanyTotal.payables), amount(intercompanyTotal.net)]]
          : [],
      },
      kpiTable(labels, options.columnName, report.kpis, global && report.kpis.length > 0 ? [
        labels.globalTotals,
        amount(global.amount),
        number(global.headcount),
        number(global.itUsers),
        amount(global.turnover),
        points(global.costVsTurnoverPct),
        amount(global.costPerUser),
        amount(global.costPerItUser),
      ] : null),
    ],
  };
}

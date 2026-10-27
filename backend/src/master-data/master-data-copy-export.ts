import { BadRequestException } from '@nestjs/common';
import type { CsvLanguage } from '../common/csv-sheet/types';
import type { TenantRequest } from '../common/decorators/tenant.decorator';
import {
  reportExportRequest,
  writeReportExport,
  type ReportCell,
  type ReportExportFile,
} from '../common/report-export';
import type { MasterDataOperationsService } from './master-data-operations.service';
import { masterDataCopyName, masterDataCopyStatus } from './shared/masterDataCopyRows';

/**
 * The table export of "Copy yearly metrics" (`GET /master-data-operations/copy/export`): the preview of the
 * screen's parameters, the dry run the page calls (`copyMasterData` with `dryRun`), one row per company or
 * department and metric in the dry run's order. Values as numbers, the words of the screen through the
 * rule both share (`shared/masterDataCopyRows.ts`). The route is reserved to unscoped persons, as the copy.
 */

/** Where each label comes from in `frontend/src/locales/<lang>/master-data.json`. */
export const MASTER_DATA_COPY_EXPORT_KEYS = {
  sheet: 'admin.copy.dataPreview',
  type: 'admin.copy.columns.type',
  name: 'admin.copy.columns.name',
  metric: 'admin.copy.columns.metric',
  sourceValue: 'admin.copy.columns.sourceValue',
  currentDestination: 'admin.copy.columns.currentDestination',
  newValue: 'admin.copy.columns.newValue',
  status: 'admin.copy.columns.status',
  metric_headcount: 'admin.copy.metrics.headcount',
  metric_it_users: 'admin.copy.metrics.itUsers',
  metric_turnover: 'admin.copy.metrics.turnover',
  entity_company: 'admin.copy.entityTypes.company',
  entity_department: 'admin.copy.entityTypes.department',
  status_readyToCopy: 'admin.copy.status.readyToCopy',
  status_noDataForSourceYear: 'admin.copy.status.noDataForSourceYear',
  status_failedToCopyMetrics: 'admin.copy.status.failedToCopyMetrics',
  status_skipped: 'admin.copy.status.skipped',
  sourceYear: 'admin.copy.sourceYear',
  destinationYear: 'admin.copy.destinationYear',
  dataSources: 'admin.copy.dataSources',
  companyMetrics: 'admin.copy.companyMetrics',
  scope_companies: 'admin.freeze.scopeCompanies',
  scope_departments: 'admin.freeze.scopeDepartments',
} as const;

/** The names of a nameless company or department, from `frontend/src/locales/<lang>/ops.json`. */
export const MASTER_DATA_COPY_EXPORT_OPS_KEYS = {
  unknownCompany: 'reports.shared.unknownCompany',
  unknownDepartment: 'reports.shared.unknownDepartment',
} as const;

export type MasterDataCopyExportLabels = Record<keyof typeof MASTER_DATA_COPY_EXPORT_KEYS | keyof typeof MASTER_DATA_COPY_EXPORT_OPS_KEYS, string>;

export const MASTER_DATA_COPY_EXPORT_LABELS: Record<CsvLanguage, MasterDataCopyExportLabels> = {
  en: {
    sheet: 'Data preview',
    type: 'Type',
    name: 'Name',
    metric: 'Metric',
    sourceValue: 'Source value',
    currentDestination: 'Current destination',
    newValue: 'New value',
    status: 'Status',
    metric_headcount: 'Headcount',
    metric_it_users: 'IT users',
    metric_turnover: 'Turnover',
    entity_company: 'Company',
    entity_department: 'Department',
    status_readyToCopy: 'Ready to copy',
    status_noDataForSourceYear: 'No data for source year',
    status_failedToCopyMetrics: 'Failed to copy metrics',
    status_skipped: 'Skipped',
    sourceYear: 'Source year',
    destinationYear: 'Destination year',
    dataSources: 'Data sources',
    companyMetrics: 'Company metrics',
    scope_companies: 'Companies',
    scope_departments: 'Departments',
    unknownCompany: 'Unknown company',
    unknownDepartment: 'Unknown department',
  },
  fr: {
    sheet: 'Aperçu des données',
    type: 'Type',
    name: 'Nom',
    metric: 'Indicateur',
    sourceValue: 'Valeur source',
    currentDestination: 'Destination actuelle',
    newValue: 'Nouvelle valeur',
    status: 'Statut',
    metric_headcount: 'Effectif',
    metric_it_users: 'Utilisateurs IT',
    metric_turnover: 'Chiffre d\'affaires',
    entity_company: 'Société',
    entity_department: 'Département',
    status_readyToCopy: 'Prêt à copier',
    status_noDataForSourceYear: 'Aucune donnée pour l\'année source',
    status_failedToCopyMetrics: 'Échec de la copie des indicateurs',
    status_skipped: 'Ignoré',
    sourceYear: 'Année source',
    destinationYear: 'Année de destination',
    dataSources: 'Sources de données',
    companyMetrics: 'Indicateurs de la société',
    scope_companies: 'Sociétés',
    scope_departments: 'Départements',
    unknownCompany: 'Société inconnue',
    unknownDepartment: 'Département inconnu',
  },
  de: {
    sheet: 'Datenvorschau',
    type: 'Typ',
    name: 'Name',
    metric: 'Kennzahl',
    sourceValue: 'Quellwert',
    currentDestination: 'Aktuelles Ziel',
    newValue: 'Neuer Wert',
    status: 'Status',
    metric_headcount: 'Mitarbeiterzahl',
    metric_it_users: 'IT-Benutzer',
    metric_turnover: 'Umsatz',
    entity_company: 'Unternehmen',
    entity_department: 'Abteilung',
    status_readyToCopy: 'Bereit zum Kopieren',
    status_noDataForSourceYear: 'Keine Daten für das Quelljahr',
    status_failedToCopyMetrics: 'Die Kennzahlen konnten nicht kopiert werden',
    status_skipped: 'Übersprungen',
    sourceYear: 'Quelljahr',
    destinationYear: 'Zieljahr',
    dataSources: 'Datenquellen',
    companyMetrics: 'Unternehmenskennzahlen',
    scope_companies: 'Unternehmen',
    scope_departments: 'Abteilungen',
    unknownCompany: 'Unbekanntes Unternehmen',
    unknownDepartment: 'Unbekannte Abteilung',
  },
  es: {
    sheet: 'Vista previa de datos',
    type: 'Tipo',
    name: 'Nombre',
    metric: 'Indicador',
    sourceValue: 'Valor de origen',
    currentDestination: 'Destino actual',
    newValue: 'Nuevo valor',
    status: 'Estado',
    metric_headcount: 'Plantilla',
    metric_it_users: 'Usuarios IT',
    metric_turnover: 'Facturación',
    entity_company: 'Empresa',
    entity_department: 'Departamento',
    status_readyToCopy: 'Listo para copiar',
    status_noDataForSourceYear: 'No hay datos para el año de origen',
    status_failedToCopyMetrics: 'No se pudieron copiar los indicadores',
    status_skipped: 'Omitido',
    sourceYear: 'Año de origen',
    destinationYear: 'Año de destino',
    dataSources: 'Fuentes de datos',
    companyMetrics: 'Indicadores de la empresa',
    scope_companies: 'Empresas',
    scope_departments: 'Departamentos',
    unknownCompany: 'Empresa desconocida',
    unknownDepartment: 'Departamento desconocido',
  },
};

const COPY_KEYS = ['sourceYear', 'destinationYear', 'includeCompanies', 'includeDepartments', 'companyMetrics'];
const METRICS = ['headcount', 'it_users', 'turnover'] as const;

type Ctx = Pick<TenantRequest, 'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'>;

function yearOf(query: Record<string, unknown>, key: string): number {
  const value = typeof query[key] === 'string' ? (query[key] as string).trim() : '';
  if (!/^\d{4}$/.test(value)) throw new BadRequestException(`${key} must be a year.`);
  return Number(value);
}

function flagOf(query: Record<string, unknown>, key: string): boolean {
  const value = query[key];
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException(`${key} must be true or false.`);
}

/** The preview of the copy the screen shows for the same parameters, as a file. */
export async function masterDataCopyExport(
  svc: Pick<MasterDataOperationsService, 'copyMasterData'>,
  query: Record<string, unknown> | null | undefined,
  ctx: Ctx,
): Promise<ReportExportFile> {
  const manager = ctx.manager;
  if (!manager) throw new Error('A tenant-bound EntityManager is required');
  const source = query ?? {};
  const request = await reportExportRequest(source, { manager, tenantId: ctx.tenantId, userId: ctx.userId }, COPY_KEYS);
  const sourceYear = yearOf(source, 'sourceYear');
  const destinationYear = yearOf(source, 'destinationYear');
  const includeCompanies = flagOf(source, 'includeCompanies');
  const includeDepartments = flagOf(source, 'includeDepartments');
  const companyMetrics = typeof source.companyMetrics === 'string'
    ? source.companyMetrics.split(',').map((metric) => metric.trim()).filter(Boolean)
    : [];
  // The dry run checks the rest as for the screen: a source, the metrics, the person's rights, the freeze.
  const preview = await svc.copyMasterData({
    sourceYear,
    destinationYear,
    includeCompanies,
    includeDepartments,
    companyMetrics,
    dryRun: true,
    userId: ctx.userId || null,
    access: { isAdmin: ctx.isAdmin, permissions: ctx.permissions },
  }, { manager });

  const labels = MASTER_DATA_COPY_EXPORT_LABELS[request.language];
  const metricLabel = (metric: string) => ((METRICS as readonly string[]).includes(metric) ? labels[`metric_${metric as (typeof METRICS)[number]}`] : metric);
  const value = (number: number | null): ReportCell => (number == null ? null : { kind: 'number', value: Number(number) });
  const rows = preview.results.map((row): ReportCell[] => [
    labels[`entity_${row.entityType}`],
    masterDataCopyName(row, labels),
    metricLabel(row.metric),
    value(row.sourceValue),
    value(row.destinationValue),
    value(row.newValue),
    labels[`status_${masterDataCopyStatus(row)}`],
  ]);
  const scopes = [...(includeCompanies ? [labels.scope_companies] : []), ...(includeDepartments ? [labels.scope_departments] : [])];
  return writeReportExport({
    fileBase: `master-data-copy-${sourceYear}-${destinationYear}`,
    limited: false,
    tables: [{
      key: 'rows',
      sheet: labels.sheet,
      columns: [
        { header: labels.type, kind: 'text' },
        { header: labels.name, kind: 'text' },
        { header: labels.metric, kind: 'text' },
        { header: labels.sourceValue, kind: 'number' },
        { header: labels.currentDestination, kind: 'number' },
        { header: labels.newValue, kind: 'number' },
        { header: labels.status, kind: 'text' },
      ],
      rows,
    }],
    parameters: [
      [labels.sourceYear, String(sourceYear)],
      [labels.destinationYear, String(destinationYear)],
      [labels.dataSources, scopes.join(', ')],
      ...(includeCompanies ? [[labels.companyMetrics, companyMetrics.map(metricLabel).join(', ')] as [string, string]] : []),
    ],
  }, request);
}

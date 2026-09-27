import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AccountsService } from '../../accounts/accounts.service';
import { ChartOfAccountsService } from '../../accounts/chart-of-accounts.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { AuditSourceOptions } from '../../audit/audit.service';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { CompaniesService } from '../../companies/companies.service';
import { ContactsService } from '../../contacts/contacts.service';
import { DepartmentMetricsService } from '../../departments/department-metrics.service';
import { DepartmentsService } from '../../departments/departments.service';
import { LocationsService } from '../../locations/locations.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto } from '../ai.types';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';

export const AI_MASTER_DATA_ENTITY_TYPES = [
  'companies',
  'departments',
  'suppliers',
  'contacts',
  'accounts',
  'chart_of_accounts',
  'analytics_categories',
  'business_processes',
  'locations',
] as const;

export type AiMasterDataEntityType = typeof AI_MASTER_DATA_ENTITY_TYPES[number];

export type AiCreateMasterDataRecordInput = {
  entity_type: AiMasterDataEntityType;
  fields: Record<string, unknown>;
};

export type AiUpdateMasterDataRecordInput = AiCreateMasterDataRecordInput & {
  ref: string;
};

type RelationTarget = AiMasterDataEntityType | 'users';
type FieldKind =
  | 'text'
  | 'upper2'
  | 'upper3'
  | 'boolean'
  | 'integer'
  | 'non_negative_integer'
  | 'non_negative_decimal'
  | 'status'
  | 'date'
  | 'enum'
  | 'relation';
type EnumCase = 'lower' | 'upper';
type FieldStorage = 'record' | 'company_metrics' | 'company_metric_year' | 'department_metrics' | 'department_metric_year';

type FieldConfig = {
  label: string;
  kind: FieldKind;
  storage?: FieldStorage;
  aliases?: readonly string[];
  nullable?: boolean;
  requiredOnCreate?: boolean;
  enumValues?: readonly string[];
  enumCase?: EnumCase;
  relationTarget?: RelationTarget;
};

type EntityConfig = {
  labelSingular: string;
  labelPlural: string;
  businessResource: string;
  fields: Record<string, FieldConfig>;
};

type ResolvedReference = {
  id: string;
  ref: string | null;
  label: string;
  row: Record<string, unknown>;
};

type NormalizedFields = {
  fields: Record<string, unknown>;
  displayValues: Record<string, string | null>;
  fieldLabels: Record<string, string>;
};

const ENTITY_CONFIG: Record<AiMasterDataEntityType, EntityConfig> = {
  companies: {
    labelSingular: 'company',
    labelPlural: 'companies',
    businessResource: 'companies',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      country_iso: { label: 'Country', kind: 'upper2', requiredOnCreate: true, aliases: ['country'] },
      city: { label: 'City', kind: 'text', requiredOnCreate: true },
      postal_code: { label: 'Postal Code', kind: 'text', nullable: true },
      address1: { label: 'Address 1', kind: 'text', nullable: true },
      address2: { label: 'Address 2', kind: 'text', nullable: true },
      reg_number: { label: 'Registration Number', kind: 'text', nullable: true },
      vat_number: { label: 'VAT Number', kind: 'text', nullable: true },
      state: { label: 'State', kind: 'text', nullable: true },
      base_currency: { label: 'Base Currency', kind: 'upper3', nullable: true, aliases: ['currency'] },
      notes: { label: 'Notes', kind: 'text', nullable: true },
      metrics_year: {
        label: 'Metrics Year',
        kind: 'integer',
        storage: 'company_metric_year',
        aliases: ['year', 'fiscal_year'],
      },
      headcount: {
        label: 'Headcount',
        kind: 'non_negative_integer',
        storage: 'company_metrics',
        aliases: ['headcount_year'],
      },
      it_users: {
        label: 'IT Users',
        kind: 'non_negative_integer',
        storage: 'company_metrics',
        nullable: true,
        aliases: ['it_users_year'],
      },
      turnover: {
        label: 'Turnover',
        kind: 'non_negative_decimal',
        storage: 'company_metrics',
        nullable: true,
        aliases: ['turnover_year'],
      },
      coa_id: {
        label: 'Chart of Accounts',
        kind: 'relation',
        nullable: true,
        relationTarget: 'chart_of_accounts',
        aliases: ['coa', 'chart_of_accounts', 'chart_of_accounts_id'],
      },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  departments: {
    labelSingular: 'department',
    labelPlural: 'departments',
    businessResource: 'departments',
    fields: {
      company_id: {
        label: 'Company',
        kind: 'relation',
        requiredOnCreate: true,
        relationTarget: 'companies',
        aliases: ['company'],
      },
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      description: { label: 'Description', kind: 'text', nullable: true },
      metrics_year: {
        label: 'Metrics Year',
        kind: 'integer',
        storage: 'department_metric_year',
        aliases: ['year', 'fiscal_year'],
      },
      headcount: {
        label: 'Headcount',
        kind: 'non_negative_integer',
        storage: 'department_metrics',
        aliases: ['headcount_year'],
      },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  suppliers: {
    labelSingular: 'supplier',
    labelPlural: 'suppliers',
    businessResource: 'suppliers',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      erp_supplier_id: { label: 'ERP Supplier ID', kind: 'text', nullable: true, aliases: ['erp_id'] },
      notes: { label: 'Notes', kind: 'text', nullable: true },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  contacts: {
    labelSingular: 'contact',
    labelPlural: 'contacts',
    businessResource: 'contacts',
    fields: {
      first_name: { label: 'First Name', kind: 'text', nullable: true },
      last_name: { label: 'Last Name', kind: 'text', nullable: true },
      job_title: { label: 'Job Title', kind: 'text', nullable: true },
      email: { label: 'Email', kind: 'text', requiredOnCreate: true },
      phone: { label: 'Phone', kind: 'text', nullable: true },
      mobile: { label: 'Mobile', kind: 'text', nullable: true },
      country: { label: 'Country', kind: 'upper2', nullable: true },
      notes: { label: 'Notes', kind: 'text', nullable: true },
      active: { label: 'Active', kind: 'boolean' },
      supplier_id: {
        label: 'Supplier',
        kind: 'relation',
        nullable: true,
        relationTarget: 'suppliers',
        aliases: ['supplier'],
      },
      supplier_role: {
        label: 'Supplier Role',
        kind: 'enum',
        nullable: true,
        enumValues: ['commercial', 'technical', 'support', 'other'],
        enumCase: 'lower',
      },
    },
  },
  accounts: {
    labelSingular: 'account',
    labelPlural: 'accounts',
    businessResource: 'accounts',
    fields: {
      coa_id: {
        label: 'Chart of Accounts',
        kind: 'relation',
        requiredOnCreate: true,
        relationTarget: 'chart_of_accounts',
        aliases: ['coa', 'chart_of_accounts', 'chart_of_accounts_id'],
      },
      account_number: { label: 'Account Number', kind: 'text', requiredOnCreate: true, aliases: ['number'] },
      account_name: { label: 'Account Name', kind: 'text', requiredOnCreate: true, aliases: ['name'] },
      native_name: { label: 'Native Name', kind: 'text', nullable: true },
      description: { label: 'Description', kind: 'text', nullable: true },
      consolidation_account_number: { label: 'Consolidation Account Number', kind: 'integer', nullable: true },
      consolidation_account_name: { label: 'Consolidation Account Name', kind: 'text', nullable: true },
      consolidation_account_description: { label: 'Consolidation Account Description', kind: 'text', nullable: true },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  chart_of_accounts: {
    labelSingular: 'chart of accounts',
    labelPlural: 'charts of accounts',
    businessResource: 'accounts',
    fields: {
      code: { label: 'Code', kind: 'text', requiredOnCreate: true },
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      country_iso: { label: 'Country', kind: 'upper2', nullable: true, aliases: ['country'] },
      scope: { label: 'Scope', kind: 'enum', enumValues: ['GLOBAL', 'COUNTRY'], enumCase: 'upper' },
      is_default: { label: 'Default for Country', kind: 'boolean' },
    },
  },
  analytics_categories: {
    labelSingular: 'analytics category',
    labelPlural: 'analytics categories',
    businessResource: 'analytics',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      description: { label: 'Description', kind: 'text', nullable: true },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  business_processes: {
    labelSingular: 'business process',
    labelPlural: 'business processes',
    businessResource: 'business_processes',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      description: { label: 'Description', kind: 'text', nullable: true },
      notes: { label: 'Notes', kind: 'text', nullable: true },
      owner_user_id: {
        label: 'Owner',
        kind: 'relation',
        nullable: true,
        relationTarget: 'users',
        aliases: ['owner'],
      },
      it_owner_user_id: {
        label: 'IT Owner',
        kind: 'relation',
        nullable: true,
        relationTarget: 'users',
        aliases: ['it_owner', 'it_owner_user'],
      },
      status: { label: 'Status', kind: 'status' },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  locations: {
    labelSingular: 'location',
    labelPlural: 'locations',
    businessResource: 'locations',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      hosting_type: { label: 'Hosting Type', kind: 'text', requiredOnCreate: true },
      operating_company_id: {
        label: 'Operating Company',
        kind: 'relation',
        nullable: true,
        relationTarget: 'companies',
        aliases: ['operating_company', 'company'],
      },
      country_iso: { label: 'Country', kind: 'upper2', nullable: true, aliases: ['country'] },
      city: { label: 'City', kind: 'text', nullable: true },
      provider: { label: 'Provider', kind: 'text', nullable: true },
      region: { label: 'Region', kind: 'text', nullable: true },
      additional_info: { label: 'Additional Info', kind: 'text', nullable: true },
    },
  },
};

export const AI_MASTER_DATA_BUSINESS_RESOURCES = Array.from(
  new Set(AI_MASTER_DATA_ENTITY_TYPES.map((entityType) => ENTITY_CONFIG[entityType].businessResource)),
);

export function getAiMasterDataBusinessResource(entityType: unknown): string {
  const normalized = String(entityType || '').trim() as AiMasterDataEntityType;
  if (!AI_MASTER_DATA_ENTITY_TYPES.includes(normalized)) {
    throw new BadRequestException('Unsupported master data entity type.');
  }
  return ENTITY_CONFIG[normalized].businessResource;
}

function coerceRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeFieldKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function formatPlainValue(value: unknown, field?: FieldConfig): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field?.kind === 'status') {
    return String(value) === 'disabled' ? 'Disabled' : 'Enabled';
  }
  return String(value);
}

function toJsonScalar(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

function normalizeComparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function requireEntityType(value: unknown): AiMasterDataEntityType {
  const normalized = String(value || '').trim() as AiMasterDataEntityType;
  if (!AI_MASTER_DATA_ENTITY_TYPES.includes(normalized)) {
    throw new BadRequestException('Unsupported master data entity type.');
  }
  return normalized;
}

const COMPANY_METRIC_FIELDS = new Set(['headcount', 'it_users', 'turnover']);
const DEPARTMENT_METRIC_FIELDS = new Set(['headcount']);

@Injectable()
export class AiMasterDataMutationSupportService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly analyticsCategories: AnalyticsCategoriesService,
    private readonly businessProcesses: BusinessProcessesService,
    private readonly chartOfAccounts: ChartOfAccountsService,
    private readonly companies: CompaniesService,
    private readonly companyMetrics: CompanyMetricsService,
    private readonly contacts: ContactsService,
    private readonly departments: DepartmentsService,
    private readonly departmentMetrics: DepartmentMetricsService,
    private readonly locations: LocationsService,
    private readonly suppliers: SuppliersService,
    private readonly taskSupport: AiTaskMutationSupportService,
  ) {}

  getBusinessResource(entityType: unknown): string {
    return getAiMasterDataBusinessResource(entityType);
  }

  private getConfig(entityType: AiMasterDataEntityType): EntityConfig {
    return ENTITY_CONFIG[entityType];
  }

  private getFieldConfig(entityType: AiMasterDataEntityType, rawField: string): { name: string; config: FieldConfig } | null {
    const normalized = normalizeFieldKey(rawField);
    const fields = this.getConfig(entityType).fields;
    if (fields[normalized]) {
      return { name: normalized, config: fields[normalized] };
    }
    for (const [name, config] of Object.entries(fields)) {
      if ((config.aliases || []).some((alias) => normalizeFieldKey(alias) === normalized)) {
        return { name, config };
      }
    }
    return null;
  }

  private splitStoredMutationFields(
    entityType: AiMasterDataEntityType,
    fields: Record<string, unknown>,
  ): {
    recordFields: Record<string, unknown>;
    metricFields: Record<string, unknown>;
    metricYear: number | null;
  } {
    const recordFields: Record<string, unknown> = {};
    const metricFields: Record<string, unknown> = {};
    let metricYear: number | null = null;

    for (const [fieldName, value] of Object.entries(fields)) {
      const field = this.getConfig(entityType).fields[fieldName];
      if (entityType === 'companies' && field?.storage === 'company_metric_year') {
        metricYear = Number(value);
        continue;
      }
      if (entityType === 'companies' && field?.storage === 'company_metrics') {
        metricFields[fieldName] = value;
        continue;
      }
      if (entityType === 'departments' && field?.storage === 'department_metric_year') {
        metricYear = Number(value);
        continue;
      }
      if (entityType === 'departments' && field?.storage === 'department_metrics') {
        metricFields[fieldName] = value;
        continue;
      }
      recordFields[fieldName] = value;
    }

    return { recordFields, metricFields, metricYear };
  }

  private hasMetricFields(entityType: AiMasterDataEntityType, fields: Record<string, unknown>): boolean {
    if (entityType === 'companies') {
      return Object.keys(fields).some((fieldName) => COMPANY_METRIC_FIELDS.has(fieldName));
    }
    if (entityType === 'departments') {
      return Object.keys(fields).some((fieldName) => DEPARTMENT_METRIC_FIELDS.has(fieldName));
    }
    return false;
  }

  private validateMetricFieldSet(
    entityType: AiMasterDataEntityType,
    fields: Record<string, unknown>,
    mode: 'create' | 'update',
  ): void {
    if (entityType !== 'companies' && entityType !== 'departments') return;
    const { metricFields, metricYear } = this.splitStoredMutationFields(entityType, fields);
    const metricFieldNames = Object.keys(metricFields);
    const label = this.getConfig(entityType).labelSingular;
    if (metricFieldNames.length === 0 && metricYear != null) {
      throw new BadRequestException(`Metrics Year requires at least one ${label} metric field.`);
    }
    if (metricFieldNames.length === 0) {
      return;
    }
    if (metricYear == null) {
      throw new BadRequestException(`Metrics Year is required when writing ${label} metrics.`);
    }
    if (mode === 'create' && !Object.prototype.hasOwnProperty.call(metricFields, 'headcount')) {
      throw new BadRequestException(`Headcount is required when creating ${label} metrics.`);
    }
  }

  private async loadCompanyMetricSnapshot(
    context: AiExecutionContextWithManager,
    companyId: string,
    year: number,
  ): Promise<Record<string, unknown> | null> {
    const metric = await this.companyMetrics.getForCompany(companyId, year, { manager: context.manager });
    if (!metric) return null;
    return {
      headcount: Number((metric as any).headcount ?? 0),
      it_users: (metric as any).it_users == null ? null : Number((metric as any).it_users),
      turnover: (metric as any).turnover == null ? null : Number((metric as any).turnover),
    };
  }

  private async loadDepartmentMetricSnapshot(
    context: AiExecutionContextWithManager,
    departmentId: string,
    year: number,
  ): Promise<Record<string, unknown> | null> {
    const metric = await this.departmentMetrics.getForDepartment(departmentId, year, { manager: context.manager });
    if (!metric) return null;
    return {
      headcount: Number((metric as any).headcount ?? 0),
    };
  }

  private async loadMetricSnapshot(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    id: string,
    year: number,
  ): Promise<Record<string, unknown> | null> {
    if (entityType === 'companies') {
      return this.loadCompanyMetricSnapshot(context, id, year);
    }
    if (entityType === 'departments') {
      return this.loadDepartmentMetricSnapshot(context, id, year);
    }
    return null;
  }

  private normalizeNullableInput(value: unknown, field: FieldConfig): { empty: boolean; value: unknown } {
    if (value == null) {
      return { empty: true, value: null };
    }
    if (typeof value === 'string' && value.trim() === '') {
      return { empty: true, value: null };
    }
    return { empty: false, value };
  }

  private async normalizeFieldValue(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    fieldName: string,
    field: FieldConfig,
    rawValue: unknown,
  ): Promise<{ value: unknown; displayValue: string | null }> {
    const nullable = this.normalizeNullableInput(rawValue, field);
    if (nullable.empty) {
      if (field.nullable) {
        return { value: null, displayValue: null };
      }
      throw new BadRequestException(`${field.label} cannot be empty.`);
    }

    if (field.kind === 'relation') {
      const relation = await this.resolveRelation(context, field.relationTarget!, rawValue, field.label);
      if (!relation && !field.nullable) {
        throw new BadRequestException(`${field.label} cannot be empty.`);
      }
      return { value: relation?.id ?? null, displayValue: relation?.label ?? null };
    }

    if (field.kind === 'boolean') {
      return this.normalizeBoolean(rawValue, field);
    }

    if (field.kind === 'integer') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed)) {
        throw new BadRequestException(`${field.label} must be an integer.`);
      }
      if (fieldName === 'metrics_year' && (parsed < 1900 || parsed > 3000)) {
        throw new BadRequestException(`${field.label} must be between 1900 and 3000.`);
      }
      return { value: parsed, displayValue: String(parsed) };
    }

    if (field.kind === 'non_negative_integer') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new BadRequestException(`${field.label} must be a non-negative integer.`);
      }
      return { value: parsed, displayValue: String(parsed) };
    }

    if (field.kind === 'non_negative_decimal') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new BadRequestException(`${field.label} must be a non-negative number.`);
      }
      const decimals = (String(rawValue).split('.')[1] || '').length;
      if (decimals > 3) {
        throw new BadRequestException(`${field.label} allows at most 3 decimals.`);
      }
      return { value: parsed, displayValue: String(parsed) };
    }

    if (field.kind === 'status') {
      const normalized = String(rawValue).trim().toLowerCase();
      if (normalized !== 'enabled' && normalized !== 'disabled') {
        throw new BadRequestException(`${field.label} must be enabled or disabled.`);
      }
      return { value: normalized, displayValue: formatPlainValue(normalized, field) };
    }

    if (field.kind === 'date') {
      const text = String(rawValue).trim();
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`${field.label} must be a valid date or datetime.`);
      }
      return { value: text, displayValue: text };
    }

    if (field.kind === 'enum') {
      const normalized = field.enumCase === 'upper'
        ? String(rawValue).trim().toUpperCase()
        : String(rawValue).trim().toLowerCase();
      if (!(field.enumValues || []).includes(normalized)) {
        throw new BadRequestException(`${field.label} must be one of ${(field.enumValues || []).join(', ')}.`);
      }
      return { value: normalized, displayValue: normalized };
    }

    let text = String(rawValue).trim();
    if (field.kind === 'upper2' || field.kind === 'upper3') {
      text = text.toUpperCase();
      const length = field.kind === 'upper2' ? 2 : 3;
      if (text.length !== length) {
        throw new BadRequestException(`${field.label} must be ${length} letters.`);
      }
    }
    return { value: text, displayValue: text };
  }

  private normalizeBoolean(value: unknown, field: FieldConfig): { value: boolean; displayValue: string } {
    if (typeof value === 'boolean') {
      return { value, displayValue: value ? 'Yes' : 'No' };
    }
    const normalized = String(value).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) {
      return { value: true, displayValue: 'Yes' };
    }
    if (['false', 'no', 'n', '0'].includes(normalized)) {
      return { value: false, displayValue: 'No' };
    }
    throw new BadRequestException(`${field.label} must be true or false.`);
  }

  private async normalizeFields(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    rawFields: Record<string, unknown>,
    mode: 'create' | 'update',
  ): Promise<NormalizedFields> {
    const config = this.getConfig(entityType);
    const fields: Record<string, unknown> = {};
    const displayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};

    for (const [rawName, rawValue] of Object.entries(rawFields)) {
      if (rawValue === undefined) continue;
      const resolved = this.getFieldConfig(entityType, rawName);
      if (!resolved) {
        throw new BadRequestException(
          `${rawName} is not writable for ${config.labelPlural}. Writable fields: ${Object.keys(config.fields).join(', ')}.`,
        );
      }
      if (Object.prototype.hasOwnProperty.call(fields, resolved.name)) {
        throw new BadRequestException(`Field ${resolved.name} was provided more than once.`);
      }
      const normalized = await this.normalizeFieldValue(context, entityType, resolved.name, resolved.config, rawValue);
      fields[resolved.name] = normalized.value;
      displayValues[resolved.name] = normalized.displayValue;
      fieldLabels[resolved.name] = resolved.config.label;
    }

    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('At least one writable field is required.');
    }

    if (mode === 'create') {
      for (const [name, field] of Object.entries(config.fields)) {
        if (!field.requiredOnCreate) continue;
        const value = fields[name];
        if (value == null || value === '') {
          throw new BadRequestException(`${field.label} is required for ${config.labelSingular} creation.`);
        }
      }
      if (entityType === 'chart_of_accounts') {
        const scope = String(fields.scope || 'COUNTRY').toUpperCase();
        if (scope !== 'GLOBAL' && !fields.country_iso) {
          throw new BadRequestException('Country is required for country-scoped charts of accounts.');
        }
      }
    }

    if (entityType === 'contacts' && fields.supplier_role && !fields.supplier_id && mode === 'create') {
      throw new BadRequestException('Supplier Role requires Supplier.');
    }
    this.validateMetricFieldSet(entityType, fields, mode);

    return { fields, displayValues, fieldLabels };
  }

  private async resolveRelation(
    context: AiExecutionContextWithManager,
    target: RelationTarget,
    value: unknown,
    fieldLabel: string,
  ): Promise<ResolvedReference | null> {
    const normalized = textOrNull(value);
    if (!normalized) return null;
    if (target === 'users') {
      const user = isUuid(normalized)
        ? await this.resolveUserById(context, normalized)
        : await this.taskSupport.resolveUserReference(context, normalized);
      return { id: user.id, ref: user.email, label: user.label, row: user as any };
    }
    try {
      return await this.resolveRecordReference(context, target, normalized);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(`${fieldLabel} not found.`);
      }
      throw error;
    }
  }

  private async resolveUserById(context: AiExecutionContextWithManager, id: string) {
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
      [context.tenantId, id],
    );
    if (!rows[0]) {
      throw new NotFoundException('User not found.');
    }
    return {
      id: String(rows[0].id),
      email: textOrNull(rows[0].email),
      label: String(rows[0].label || rows[0].email || rows[0].id),
    };
  }

  private async resolveRecordReference(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    ref: string,
  ): Promise<ResolvedReference> {
    const normalized = textOrNull(ref);
    if (!normalized) {
      throw new BadRequestException('Record reference is required.');
    }
    if (isUuid(normalized)) {
      const row = await this.getRecordSnapshot(context, entityType, normalized);
      return this.referenceFromRow(entityType, row);
    }

    const rows = await this.queryReferenceCandidates(context.manager, context.tenantId, entityType, normalized);
    if (rows.length === 0) {
      throw new NotFoundException(`No ${this.getConfig(entityType).labelSingular} found matching "${normalized}".`);
    }
    if (rows.length > 1) {
      const labels = rows.map((row) => this.recordTitle(entityType, row)).join(', ');
      throw new BadRequestException(
        `Multiple ${this.getConfig(entityType).labelPlural} matched "${normalized}": ${labels}. Use a more specific reference.`,
      );
    }
    return this.referenceFromRow(entityType, rows[0]);
  }

  private async queryReferenceCandidates(
    manager: EntityManager,
    tenantId: string,
    entityType: AiMasterDataEntityType,
    ref: string,
  ): Promise<Record<string, unknown>[]> {
    switch (entityType) {
      case 'companies':
        return manager.query(
          `SELECT * FROM companies WHERE tenant_id = $1 AND LOWER(name) = LOWER($2::text) ORDER BY name LIMIT 6`,
          [tenantId, ref],
        );
      case 'departments':
        return manager.query(
          `
          SELECT d.*, c.name AS company_name
          FROM departments d
          LEFT JOIN companies c ON c.id = d.company_id AND c.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND LOWER(d.name) = LOWER($2::text)
          ORDER BY d.name
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'suppliers':
        return manager.query(
          `
          SELECT *
          FROM suppliers
          WHERE tenant_id = $1
            AND (LOWER(name) = LOWER($2::text) OR LOWER(COALESCE(erp_supplier_id, '')) = LOWER($2::text))
          ORDER BY name
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'contacts':
        return manager.query(
          `
          SELECT c.*, s.name AS supplier_name
          FROM contacts c
          LEFT JOIN suppliers s ON s.id = c.supplier_id AND s.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1
            AND (
              LOWER(c.email) = LOWER($2::text)
              OR LOWER(NULLIF(TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))), '')) = LOWER($2::text)
            )
          ORDER BY c.email
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'accounts':
        return manager.query(
          `
          SELECT a.*, coa.code AS coa_code
          FROM accounts a
          LEFT JOIN chart_of_accounts coa ON coa.id = a.coa_id AND coa.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1
            AND (
              a.account_number = $2::text
              OR LOWER(a.account_name) = LOWER($2::text)
              OR LOWER(CONCAT(a.account_number, ' - ', a.account_name)) = LOWER($2::text)
            )
          ORDER BY a.account_number, a.account_name
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'chart_of_accounts':
        return manager.query(
          `
          SELECT *
          FROM chart_of_accounts
          WHERE tenant_id = $1
            AND (LOWER(code) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(CONCAT(code, ' - ', name)) = LOWER($2::text))
          ORDER BY code
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'analytics_categories':
        // Names are unique per dimension: a name used in two dimensions is the "several matches" error.
        return manager.query(
          `
          SELECT c.*, a.name AS axis_name, a.is_default AS axis_is_default
          FROM analytics_categories c
          LEFT JOIN analytics_axes a ON a.id = c.axis_id AND a.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1 AND LOWER(c.name) = LOWER($2::text)
          ORDER BY a.is_default DESC, c.name
          LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'business_processes':
        return manager.query(
          `SELECT * FROM business_processes WHERE tenant_id = $1 AND LOWER(name) = LOWER($2::text) ORDER BY name LIMIT 6`,
          [tenantId, ref],
        );
      case 'locations':
        return manager.query(
          `
          SELECT *
          FROM locations
          WHERE tenant_id = $1
            AND (LOWER(location_reference) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(CONCAT(location_reference, ' - ', name)) = LOWER($2::text))
          ORDER BY location_reference
          LIMIT 6
          `,
          [tenantId, ref],
        );
    }
  }

  private async getRecordSnapshot(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    id: string,
  ): Promise<Record<string, unknown>> {
    switch (entityType) {
      case 'companies':
        return this.companies.get(id, { manager: context.manager }) as any;
      case 'departments':
        return this.departments.get(id, { manager: context.manager }) as any;
      case 'suppliers':
        return this.suppliers.get(id, { manager: context.manager }) as any;
      case 'contacts':
        return this.contacts.get(id, { manager: context.manager }) as any;
      case 'accounts':
        return this.accounts.get(id, { manager: context.manager }) as any;
      case 'chart_of_accounts':
        return this.chartOfAccounts.get(id, { manager: context.manager }) as any;
      case 'analytics_categories':
        return this.analyticsCategories.get(id, { manager: context.manager, tenantId: context.tenantId }) as any;
      case 'business_processes':
        return this.businessProcesses.get(id, { manager: context.manager }) as any;
      case 'locations':
        return this.locations.get(id, { manager: context.manager }) as any;
    }
  }

  private referenceFromRow(entityType: AiMasterDataEntityType, row: Record<string, unknown>): ResolvedReference {
    const id = String(row.id || '');
    if (!id) {
      throw new NotFoundException(`${this.getConfig(entityType).labelSingular} not found.`);
    }
    return {
      id,
      ref: this.recordRef(entityType, row),
      label: this.recordTitle(entityType, row),
      row,
    };
  }

  private recordRef(entityType: AiMasterDataEntityType, row: Record<string, unknown>): string | null {
    switch (entityType) {
      case 'accounts':
        return textOrNull(row.account_number);
      case 'chart_of_accounts':
        return textOrNull(row.code);
      case 'contacts':
        return textOrNull(row.email);
      case 'locations':
        return textOrNull(row.code);
      default:
        return null;
    }
  }

  private recordTitle(entityType: AiMasterDataEntityType, row: Record<string, unknown>): string {
    switch (entityType) {
      case 'accounts':
        return [row.account_number, row.account_name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled account';
      case 'chart_of_accounts':
        return [row.code, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled chart of accounts';
      case 'contacts': {
        const name = [row.first_name, row.last_name].map(textOrNull).filter(Boolean).join(' ').trim();
        return name || textOrNull(row.email) || 'Unknown contact';
      }
      case 'departments': {
        const name = textOrNull(row.name) || 'Untitled department';
        const company = textOrNull(row.company_name);
        return company ? `${name} (${company})` : name;
      }
      case 'locations':
        return [row.code, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled location';
      case 'analytics_categories': {
        const name = textOrNull(row.name) || 'Untitled analytics category';
        const dimension = row.axis_is_default === false ? textOrNull(row.axis_name) : null;
        return dimension ? `${name} (${dimension})` : name;
      }
      default:
        return textOrNull(row.name) || `Untitled ${this.getConfig(entityType).labelSingular}`;
    }
  }

  private titleForPendingCreate(entityType: AiMasterDataEntityType, fields: Record<string, unknown>): string {
    return this.recordTitle(entityType, fields);
  }

  private pickFieldValues(
    entityType: AiMasterDataEntityType,
    row: Record<string, unknown>,
    fieldNames: string[],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const config = this.getConfig(entityType);
    for (const fieldName of fieldNames) {
      const field = config.fields[fieldName];
      values[fieldName] = toJsonScalar(row[fieldName]);
      if (field?.kind === 'date' && values[fieldName] instanceof Date) {
        values[fieldName] = (values[fieldName] as Date).toISOString();
      }
    }
    return values;
  }

  private pickMetricValues(row: Record<string, unknown>, fieldNames: string[]): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const fieldName of fieldNames) {
      values[fieldName] = toJsonScalar(row[fieldName]);
    }
    return values;
  }

  private async displayValuesForFields(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    values: Record<string, unknown>,
  ): Promise<Record<string, string | null>> {
    const config = this.getConfig(entityType);
    const display: Record<string, string | null> = {};
    for (const [fieldName, value] of Object.entries(values)) {
      const field = config.fields[fieldName];
      if (field?.kind === 'relation' && value) {
        if (field.relationTarget === 'users') {
          const user = await this.resolveUserById(context, String(value)).catch(() => null);
          display[fieldName] = user?.label ?? 'Unknown user';
        } else {
          const ref = await this.resolveRecordReference(context, field.relationTarget!, String(value)).catch(() => null);
          display[fieldName] = ref?.label ?? null;
        }
      } else {
        display[fieldName] = formatPlainValue(value, field);
      }
    }
    return display;
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateMasterDataRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(input.entity_type);
    const rawFields = coerceRecord(input.fields, 'fields');
    const normalized = await this.normalizeFields(context, entityType, rawFields, 'create');
    const title = this.titleForPendingCreate(entityType, normalized.fields);

    return {
      targetEntityType: entityType,
      targetEntityId: null,
      mutationInput: {
        action: 'create',
        entity_type: entityType,
        fields: normalized.fields,
        display_values: normalized.displayValues,
        field_labels: normalized.fieldLabels,
      },
      currentValues: {
        target_ref: null,
        target_title: title,
        values: null,
        display_values: null,
      },
    };
  }

  async prepareUpdatePreview(
    context: AiExecutionContextWithManager,
    input: AiUpdateMasterDataRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(input.entity_type);
    const target = await this.resolveRecordReference(context, entityType, input.ref);
    return this.prepareUpdatePreviewForTarget(context, entityType, target, coerceRecord(input.fields, 'fields'), {
      sourcePreviewId: null,
    });
  }

  async prepareReverseUpdatePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    if (!preview.target_entity_id) {
      throw new BadRequestException('Original preview is missing the target record.');
    }
    const previousValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    if (preview.current_values?.metric_year != null && this.hasMetricFields(entityType, previousValues)) {
      previousValues.metrics_year = preview.current_values.metric_year;
    }
    const targetRow = await this.getRecordSnapshot(context, entityType, preview.target_entity_id);
    const target = this.referenceFromRow(entityType, targetRow);
    return this.prepareUpdatePreviewForTarget(context, entityType, target, previousValues, {
      sourcePreviewId: preview.id,
    });
  }

  private async prepareUpdatePreviewForTarget(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    target: ResolvedReference,
    rawFields: Record<string, unknown>,
    opts: { sourcePreviewId: string | null },
  ): Promise<AiPreparedMutationPreview> {
    const normalized = await this.normalizeFields(context, entityType, rawFields, 'update');
    if (entityType === 'contacts' && normalized.fields.supplier_role) {
      const nextSupplierId = Object.prototype.hasOwnProperty.call(normalized.fields, 'supplier_id')
        ? normalized.fields.supplier_id
        : target.row.supplier_id;
      if (!nextSupplierId) {
        throw new BadRequestException('Supplier Role requires Supplier.');
      }
    }
    const { recordFields, metricFields, metricYear } = this.splitStoredMutationFields(entityType, normalized.fields);
    const requestedRecordFieldNames = Object.keys(recordFields);
    const requestedMetricFieldNames = Object.keys(metricFields);
    const currentValues = this.pickFieldValues(entityType, target.row, requestedRecordFieldNames);

    let currentMetricValues: Record<string, unknown> = {};
    if (requestedMetricFieldNames.length > 0) {
      const existingMetric = await this.loadMetricSnapshot(context, entityType, target.id, metricYear!);
      if (!existingMetric) {
        const label = this.getConfig(entityType).labelSingular;
        throw new BadRequestException(
          `${label[0].toUpperCase()}${label.slice(1)} metrics for ${metricYear} do not exist yet. Create them outside the reversible update flow first.`,
        );
      }
      currentMetricValues = this.pickMetricValues(existingMetric, requestedMetricFieldNames);
      Object.assign(currentValues, currentMetricValues);
    }

    const changedRecordFieldNames = requestedRecordFieldNames.filter((fieldName) =>
      !sameValue(currentValues[fieldName], recordFields[fieldName]),
    );
    const changedMetricFieldNames = requestedMetricFieldNames.filter((fieldName) =>
      !sameValue(currentMetricValues[fieldName], metricFields[fieldName]),
    );
    const changedFieldNames = [...changedRecordFieldNames, ...changedMetricFieldNames];
    if (changedFieldNames.length === 0) {
      throw new BadRequestException(`${this.getConfig(entityType).labelSingular} already has the requested values.`);
    }

    const nextFields: Record<string, unknown> = {};
    const nextDisplayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    const previousValues: Record<string, unknown> = {};
    for (const fieldName of changedFieldNames) {
      nextFields[fieldName] = normalized.fields[fieldName];
      nextDisplayValues[fieldName] = normalized.displayValues[fieldName];
      fieldLabels[fieldName] = normalized.fieldLabels[fieldName];
      previousValues[fieldName] = currentValues[fieldName];
    }
    const previousDisplayValues = await this.displayValuesForFields(context, entityType, previousValues);

    return {
      targetEntityType: entityType,
      targetEntityId: target.id,
      mutationInput: {
        action: 'update',
        entity_type: entityType,
        fields: nextFields,
        display_values: nextDisplayValues,
        field_labels: fieldLabels,
        metric_year: changedMetricFieldNames.length > 0 ? metricYear : null,
        source_preview_id: opts.sourcePreviewId,
      },
      currentValues: {
        target_ref: target.ref,
        target_title: target.label,
        values: previousValues,
        display_values: previousDisplayValues,
        metric_year: changedMetricFieldNames.length > 0 ? metricYear : null,
      },
    };
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const config = this.getConfig(entityType);
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    const displayValues = coerceRecord(mutation.display_values ?? {}, 'mutation_input.display_values');
    const fieldLabels = coerceRecord(mutation.field_labels ?? {}, 'mutation_input.field_labels');
    const currentDisplayValues = current.display_values && typeof current.display_values === 'object'
      ? current.display_values as Record<string, unknown>
      : {};
    const title = textOrNull(current.target_title) || this.titleForPendingCreate(entityType, fields);
    const fieldNames = Object.keys(fields);
    const labelList = fieldNames.map((fieldName) => String(fieldLabels[fieldName] || fieldName)).join(', ');

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = action === 'create'
          ? `Create ${config.labelSingular} "${title}".`
          : `Update ${config.labelSingular} "${title}": ${labelList}.`;
        break;
      case 'executed':
        summary = action === 'create'
          ? `Created ${config.labelSingular} "${title}".`
          : `Updated ${config.labelSingular} "${title}".`;
        break;
      case 'rejected':
        summary = `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" failed.`;
        break;
    }

    const changes: Record<string, AiMutationPreviewChangeDto> = {};
    for (const fieldName of fieldNames) {
      changes[fieldName] = {
        label: String(fieldLabels[fieldName] || fieldName),
        from: action === 'create' ? null : formatPlainValue(currentDisplayValues[fieldName]),
        to: formatPlainValue(displayValues[fieldName]),
        format: 'text',
      };
    }

    return {
      target: {
        entity_type: entityType,
        entity_id: preview.target_entity_id ?? null,
        ref: textOrNull(current.target_ref),
        title,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const mutation = preview.mutation_input ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    if (action === 'create') {
      const saved = await this.createRecord(context, entityType, fields, buildAiMutationAudit(preview));
      const snapshot = await this.getRecordSnapshot(context, entityType, String((saved as any).id));
      const ref = this.referenceFromRow(entityType, snapshot);
      preview.target_entity_id = ref.id;
      preview.current_values = {
        ...(preview.current_values ?? {}),
        target_ref: ref.ref,
        target_title: ref.label,
      };
      return;
    }
    if (action !== 'update') {
      throw new BadRequestException('Unsupported master data mutation action.');
    }
    if (!preview.target_entity_id) {
      throw new BadRequestException('Preview is missing the target record.');
    }

    const expectedValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    const { recordFields: expectedRecordValues, metricFields: expectedMetricValues } =
      this.splitStoredMutationFields(entityType, expectedValues);
    const live = Object.keys(expectedRecordValues).length > 0
      ? await this.getRecordSnapshot(context, entityType, preview.target_entity_id)
      : null;
    for (const [fieldName, expectedValue] of Object.entries(expectedRecordValues)) {
      if (!sameValue((live as Record<string, unknown>)[fieldName], expectedValue)) {
        const label = this.getConfig(entityType).fields[fieldName]?.label ?? fieldName;
        throw new ConflictException(`${label} changed after the preview was created.`);
      }
    }
    const expectedMetricFieldNames = Object.keys(expectedMetricValues);
    if (expectedMetricFieldNames.length > 0) {
      const metricYear = Number(preview.mutation_input?.metric_year ?? preview.current_values?.metric_year);
      const liveMetric = Number.isInteger(metricYear)
        ? await this.loadMetricSnapshot(context, entityType, preview.target_entity_id, metricYear)
        : null;
      if (!liveMetric) {
        const label = this.getConfig(entityType).labelSingular;
        throw new ConflictException(`${label[0].toUpperCase()}${label.slice(1)} metrics for ${metricYear || 'the selected year'} changed after the preview was created.`);
      }
      for (const [fieldName, expectedValue] of Object.entries(expectedMetricValues)) {
        if (!sameValue(liveMetric[fieldName], expectedValue)) {
          const label = this.getConfig(entityType).fields[fieldName]?.label ?? fieldName;
          throw new ConflictException(`${label} changed after the preview was created.`);
        }
      }
    }
    const metricYear = preview.mutation_input?.metric_year == null ? null : Number(preview.mutation_input.metric_year);
    await this.updateRecord(context, entityType, preview.target_entity_id, fields, buildAiMutationAudit(preview), metricYear);
  }

  private async createRecord(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    fields: Record<string, unknown>,
    audit: AuditSourceOptions,
  ): Promise<unknown> {
    switch (entityType) {
      case 'companies': {
        const { recordFields, metricFields, metricYear } = this.splitStoredMutationFields(entityType, fields);
        const saved = await this.companies.create(recordFields as any, context.userId, { manager: context.manager, audit });
        if (Object.keys(metricFields).length > 0) {
          await this.companyMetrics.upsertForCompany(
            String((saved as any).id),
            metricYear!,
            metricFields as any,
            context.userId,
            { manager: context.manager, audit },
          );
        }
        return saved;
      }
      case 'departments': {
        const { recordFields, metricFields, metricYear } = this.splitStoredMutationFields(entityType, fields);
        const saved = await this.departments.create(recordFields as any, context.userId, { manager: context.manager, audit });
        if (Object.keys(metricFields).length > 0) {
          await this.departmentMetrics.upsertForDepartment(
            String((saved as any).id),
            metricYear!,
            metricFields as any,
            context.userId,
            { manager: context.manager, audit },
          );
        }
        return saved;
      }
      case 'suppliers':
        return this.suppliers.create(fields as any, context.userId, { manager: context.manager, audit });
      case 'contacts':
        return this.contacts.create(fields as any, { manager: context.manager, userId: context.userId, audit });
      case 'accounts':
        return this.accounts.create(fields as any, context.userId, { manager: context.manager, audit });
      case 'chart_of_accounts':
        return this.chartOfAccounts.create(fields as any, context.userId, { manager: context.manager, audit });
      case 'analytics_categories':
        // No dimension in the fields: a new value lands in the default dimension.
        return this.analyticsCategories.create(fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId, audit });
      case 'business_processes':
        return this.businessProcesses.create(fields as any, context.userId, { manager: context.manager, audit });
      case 'locations':
        return this.locations.create(fields as any, context.tenantId, context.userId, { manager: context.manager, audit });
    }
  }

  private async updateRecord(
    context: AiExecutionContextWithManager,
    entityType: AiMasterDataEntityType,
    id: string,
    fields: Record<string, unknown>,
    audit: AuditSourceOptions,
    metricYear: number | null = null,
  ): Promise<unknown> {
    switch (entityType) {
      case 'companies': {
        const { recordFields, metricFields } = this.splitStoredMutationFields(entityType, fields);
        let updated: unknown = null;
        if (Object.keys(recordFields).length > 0) {
          updated = await this.companies.update(id, recordFields as any, context.userId, { manager: context.manager, audit });
        }
        if (Object.keys(metricFields).length > 0) {
          if (!Number.isInteger(metricYear)) {
            throw new BadRequestException('Metrics Year is required when writing company metrics.');
          }
          const currentMetric = await this.companyMetrics.getForCompany(id, metricYear!, { manager: context.manager });
          if (!currentMetric) {
            throw new ConflictException(`Company metrics for ${metricYear} changed after the preview was created.`);
          }
          updated = await this.companyMetrics.upsertForCompany(
            id,
            metricYear!,
            {
              headcount: (currentMetric as any).headcount,
              it_users: (currentMetric as any).it_users,
              turnover: (currentMetric as any).turnover,
              ...metricFields,
            } as any,
            context.userId,
            { manager: context.manager, audit },
          );
        }
        return updated;
      }
      case 'departments': {
        const { recordFields, metricFields } = this.splitStoredMutationFields(entityType, fields);
        let updated: unknown = null;
        if (Object.keys(recordFields).length > 0) {
          updated = await this.departments.update(id, recordFields as any, context.userId, { manager: context.manager, audit });
        }
        if (Object.keys(metricFields).length > 0) {
          if (!Number.isInteger(metricYear)) {
            throw new BadRequestException('Metrics Year is required when writing department metrics.');
          }
          const currentMetric = await this.departmentMetrics.getForDepartment(id, metricYear!, { manager: context.manager });
          if (!currentMetric) {
            throw new ConflictException(`Department metrics for ${metricYear} changed after the preview was created.`);
          }
          updated = await this.departmentMetrics.upsertForDepartment(
            id,
            metricYear!,
            {
              headcount: (currentMetric as any).headcount,
              ...metricFields,
            } as any,
            context.userId,
            { manager: context.manager, audit },
          );
        }
        return updated;
      }
      case 'suppliers':
        return this.suppliers.update(id, fields as any, context.userId, { manager: context.manager, audit });
      case 'contacts':
        return this.contacts.update(id, fields as any, { manager: context.manager, userId: context.userId, audit });
      case 'accounts':
        return this.accounts.update(id, fields as any, context.userId, { manager: context.manager, audit });
      case 'chart_of_accounts':
        return this.chartOfAccounts.update(id, fields as any, context.userId, { manager: context.manager, audit });
      case 'analytics_categories':
        return this.analyticsCategories.update(id, fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId, audit });
      case 'business_processes':
        return this.businessProcesses.update(id, fields as any, context.userId, { manager: context.manager, audit });
      case 'locations':
        return this.locations.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager, audit });
    }
  }
}

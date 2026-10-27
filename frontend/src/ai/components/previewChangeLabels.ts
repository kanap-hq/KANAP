import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { AiMutationPreview } from '../aiTypes';

/**
 * The labels and values of a preview card in the user's language, with the words of the screens.
 * The server sends each change under its field key, with an English label and the stored value
 * (a code for a list value): the label comes from `ai:previewCard`, the value from the catalog the
 * screens use. A key or a value nobody translates shows as the server sent it (a dimension's name,
 * a record's name, a free text). A date reads as on the screens ("3 nov. 2027").
 */

const TASK_TOOLS = new Set(['create_task', 'update_task_fields', 'update_task_status', 'update_task_assignee', 'import_ticket', 'import_glpi_ticket']);
const RECORD_TOOLS = new Set([
  'create_business_record',
  'update_business_record',
  'create_master_data_record',
  'update_master_data_record',
  'write_financial_plan',
]);

/** A stored code as the catalogs key it: `in progress` and `In_Progress` read as `in_progress`. */
const codeOf = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const camel = (code: string) => code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** A date as the server sends it: a day, or a day and a time (a date field read back from a timestamp). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

type ValueRule = {
  fields: string[];
  tools?: Set<string>;
  entities?: string[];
  key: (code: string) => string;
};

/** The catalog of each list value, first match wins. */
const VALUE_RULES: ValueRule[] = [
  { tools: TASK_TOOLS, fields: ['status'], key: (code) => `portfolio:statuses.task.${code}` },
  { tools: TASK_TOOLS, fields: ['priority', 'priority_level'], key: (code) => `portfolio:priority.${code}` },
  { tools: TASK_TOOLS, fields: ['relation'], key: (code) => `portfolio:context.${code}` },
  { tools: TASK_TOOLS, fields: ['assignee', 'assignee_email'], key: (code) => (code === 'unassigned' ? 'ai:previewCard.values.unassigned' : '') },
  { tools: new Set(['create_document']), fields: ['status'], key: (code) => `knowledge:statuses.${code}` },
  { entities: ['projects'], fields: ['status'], key: (code) => `portfolio:statuses.project.${code}` },
  { entities: ['projects'], fields: ['origin'], key: (code) => `portfolio:origin.${code}` },
  { entities: ['projects'], fields: ['scheduling_mode'], key: (code) => `portfolio:planning.roadmap.schedulingModes.${code}` },
  { entities: ['requests'], fields: ['status'], key: (code) => `portfolio:statuses.request.${code}` },
  { entities: ['chart_of_accounts'], fields: ['scope'], key: (code) => `ai:previewCard.values.coaScope.${code}` },
  { fields: ['environment'], key: (code) => `it:enums.environment.${camel(code)}` },
  { fields: ['topology'], key: (code) => `it:enums.topology.${camel(code)}` },
  { fields: ['risk_mode'], key: (code) => `it:enums.riskMode.${code}` },
  { fields: ['integration_route_type'], key: (code) => `it:enums.routeType.${camel(code)}` },
  { fields: ['billing_frequency'], key: (code) => `ops:contracts.billing.${code}` },
  { fields: ['run_build'], key: (code) => `ops:opex.runBuild.${code}` },
  { fields: ['supplier_role'], key: (code) => `master-data:contacts.roles.${code}` },
  { fields: ['nature', 'applies_to'], key: (code) => `master-data:shared.usages.nature.${code}` },
  { fields: ['users_mode'], key: (code) => `ai:previewCard.values.usersMode.${code}` },
  { fields: ['input_grain'], key: (code) => `ai:previewCard.values.inputGrain.${code}` },
  { fields: ['allocation_method', 'allocation_driver'], key: (code) => `ai:previewCard.values.allocationMethod.${code}` },
  { fields: ['status'], key: (code) => `common:statuses.${code}` },
];

const CLASSIFICATION_REVIEW: Record<string, string> = {
  Reviewed: 'ai:previewCard.values.classificationReview.reviewed',
  'Stale after this change': 'ai:previewCard.values.classificationReview.stale',
};

export function usePreviewChangeLabels() {
  const { t, i18n } = useTranslation(['ai', 'portfolio', 'knowledge', 'it', 'ops', 'master-data', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const locale = useLocale();

  /** The first key the loaded texts hold, translated; null when none does. */
  const known = useCallback(
    (keys: string[]): string | null => {
      const key = keys.find((candidate) => candidate && i18n.exists(candidate));
      return key ? t(key) : null;
    },
    [i18n, t],
  );

  const fieldLabel = useCallback(
    (preview: AiMutationPreview, field: string, label: string | null | undefined): string => {
      const entity = preview.target.entity_type;
      return known([
        `ai:previewCard.fieldsByEntity.${entity}.${field}`,
        preview.tool_name === 'update_entity_relations' ? `ai:previewCard.relationFields.${field}` : '',
        `ai:previewCard.fields.${field}`,
      ]) ?? (label || field);
    },
    [known],
  );

  const valueLabel = useCallback(
    (preview: AiMutationPreview, field: string, value: string | null): string | null => {
      if (!value) return value;
      if (ISO_DATE_RE.test(value)) return formatShortDate(value, locale, { empty: value });
      if (field === 'classification_review_state') return known([CLASSIFICATION_REVIEW[value] ?? '']) ?? value;
      const entity = preview.target.entity_type;
      if (field === 'lifecycle' && entity === 'applications') return labelFor('lifecycleStatus', value) || value;
      if (RECORD_TOOLS.has(preview.tool_name) && (value === 'Yes' || value === 'No')) {
        return known([`it:enums.yesNo.${value.toLowerCase()}`]) ?? value;
      }
      const code = codeOf(value);
      const rules = VALUE_RULES.filter((rule) => rule.fields.includes(field)
        && (!rule.tools || rule.tools.has(preview.tool_name))
        && (!rule.entities || rule.entities.includes(entity)));
      return known(rules.map((rule) => rule.key(code))) ?? value;
    },
    [known, labelFor, locale],
  );

  return { fieldLabel, valueLabel };
}

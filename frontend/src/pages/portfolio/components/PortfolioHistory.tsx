import React from 'react';
import {
  Box,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { contentToPlainText } from '../../../utils/contentToPlainText';
import {
  getDecisionOutcomeLabel,
  getFeasibilityStatusLabel,
} from '../../../utils/portfolioI18n';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../../lib/dateFormat';
import { formatUserName } from '../../../utils/userDisplay';
import { buildCreatedEntry, isCreatedEntry } from '../../../utils/activityFeed';

interface Activity {
  id: string;
  type: 'comment' | 'change' | 'decision';
  content: string | null;
  context: string | null;
  decision_outcome: string | null;
  changed_fields?: Record<string, [unknown, unknown]>;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name?: string | null;
  email?: string | null;
  created_at: string;
}

interface PortfolioHistoryProps {
  entityType: 'request' | 'project';
  activities: Activity[];
  /** Creation timestamp of the entity, shown above the change feed. */
  createdAt?: string | null;
  /** Creation author (name, or email when the account has no name). */
  createdByName?: string | null;
}

// Labels for common field names
const FIELD_LABEL_KEYS: Record<string, string> = {
  name: 'name',
  purpose: 'purpose',
  status: 'status',
  current_situation: 'currentSituation',
  expected_benefits: 'expectedBenefits',
  risks: 'risks',
  feasibility_review: 'feasibilityReview',
  source_id: 'source',
  category_id: 'category',
  stream_id: 'stream',
  requestor_id: 'requestor',
  target_delivery_date: 'targetDeliveryDate',
  origin_task_id: 'originTask',
  company_id: 'company',
  department_id: 'department',
  business_sponsor_id: 'businessSponsor',
  business_lead_id: 'businessLead',
  it_sponsor_id: 'itSponsor',
  it_lead_id: 'itLead',
  planned_start: 'plannedStart',
  planned_end: 'plannedEnd',
  estimated_effort_it: 'estimatedEffortIt',
  estimated_effort_business: 'estimatedEffortBusiness',
  actual_effort_it: 'actualEffortIt',
  actual_effort_business: 'actualEffortBusiness',
  execution_progress: 'progress',
  priority_score: 'priorityScore',
  priority_override: 'priorityOverride',
  override_value: 'overrideValue',
  override_justification: 'overrideJustification',
  business_team: 'businessTeam',
  it_team: 'itTeam',
  dependency: 'dependency',
  applications: 'applications',
  assets: 'assets',
  capex_items: 'capexItems',
  opex_items: 'opexItems',
  phase: 'phase',
  task_created: 'taskCreated',
  created_from_task: 'createdFromTask',
  created_from_request: 'createdFromRequest',
  criteria_values: 'criteriaValues',
  scheduling_mode: 'schedulingMode',
  converted_to_request: 'convertedToRequest',
  it_effort_allocation_mode: 'itEffortAllocationMode',
  business_effort_allocation_mode: 'businessEffortAllocationMode',
};

const humanize = (field: string) =>
  field
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase());

type ChangeEntries = Array<[string, [unknown, unknown]]>;

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Rows written before scoring diffs became readable stored the raw
 * criterion/value identifier maps, which cannot be rendered. They are dropped
 * from the line, which keeps the score change it was logged with.
 */
const visibleChangeEntries = (changedFields: Record<string, [unknown, unknown]>): ChangeEntries =>
  (Object.entries(changedFields) as ChangeEntries).filter(
    ([field, [oldVal, newVal]]) =>
      !(field === 'criteria_values' && (isPlainObject(oldVal) || isPlainObject(newVal))),
  );

/**
 * A side of a budget line change as the server shapes it for this reader: the lines they may read
 * (or `null` without the budget right) and the number of the others.
 */
type HiddenLinesSide = { labels: string[] | null; hidden: number };

const isHiddenLinesSide = (value: unknown): value is HiddenLinesSide =>
  isPlainObject(value) && typeof (value as HiddenLinesSide).hidden === 'number'
  && ((value as HiddenLinesSide).labels === null || Array.isArray((value as HiddenLinesSide).labels));

const DOCUMENT_SLOTS: Record<string, 'purpose' | 'risks'> = {
  purpose: 'purpose',
  risks_mitigations: 'risks',
};

/** Rows written before the slot key was stored carry a rendered sentence. */
const LEGACY_DOCUMENT_UPDATES: Record<string, 'purpose' | 'risks'> = {
  'Purpose updated': 'purpose',
  'Risks & Mitigations updated': 'risks',
};

const getDocumentUpdateField = (activity: { content: string | null; changed_fields?: Record<string, [unknown, unknown]> }): 'purpose' | 'risks' | null => {
  const slot = activity.changed_fields?.document_updated?.[1];
  if (typeof slot === 'string' && DOCUMENT_SLOTS[slot]) return DOCUMENT_SLOTS[slot];
  return LEGACY_DOCUMENT_UPDATES[String(activity.content || '').trim()] ?? null;
};

const toCommentPreview = (value: string, maxLen = 180): string => {
  const text = contentToPlainText(value);
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.substring(0, maxLen)}...`;
};

export default function PortfolioHistory({
  entityType,
  activities,
  createdAt,
  createdByName,
}: PortfolioHistoryProps) {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const formatFeasibilitySummary = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return t('activity.history.values.notSet');
    }
    const raw = value as Record<string, any>;
    const parts: string[] = [];

    const dimensionLabels = {
      technical_feasibility: t('activity.history.feasibilityDimensions.technicalFeasibility'),
      integration_compatibility: t('activity.history.feasibilityDimensions.integrationCompatibility'),
      infrastructure_needs: t('activity.history.feasibilityDimensions.infrastructureNeeds'),
      security_compliance: t('activity.history.feasibilityDimensions.securityCompliance'),
      resource_skills: t('activity.history.feasibilityDimensions.resourceSkills'),
      delivery_constraints: t('activity.history.feasibilityDimensions.deliveryConstraints'),
      change_management: t('activity.history.feasibilityDimensions.changeManagement'),
    };

    for (const [key, label] of Object.entries(dimensionLabels)) {
      const status = String(raw?.[key]?.status || '').trim();
      if (!status || status === 'not_assessed') continue;
      parts.push(`${label}: ${getFeasibilityStatusLabel(t, status)}`);
    }

    if (parts.length === 0) return t('activity.history.values.allDimensionsNotAssessed');
    if (parts.length <= 2) return parts.join('; ');
    return t('activity.history.values.dimensionsAssessed', { count: parts.length });
  };

  const formatTime = (dateStr: string) => formatShortDateTime(dateStr, locale);

  const formatFieldValue = (field: string, value: unknown): string => {
    if (value === null || value === undefined) return t('activity.history.values.empty');
    if (isHiddenLinesSide(value)) {
      // Budget lines outside the reader's access, or every line for a reader without the budget right.
      const key = value.labels === null ? 'count' : value.labels.length === 0 ? 'only' : 'and';
      const outside = t(`it:workspace.application.relations.outside.${key}`, { count: value.hidden });
      return key === 'and' ? `${value.labels!.join(', ')} ${outside}` : outside;
    }
    if (typeof value === 'boolean') return value ? t('activity.history.values.yes') : t('activity.history.values.no');
    if (Array.isArray(value)) {
      if (value.length === 0) return t('activity.history.values.empty');
      return value.map((entry) => String(entry)).join(', ');
    }
    if (field === 'feasibility_review') {
      return formatFeasibilitySummary(value);
    }
    if (field.endsWith('_date') || field === 'planned_start' || field === 'planned_end') {
      return value
        ? formatShortDate(String(value), locale, { year: 'always', empty: t('activity.history.values.none') })
        : t('activity.history.values.none');
    }
    // For rich text content, show truncated plain-text preview
    if (typeof value === 'string') {
      const textOnly = contentToPlainText(value);
      if (textOnly.length > 50) {
        return textOnly.substring(0, 50) + '...';
      }
      return textOnly || t('activity.history.values.empty');
    }
    return String(value);
  };

  const formatFieldLabel = (field: string): string => {
    if (field.startsWith('phase.')) {
      const parts = field.split('.');
      if (parts.length >= 3) {
        const phaseIdOrName = parts[1];
        const phaseField = parts.slice(2).join('.');
        if (phaseIdOrName.length >= 8 && phaseIdOrName.includes('-')) {
          // UUID identifier — never surface it (or a fragment of it) to users
          return t('activity.history.fields.phaseGeneric', {
            field: humanize(phaseField),
          });
        }
        return t('activity.history.fields.phaseWithName', {
          phase: phaseIdOrName,
          field: humanize(phaseField),
        });
      }
    }
    const key = FIELD_LABEL_KEYS[field];
    return key ? t(`activity.history.fields.${key}`) : humanize(field);
  };

  const getActivityDescription = (activity: Activity): React.ReactNode => {
    if (activity.type === 'comment') {
      return t('activity.history.actions.addedComment');
    }
    if (activity.type === 'decision') {
      const outcomeLabel = activity.decision_outcome
        ? getDecisionOutcomeLabel(t, activity.decision_outcome)
        : '';
      return outcomeLabel
        ? t('activity.history.actions.decisionWithOutcome', { outcome: outcomeLabel })
        : t('activity.labels.decision');
    }
    if (activity.type === 'change') {
      const documentField = getDocumentUpdateField(activity);
      if (documentField) {
        return t('activity.history.actions.updatedDocument', {
          document: t(`activity.history.fields.${documentField}`),
        });
      }

      const entries = activity.changed_fields ? visibleChangeEntries(activity.changed_fields) : [];
      if (entries.length === 1) {
        const [field, [oldVal, newVal]] = entries[0];
        const fieldLabel = formatFieldLabel(field);
        if ((oldVal === null || oldVal === undefined) && (newVal !== null && newVal !== undefined)) {
          return t('activity.history.actions.addedField', {
            field: fieldLabel,
            value: formatFieldValue(field, newVal),
          });
        }
        if ((oldVal !== null && oldVal !== undefined) && (newVal === null || newVal === undefined)) {
          return t('activity.history.actions.removedField', {
            field: fieldLabel,
            value: formatFieldValue(field, oldVal),
          });
        }
        return t('activity.history.actions.changedField', {
          field: fieldLabel,
          from: formatFieldValue(field, oldVal),
          to: formatFieldValue(field, newVal),
        });
      }
      if (entries.length > 1) {
        return t('activity.history.actions.updatedMultiple', {
          changes: entries.map(([field, [oldVal, newVal]]) => {
            const label = formatFieldLabel(field);
            if ((oldVal === null || oldVal === undefined) && (newVal !== null && newVal !== undefined)) {
              return t('activity.history.actions.addedField', {
                field: label,
                value: formatFieldValue(field, newVal),
              });
            }
            if ((oldVal !== null && oldVal !== undefined) && (newVal === null || newVal === undefined)) {
              return t('activity.history.actions.removedField', {
                field: label,
                value: formatFieldValue(field, oldVal),
              });
            }
            return t('activity.history.actions.changedField', {
              field: label,
              from: formatFieldValue(field, oldVal),
              to: formatFieldValue(field, newVal),
            });
          }).join(' | '),
        });
      }

      // A change row without a readable diff still tells what happened rather
      // than showing an empty "activity recorded" line.
      const fallback = String(activity.content || '').trim();
      return fallback || t('activity.history.actions.recorded');
    }
    return t('activity.history.actions.recorded');
  };

  const getActivityColor = (type: string): string => {
    switch (type) {
      case 'comment':
        return 'primary.main';
      case 'change':
        return 'grey.400';
      case 'decision':
        return 'warning.main';
      default:
        return 'grey.400';
    }
  };

  // Creation is appended last (the feed is newest first) and renders exactly like
  // the other entries, timestamp included.
  const entries: Activity[] = React.useMemo(() => {
    const created = buildCreatedEntry(createdAt, createdByName);
    return created ? [...activities, created] : activities;
  }, [activities, createdAt, createdByName]);

  return (
    <Stack spacing={1}>
      {entries.length === 0 ? (
        <Typography color="text.secondary" variant="body2">
          {t('activity.messages.noHistory')}
        </Typography>
      ) : (
        entries.map((activity) => (
        <Box
          key={activity.id}
          sx={{
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            borderLeft: 3,
            borderColor: getActivityColor(activity.type),
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
              {isCreatedEntry(activity)
                ? t('activity.labels.created')
                : activity.type === 'comment'
                ? t('activity.labels.comment')
                : activity.type === 'change'
                ? t('activity.labels.change')
                : t('activity.labels.decision')}
            </Typography>
            {!isCreatedEntry(activity) && (
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {getActivityDescription(activity)}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {formatUserName(activity) || t('activity.authorUnknown')} &bull;{' '}
              {formatTime(activity.created_at)}
            </Typography>
          </Stack>
          {activity.type === 'decision' && activity.context && (
            <Typography
              variant="caption"
              color="warning.main"
              sx={{ display: 'block', mt: 0.5 }}
            >
              {activity.context}
            </Typography>
          )}
          {activity.type === 'comment' && activity.content && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                pl: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {toCommentPreview(activity.content)}
            </Typography>
          )}
        </Box>
        ))
      )}
    </Stack>
  );
}

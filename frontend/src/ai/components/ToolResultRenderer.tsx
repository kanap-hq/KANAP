import React from 'react';
import {
  Alert,
  Box,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../../components/design';
import { useTranslation } from 'react-i18next';
import { historyActionText, historyActorText } from '../../components/history/recordHistoryActor';
import type { Translate } from '../../lib/audit/auditLogLabels';
import { formatShortDateTime } from '../../lib/dateFormat';

type ToolResultBodyProps = {
  name: string;
  result: unknown;
};

function getIgnoredFields(result: unknown): string[] {
  if (!result || typeof result !== 'object') {
    return [];
  }
  const candidate = result as Record<string, unknown>;
  const values = Array.isArray(candidate.filters_ignored)
    ? candidate.filters_ignored
    : Array.isArray(candidate.fields_ignored)
      ? candidate.fields_ignored
      : [];
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function EntityList({ items }: { items: any[] }) {
  const { t } = useTranslation(['ai']);
  const mode = useTheme().palette.mode;
  if (!items?.length) return <Typography variant="body2" color="text.secondary">{t('toolResults.noResults')}</Typography>;
  return (
    <Stack spacing={0.5}>
      {items.map((item: any, i: number) => (
        <Stack key={item.id || i} direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{item.type}</Box>
          {item.ref && <Typography variant="body2" fontWeight={500}>{item.ref}</Typography>}
          <Typography variant="body2">{item.label}</Typography>
          {item.status && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
              <StatusDot color={getDotColor('info', mode)} />
              <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{item.status}</Typography>
            </Box>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

function DocumentList({ items }: { items: any[] }) {
  const { t } = useTranslation(['ai']);
  if (!items?.length) return <Typography variant="body2" color="text.secondary">{t('toolResults.noDocuments')}</Typography>;
  return (
    <Stack spacing={0.5}>
      {items.map((item: any, i: number) => (
        <Stack key={item.id || i} spacing={0.25}>
          <Stack direction="row" spacing={1} alignItems="center">
            {item.ref && <Typography variant="body2" fontWeight={500}>{item.ref}</Typography>}
            <Typography variant="body2">{item.title}</Typography>
          </Stack>
          {item.snippet && (
            <Typography variant="caption" color="text.secondary">{item.snippet}</Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

function CommentsList({ result }: { result: any }) {
  const { t } = useTranslation(['ai']);
  const items = Array.isArray(result?.items) ? result.items : [];
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">{t('toolResults.noComments', { defaultValue: 'No comments found.' })}</Typography>;
  }
  return (
    <Stack spacing={1}>
      {result?.entity && (
        <Stack direction="row" spacing={1} alignItems="center">
          <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{result.entity.type}</Box>
          {result.entity.ref && <Typography variant="body2" fontWeight={500}>{result.entity.ref}</Typography>}
          <Typography variant="body2">{result.entity.label}</Typography>
        </Stack>
      )}
      {items.map((item: any, i: number) => (
        <Stack key={`${item.created_at || 'comment'}-${i}`} spacing={0.25}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" fontWeight={500}>
              {item.author || t('toolResults.unknownAuthor', { defaultValue: 'Unknown author' })}
            </Typography>
            {item.created_at && (
              <Typography variant="caption" color="text.secondary">
                {item.created_at}
              </Typography>
            )}
            {item.edited && (
              <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
                {t('toolResults.edited', { defaultValue: 'Edited' })}
              </Box>
            )}
          </Stack>
          <Typography variant="body2">{item.content || t('toolResults.emptyComment', { defaultValue: '(empty comment)' })}</Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** The entries of a record's History tab, each as the tab's first line: date, author, action. */
function HistoryEntries({ result }: { result: any }) {
  const { t, i18n } = useTranslation(['admin']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const translate = t as unknown as Translate;
  const items = Array.isArray(result?.items) ? result.items : [];
  if (!items.length) {
    return <Typography variant="body2" color="text.secondary">{t('admin:auditLogs.history.empty')}</Typography>;
  }
  return (
    <Stack spacing={0.5}>
      {items.map((item: any, i: number) => (
        <Stack key={`${item.at || 'entry'}-${i}`} direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
          {item.at && (
            <Box component="time" dateTime={item.at} sx={{ fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}>
              {formatShortDateTime(item.at, locale)}
            </Box>
          )}
          <Typography variant="caption" fontWeight={500}>
            {historyActorText(item.actor ?? { kind: 'user', name: null }, translate)}
          </Typography>
          {item.action && (
            <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
              {historyActionText(item.action, translate)}
            </Box>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

function GenericResult({ result }: { result: unknown }) {
  return (
    <Box
      component="pre"
      sx={{
        fontSize: '0.75rem',
        maxHeight: 200,
        overflow: 'auto',
        bgcolor: 'action.hover',
        p: 1,
        borderRadius: 1,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
      }}
    >
      {JSON.stringify(result, null, 2)}
    </Box>
  );
}

function ResultMeta({ result }: { result: any }) {
  const rawItems: Array<[string, unknown]> = [
    ['status', result?.status],
    ['total', result?.total],
    ['returned', result?.returned],
    ['complete', result?.complete],
    ['truncated', result?.truncated],
  ];
  const items = rawItems.filter(([, value]) => value !== undefined && value !== null);

  if (!items.length) return null;

  return (
    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
      {items.map(([label, value]) => (
        <Typography
          key={label}
          variant="caption"
          sx={{ color: 'text.secondary', fontFamily: label === 'status' ? undefined : "'JetBrains Mono Variable', ui-monospace, monospace" }}
        >
          {label}: {String(value)}
        </Typography>
      ))}
    </Stack>
  );
}

function RepairSuggestions({ result }: { result: any }) {
  const suggestions = Array.isArray(result?.suggested_repairs) ? result.suggested_repairs : [];
  if (!suggestions.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mb: 1 }}>
      {suggestions.map((suggestion: any, index: number) => (
        <Typography key={`${suggestion.field || 'field'}-${index}`} variant="caption" color="text.secondary">
          {suggestion.field}: {suggestion.reason}
        </Typography>
      ))}
    </Stack>
  );
}

function AggregateGroups({ result }: { result: any }) {
  const { t } = useTranslation(['ai']);
  const groups = Array.isArray(result?.groups) ? result.groups : [];
  if (!groups.length) return <Typography variant="body2" color="text.secondary">{t('toolResults.noGroups')}</Typography>;
  return (
    <Stack spacing={0.5}>
      {groups.slice(0, 20).map((group: any, index: number) => (
        <Stack key={`${group.key ?? 'empty'}-${index}`} direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ flex: 1 }}>{group.key ?? t('toolResults.empty')}</Typography>
          <Typography variant="body2" sx={{ fontFamily: "'JetBrains Mono Variable', ui-monospace, monospace", color: 'text.secondary' }}>
            {group.count ?? group.value ?? 0}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function FilterValues({ result }: { result: any }) {
  const { t } = useTranslation(['ai']);
  const values = result?.values && typeof result.values === 'object' ? result.values : {};
  const fields = Object.entries(values);
  if (!fields.length) return <Typography variant="body2" color="text.secondary">{t('toolResults.noFilterValues')}</Typography>;
  return (
    <Stack spacing={0.75}>
      {fields.map(([field, entries]) => (
        <Stack key={field} spacing={0.25}>
          <Typography variant="caption" color="text.secondary">{field}</Typography>
          <Typography variant="body2">
            {(Array.isArray(entries) ? entries : []).slice(0, 12).map((entry) => entry === null ? t('toolResults.empty') : String(entry)).join(', ')}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function FilterDescriptions({ result }: { result: any }) {
  const { t } = useTranslation(['ai']);
  const fields = Array.isArray(result?.fields) ? result.fields : [];
  if (!fields.length) return <Typography variant="body2" color="text.secondary">{t('toolResults.noFilterFields')}</Typography>;
  return (
    <Stack spacing={0.75}>
      {fields.slice(0, 24).map((field: any) => (
        <Stack key={field.field} spacing={0.25}>
          <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{field.field}</Typography>
            <Typography variant="caption" color="text.secondary">{field.type}</Typography>
            {field.accepted_value_kind && (
              <Typography variant="caption" color="text.secondary">{field.accepted_value_kind}</Typography>
            )}
          </Stack>
          {field.aliases?.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              {t('toolResults.aliases', { aliases: field.aliases.join(', ') })}
            </Typography>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

/**
 * ToolResultBody renders a tool call's result content without wrapper chrome.
 * Wrap it in your own collapsible UI (e.g. ChatToolRibbon).
 */
export function ToolResultBody({ name, result }: ToolResultBodyProps) {
  const { t } = useTranslation(['ai']);
  const data = result as any;
  const ignoredFields = getIgnoredFields(result);

  const renderContent = () => {
    switch (name) {
      case 'search_all':
        return <EntityList items={data?.items || []} />;
      case 'query_entities':
        return (
          <Stack spacing={1}>
            <ResultMeta result={data} />
            <RepairSuggestions result={data} />
            <EntityList items={data?.items || []} />
          </Stack>
        );
      case 'aggregate_entities':
        return (
          <Stack spacing={1}>
            <ResultMeta result={data} />
            <RepairSuggestions result={data} />
            <AggregateGroups result={data} />
          </Stack>
        );
      case 'get_filter_values':
        return (
          <Stack spacing={1}>
            <ResultMeta result={data} />
            <FilterValues result={data} />
          </Stack>
        );
      case 'describe_entity_filters':
        return (
          <Stack spacing={1}>
            <ResultMeta result={data} />
            <FilterDescriptions result={data} />
          </Stack>
        );
      case 'get_entity_context':
        return (
          <Stack spacing={1}>
            {data?.entity && (
              <Stack direction="row" spacing={1} alignItems="center">
                <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>{data.entity.type}</Box>
                {data.entity.ref && <Typography variant="body2" fontWeight={500}>{data.entity.ref}</Typography>}
                <Typography variant="body2">{data.entity.label}</Typography>
              </Stack>
            )}
            {data?.related?.map((group: any, i: number) => (
              <Box key={i}>
                <Typography variant="caption" color="text.secondary">{group.label}</Typography>
                <EntityList items={group.items} />
              </Box>
            ))}
          </Stack>
        );
      case 'get_entity_comments':
        return <CommentsList result={data} />;
      case 'get_record_history':
        return <HistoryEntries result={data} />;
      case 'search_knowledge':
        return <DocumentList items={data?.items || []} />;
      case 'get_document':
        return (
          <Stack spacing={0.5}>
            {data?.ref && <Typography variant="body2" fontWeight={500}>{data.ref}: {data.title}</Typography>}
            {data?.summary && <Typography variant="body2" color="text.secondary">{data.summary}</Typography>}
          </Stack>
        );
      default:
        return <GenericResult result={result} />;
    }
  };

  return (
    <Box>
      {ignoredFields.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1, py: 0 }}>
          <Typography variant="body2">
            {t('toolResults.ignoredFields', {
              fields: ignoredFields.join(', '),
              defaultValue: `Ignored fields: ${ignoredFields.join(', ')}`,
            })}
          </Typography>
        </Alert>
      )}
      {renderContent()}
    </Box>
  );
}

/**
 * Get a short, human-readable summary of a tool result (e.g. "16 results", "no result").
 * Returns null when no useful summary can be derived.
 */
export function getToolResultSummary(name: string, result: unknown): { count: number; kind: 'results' | 'documents' | 'groups' | 'fields' | 'none' } | null {
  if (!result || typeof result !== 'object') return null;
  const data = result as any;

  switch (name) {
    case 'search_all':
    case 'query_entities':
    case 'get_entity_context': {
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.related) ? data.related.flatMap((g: any) => g.items || []) : []);
      return { count: typeof data?.total === 'number' ? data.total : items.length, kind: 'results' };
    }
    case 'aggregate_entities': {
      const groups = Array.isArray(data?.groups) ? data.groups : [];
      return { count: groups.length, kind: 'groups' };
    }
    case 'search_knowledge': {
      const items = Array.isArray(data?.items) ? data.items : [];
      return { count: items.length, kind: 'documents' };
    }
    case 'get_document':
      return data?.ref ? { count: 1, kind: 'documents' } : null;
    case 'get_entity_comments':
    case 'get_record_history': {
      const items = Array.isArray(data?.items) ? data.items : [];
      return { count: items.length, kind: 'results' };
    }
    case 'describe_entity_filters': {
      const fields = Array.isArray(data?.fields) ? data.fields : [];
      return { count: fields.length, kind: 'fields' };
    }
    case 'get_filter_values': {
      const values = data?.values && typeof data.values === 'object' ? Object.keys(data.values) : [];
      return { count: values.length, kind: 'fields' };
    }
    default:
      return null;
  }
}

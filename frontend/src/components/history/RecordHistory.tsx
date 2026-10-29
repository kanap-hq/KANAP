import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { formatShortDateTime } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';
import { useItOpsEnumOptions } from '../../hooks/useItOpsEnumOptions';
import type { AuditCatalogList } from '../../lib/audit/auditLogValues';
import {
  historyActionText,
  historyActorText,
  historyChildTitle,
  historyLines,
  historySubjectText,
  type HistoryLine,
  type HistoryTextContext,
  type RecordHistoryItem,
  type RecordHistoryPage,
} from './recordHistoryText';

/**
 * The history of one record, newest write first: one entry per audit row, with its date and time in
 * the reader's timezone, its author, its action, and the changed fields in words. The page only
 * hands its table and its identifier: the API (`GET /records/:table/:id/history`) owns the reading
 * rights, the reference resolution and the presentation of each child kind.
 *
 * A dense list, no card: an entry is a date line and its change lines. The tab is the only title;
 * the empty state is one line. The next page loads on request, so a long history never freezes the
 * tab.
 */

export type RecordHistoryProps = {
  table: string;
  recordId: string;
};

const PAGE_SIZE = 50;
const QUERY_ROOT = 'record-history';

/**
 * The words of the empty and error states. The incident keeps its Journal tab beside the History
 * tab, and German names them "Verlauf" and "Historie": its states say "Historie".
 */
function stateKeys(table: string): { empty: string; error: string } {
  return table === 'incidents'
    ? { empty: 'auditLogs.history.incidentEmpty', error: 'auditLogs.history.incidentError' }
    : { empty: 'auditLogs.history.empty', error: 'auditLogs.history.error' };
}

/** The records whose history names IT catalog codes (categories, access methods, server roles). */
const CATALOG_TABLES = new Set(['applications', 'incidents']);

/** The catalog list of the IT settings that holds each code list of the history. */
const CATALOG_FIELDS: Record<AuditCatalogList, Parameters<ReturnType<typeof useItOpsEnumOptions>['labelFor']>[0]> = {
  applicationCategories: 'applicationCategory',
  accessMethods: 'accessMethod',
  incidentCategories: 'incidentCategories',
  serverRoles: 'serverRole',
};

/**
 * The tenant's label of a catalog code, as the record's screen shows it (`useItOpsEnumOptions`):
 * null when the tenant's catalog has no such code, so the shipped label or the code shows instead.
 */
function useCatalogLabel(table: string) {
  const { byField, labelFor } = useItOpsEnumOptions({ enabled: CATALOG_TABLES.has(table) });
  return React.useCallback((list: AuditCatalogList, code: string): string | null => {
    const field = CATALOG_FIELDS[list];
    return (byField[field] ?? []).some((option) => option.code === code) ? labelFor(field, code) : null;
  }, [byField, labelFor]);
}

function HistoryLineView({ line, separator }: { line: HistoryLine; separator: string }) {
  if (line.text) {
    return (
      <Box sx={{ mt: '2px', fontSize: 13, lineHeight: 1.5, color: 'kanap.text.primary', overflowWrap: 'anywhere' }}>
        {line.text}
      </Box>
    );
  }
  return (
    <Box sx={{ mt: '2px', fontSize: 13, lineHeight: 1.5, color: 'kanap.text.primary', overflowWrap: 'anywhere' }}>
      <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{line.label}</Box>
      {separator}
      {line.before !== undefined && (
        <>
          <Box component="span">{line.before}</Box>
          {line.after !== undefined && (
            <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{' → '}</Box>
          )}
        </>
      )}
      {line.after !== undefined && <Box component="span">{line.after}</Box>}
      {line.suffix && line.suffix.length > 0 && (
        <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` (${line.suffix.join(', ')})`}</Box>
      )}
    </Box>
  );
}

function HistoryEntry({ item, context, separator }: { item: RecordHistoryItem; context: HistoryTextContext; separator: string }) {
  const lines = historyLines(item, context);
  const childTitle = historyChildTitle(item, context.t, context.table);
  const subject = childTitle ? null : historySubjectText(item.subject, context.t, context.table);
  return (
    <Box
      component="li"
      sx={{
        py: '10px',
        borderBottom: '1px solid',
        borderColor: 'kanap.border.soft',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: '8px', rowGap: '2px' }}>
        <Box
          component="time"
          dateTime={item.at}
          sx={{ fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatShortDateTime(item.at, context.locale)}
        </Box>
        <Box component="span" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
          {historyActorText(item.actor, context.t)}
        </Box>
        {childTitle ? (
          <Box component="span" sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{childTitle}</Box>
        ) : (
          <>
            {item.subject.kind === 'record' && (
              <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
                {historyActionText(item.action, context.t)}
              </Box>
            )}
            {subject && (
              <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{subject}</Box>
            )}
          </>
        )}
      </Box>
      {lines.map((line, index) => (
        <HistoryLineView key={index} line={line} separator={separator} />
      ))}
    </Box>
  );
}

export default function RecordHistory({ table, recordId }: RecordHistoryProps) {
  const { t } = useTranslation(['admin', 'ops', 'common']);
  const locale = useLocale();
  const catalogLabel = useCatalogLabel(table);

  const history = useInfiniteQuery({
    queryKey: [QUERY_ROOT, table, recordId],
    queryFn: async ({ pageParam }) => {
      const res = await api.get<RecordHistoryPage>(
        `/records/${encodeURIComponent(table)}/${encodeURIComponent(recordId)}/history`,
        { params: { limit: PAGE_SIZE, ...(pageParam ? { cursor: pageParam } : {}) } },
      );
      return res.data;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!table && !!recordId,
    // The tab is left and shown again after a change: the history follows what was written.
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const items = React.useMemo(
    () => (history.data?.pages ?? []).flatMap((page) => page?.items ?? []),
    [history.data],
  );
  const context = React.useMemo<HistoryTextContext>(() => ({ t, locale, table, catalogLabel }), [t, locale, table, catalogLabel]);
  const separator = t('auditLogs.history.separator');

  // The pages follow audit rows, and an update that presents no change is not an entry: a page can
  // be empty while older pages still hold entries. Keep reading until an entry shows or the history
  // ends, so the tab never offers a bare "Load more" under an empty list.
  React.useEffect(() => {
    if (history.isLoading || history.isError || history.isFetchNextPageError || history.isFetchingNextPage) return;
    if (!history.hasNextPage || items.length > 0) return;
    void history.fetchNextPage();
  }, [history.data, history.isLoading, history.isError, history.isFetchNextPageError, history.isFetchingNextPage, history.hasNextPage, history.fetchNextPage, items.length]);

  if (history.isLoading) {
    return (
      <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (history.isError || history.isFetchNextPageError) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ pt: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">{t(stateKeys(table).error)}</Typography>
        <Button
          size="small"
          variant="text"
          onClick={() => { void history.refetch(); }}
          disabled={history.isFetching}
        >
          {t('common:buttons.retry')}
        </Button>
      </Stack>
    );
  }

  if (items.length === 0) {
    // The pages follow audit rows: while an older page may still hold an entry, the tab reads on
    // instead of showing an empty list.
    if (history.hasNextPage || history.isFetchingNextPage) {
      return (
        <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={20} />
        </Box>
      );
    }
    return (
      <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
        {t(stateKeys(table).empty)}
      </Typography>
    );
  }

  return (
    <Box sx={{ pt: 1 }}>
      <Box component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
        {items.map((item) => (
          <HistoryEntry key={item.id} item={item} context={context} separator={separator} />
        ))}
      </Box>
      {history.hasNextPage && (
        <Box sx={{ pt: 1 }}>
          <Button
            size="small"
            variant="text"
            onClick={() => { void history.fetchNextPage(); }}
            disabled={history.isFetchingNextPage}
          >
            {history.isFetchingNextPage ? t('common:status.loading') : t('auditLogs.history.loadMore')}
          </Button>
        </Box>
      )}
    </Box>
  );
}

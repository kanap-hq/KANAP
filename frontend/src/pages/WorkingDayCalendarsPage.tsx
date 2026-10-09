import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import { useCalendarSuggestions, useWorkingDayProfiles } from '../hooks/useWorkingDayProfiles';
import {
  WORKING_DAY_PROFILES_ENDPOINT,
  createWorkingDayProfile,
  type WorkingDayProfileListRow,
} from '../services/workingDayProfiles';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import {
  WORKING_DAY_CALENDARS_PATH,
  calendarSourceLabel,
  calendarYearsText,
  joinNames,
} from './working-day-calendars/workingDayCalendarFields';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';

const DEFAULT_SORT = 'name:ASC';

const CODE_CELL_STYLE = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
};

export default function WorkingDayCalendarsPage() {
  const { hasLevel } = useAuth();
  if (!hasLevel('working_day_profiles', 'reader')) return <ForbiddenPage />;
  return <WorkingDayCalendarsList />;
}

function WorkingDayCalendarsList() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const calendars = useWorkingDayProfiles();
  const canCreate = hasLevel('working_day_profiles', 'member');
  const canAdmin = hasLevel('working_day_profiles', 'admin');
  const suggestions = useCalendarSuggestions({ enabled: canCreate });
  const [creatingSuggested, setCreatingSuggested] = useState(false);
  const [suggestedError, setSuggestedError] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<WorkingDayProfileListRow[]>([]);
  const gridApiRef = useRef<any>(null);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: ['working-day-profiles'] });
  }, [queryClient]);

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    sp.set('sort', state?.sort || DEFAULT_SORT);
    if (state?.q) sp.set('q', state.q);
    if (state?.filters && Object.keys(state.filters).length > 0) sp.set('filters', JSON.stringify(state.filters));
    // The grid's status scope, so prev/next in the workspace walks the same set.
    if (state?.statusScope) sp.set('scope', state.statusScope);
    return sp;
  }, []);

  const getWorkspaceHref = useCallback(
    (row: WorkingDayProfileListRow) => (row?.id ? `${WORKING_DAY_CALENDARS_PATH}/${row.id}/overview?${buildWorkspaceSearch().toString()}` : null),
    [buildWorkspaceSearch],
  );

  // Country names come back in the UI language.
  const gridParams = useMemo(() => ({ lang: locale }), [locale]);

  const columns: EnhancedColDef<WorkingDayProfileListRow>[] = useMemo(() => {
    const link = (params: any) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getWorkspaceHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return [
      {
        field: 'code',
        headerName: t('workingDayCalendars.columns.code'),
        width: 140,
        required: true,
        // Code and name are searched by the quick search.
        filter: false,
        cellStyle: CODE_CELL_STYLE,
        cellRenderer: link,
      },
      {
        field: 'name',
        headerName: t('workingDayCalendars.columns.name'),
        flex: 1,
        minWidth: 220,
        required: true,
        filter: false,
        cellRenderer: link,
      },
      {
        // The server sorts and filters `country` on this same text, "France (Moselle)".
        colId: 'country',
        headerName: t('workingDayCalendars.columns.country'),
        width: 240,
        filter: 'agTextColumnFilter',
        valueGetter: (p: any) => (p.data ? calendarSourceLabel(p.data) ?? '' : ''),
        cellRenderer: link,
      },
      {
        field: 'years',
        headerName: t('workingDayCalendars.columns.years'),
        width: 220,
        sortable: false,
        filter: false,
        valueFormatter: (p: any) => calendarYearsText(t, p.data, Array.isArray(p.value) ? p.value : []),
        cellRenderer: link,
      },
      {
        field: 'status',
        headerName: t('workingDayCalendars.columns.status'),
        width: 140,
        ...statusColumnProps(t),
        // The default scope lists enabled calendars only, so the column would repeat "Enabled".
        defaultHidden: true,
        cellRenderer: link,
      },
      {
        field: 'updated_at',
        headerName: t('workingDayCalendars.columns.updated'),
        width: 180,
        filter: false,
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: link,
      },
    ];
  }, [getWorkspaceHref, locale, navigate, t]);

  // One calendar per country of the tenant's companies, code = the country code, name in the UI language.
  const createSuggested = async () => {
    if (creatingSuggested) return;
    setCreatingSuggested(true);
    setSuggestedError(null);
    const failures: string[] = [];
    for (const suggestion of suggestions) {
      try {
        await createWorkingDayProfile({
          code: suggestion.country_iso,
          name: suggestion.country_name,
          country_iso: suggestion.country_iso,
        });
      } catch (e) {
        failures.push(getApiErrorMessage(e, t, t('workingDayCalendars.messages.createFailed')));
      }
    }
    setCreatingSuggested(false);
    if (failures.length > 0) setSuggestedError(failures.join(' '));
    refresh();
  };

  const showSuggestions = canCreate && suggestions.length > 0;

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => navigate(`${WORKING_DAY_CALENDARS_PATH}/new/overview?${buildWorkspaceSearch().toString()}`)}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint={`${WORKING_DAY_PROFILES_ENDPOINT}/bulk`}
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={refresh}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('workingDayCalendars.title')} actions={actions} />
      {showSuggestions && (
        <Box data-testid="working-day-calendars-suggestions" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.5, mt: -1, mb: 1.5 }}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('workingDayCalendars.suggestions.line', {
              count: suggestions.length,
              countries: joinNames(suggestions.map((suggestion) => suggestion.country_name), locale),
            })}
          </Typography>
          <Button variant="action" size="small" onClick={() => void createSuggested()} disabled={creatingSuggested}>
            {t('workingDayCalendars.suggestions.create', { count: suggestions.length })}
          </Button>
        </Box>
      )}
      {suggestedError && (
        <Typography role="alert" sx={{ fontSize: 12, color: 'error.main', mt: -1, mb: 1.5 }}>
          {suggestedError}
        </Typography>
      )}
      {!showSuggestions && calendars.ready && !calendars.isError && calendars.profiles.length === 0 && (
        <Typography data-testid="working-day-calendars-empty" sx={{ fontSize: 13, color: 'kanap.text.tertiary', mt: -1, mb: 1.5 }}>
          {t('workingDayCalendars.emptyExplainer')}
        </Typography>
      )}
      <ServerDataGrid<WorkingDayProfileListRow>
        columns={columns}
        endpoint={WORKING_DAY_PROFILES_ENDPOINT}
        queryKey="working-day-profiles"
        extraParams={gridParams}
        getRowId={(r) => r.id}
        enableSearch
        defaultSort={{ field: 'name', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="working-day-profiles"
        enableColumnChooser
        statusScopeConfig={{ defaultScope: 'enabled' }}
        requiredColumns={['code', 'name']}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope: scope };
        }}
      />
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint={WORKING_DAY_PROFILES_ENDPOINT} title={t('workingDayCalendars.export')} flexibleFormat />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={WORKING_DAY_PROFILES_ENDPOINT}
        title={t('workingDayCalendars.import')}
        onImported={refresh}
        flexibleFormat
      />
    </>
  );
}

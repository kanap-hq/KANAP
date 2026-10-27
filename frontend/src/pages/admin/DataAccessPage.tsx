import React from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FilterListIcon from '@mui/icons-material/FilterList';
import { Link as RouterLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import ForbiddenPage from '../ForbiddenPage';
import CsvExportDialog from '../../components/csv/CsvExportDialog';
import CsvImportDialog from '../../components/csv/CsvImportDialog';
import DataAccessNodeFilterDialog from '../../components/dataAccess/DataAccessNodeFilterDialog';
import UserDialog from '../users/UserDialog';
import {
  accessLevelLabel,
  accessNodeReference,
  missingPartsText,
  type AccessNode,
  type DataAccessOverview,
} from '../../components/dataAccess/dataAccess';
import { useDataAccessAdmin } from '../../auth/dataAccess';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDocPageUrl } from '../../utils/docUrls';
import api from '../../api';

/** The budget list's set filter for the lines without a paying company (`ag-grid-filtering.ts` reads the null). */
const LINES_WITHOUT_COMPANY_URL = `/ops/budget?filters=${encodeURIComponent(JSON.stringify({
  paying_company_name: { filterType: 'set', values: [null] },
}))}`;

type NodeFilter = { type: 'company' | 'cost_center'; id: string; label: string };

const headerCellSx = { whiteSpace: 'nowrap' } as const;
const personColumnSx = { minWidth: 180 } as const;

export default function DataAccessPage() {
  const canAdmin = useDataAccessAdmin();
  if (!canAdmin) return <ForbiddenPage />;
  return <DataAccessAdminContent />;
}

function DataAccessAdminContent() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [nodeFilter, setNodeFilter] = React.useState<NodeFilter | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedPerson, setSelectedPerson] = React.useState<{ id: string; name: string } | null>(null);

  const params = React.useMemo(() => ({
    ...(nodeFilter ? { node_type: nodeFilter.type, node_id: nodeFilter.id } : {}),
    ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
  }), [debouncedSearch, nodeFilter]);
  const overviewKey = React.useMemo(() => ['data-access', params] as const, [params]);
  const { data, isLoading, error } = useQuery({
    queryKey: overviewKey,
    queryFn: async () => (await api.get<DataAccessOverview>('/data-access', { params })).data,
    placeholderData: (previous: DataAccessOverview | undefined) => previous,
  });

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['data-access'] });
  }, [queryClient]);

  const filtering = !!debouncedSearch.trim() || nodeFilter !== null;

  const pickNode = (node: AccessNode) => {
    if (node.type === 'all') return;
    setNodeFilter({ type: node.type, id: node.id ?? '', label: accessNodeReference(node, t) });
  };

  const actions = (
    <Stack direction="row" spacing={1}>
      <Button variant="action" onClick={() => setImportOpen(true)}>{t('admin:dataAccess.importCsv')}</Button>
      <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('admin:dataAccess.title')} actions={actions} />

      {data && !data.available && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 13 }}>{t('admin:dataAccess.unavailable')}</Typography>
          {data.missing.length > 0 && (
            <Typography sx={{ fontSize: 13 }}>{missingPartsText(data.missing, t)}</Typography>
          )}
          <Link
            href={getDocPageUrl('data-access', locale)}
            target="_blank"
            rel="noopener"
            underline="hover"
            sx={{ fontSize: 13 }}
          >
            {t('admin:dataAccess.guide')}
          </Link>
        </Alert>
      )}

      {data && (
        <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('admin:dataAccess.counters.limited', {
              count: data.counts.limited_persons,
              value: data.counts.limited_persons.toLocaleString(locale),
            })}
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            <Link component={RouterLink} to={LINES_WITHOUT_COMPANY_URL} underline="hover">
              {t('admin:dataAccess.counters.withoutCompany', {
                count: data.counts.lines_without_company,
                value: data.counts.lines_without_company.toLocaleString(locale),
              })}
            </Link>
          </Typography>
        </Stack>
      )}

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          variant="standard"
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('admin:dataAccess.filters.name')}
          inputProps={{ 'aria-label': t('admin:dataAccess.filters.name') }}
          sx={{ width: 260 }}
        />
        <TextField
          variant="standard"
          size="small"
          value={nodeFilter?.label ?? ''}
          placeholder={t('admin:dataAccess.filters.node')}
          onClick={() => setPickerOpen(true)}
          inputProps={{ readOnly: true, 'aria-label': t('admin:dataAccess.filters.node') }}
          InputProps={{
            readOnly: true,
            startAdornment: <FilterListIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', mr: 0.5 }} />,
            endAdornment: nodeFilter ? (
              <IconButton
                size="small"
                aria-label={t('admin:dataAccess.filters.clearNode')}
                onClick={(event) => { event.stopPropagation(); setNodeFilter(null); }}
              >
                <CloseIcon sx={{ fontSize: 14 }} />
              </IconButton>
            ) : undefined,
          }}
          sx={{ width: 280, '& .MuiInputBase-input': { cursor: 'pointer' } }}
        />
      </Stack>

      {isLoading && <CircularProgress size={20} />}
      {error && <Alert severity="error">{getApiErrorMessage(error, t, t('admin:dataAccess.loadFailed'))}</Alert>}

      {data && !isLoading && (
        data.persons.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
            {t(filtering ? 'common:filters.noResultsFiltered' : 'admin:dataAccess.empty')}
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...headerCellSx, ...personColumnSx }}>
                    {t('admin:dataAccess.columns.person')}
                  </TableCell>
                  <TableCell sx={headerCellSx}>{t('admin:dataAccess.columns.roles')}</TableCell>
                  <TableCell sx={headerCellSx}>{t('admin:dataAccess.columns.nodes')}</TableCell>
                  <TableCell sx={headerCellSx}>{t('admin:dataAccess.columns.lastChange')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.persons.map((person) => (
                  <TableRow key={person.id} hover>
                    <TableCell sx={personColumnSx}>
                      <Button
                        variant="text"
                        onClick={() => setSelectedPerson({ id: person.id, name: person.name })}
                        sx={{
                          p: 0,
                          minWidth: 0,
                          justifyContent: 'flex-start',
                          textAlign: 'left',
                          textTransform: 'none',
                          fontSize: 13,
                          color: 'kanap.text.primary',
                          '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' },
                        }}
                      >
                        {person.name}
                      </Button>
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.5 }}>{person.roles.join(', ')}</TableCell>
                    <TableCell>
                      {person.nodes.length === 0 ? (
                        <Typography sx={{ fontSize: 12.5, color: 'kanap.text.tertiary' }}>
                          {t('admin:dataAccess.none')}
                        </Typography>
                      ) : (
                        <Stack spacing={0.25}>
                          {person.nodes.map((node) => (
                            <Typography
                              key={`${node.type}:${node.id ?? ''}`}
                              sx={{ fontSize: 12.5, color: 'kanap.text.primary' }}
                            >
                              {accessNodeReference(node, t)}
                              <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
                                {' · '}
                                {accessLevelLabel(node.access, t)}
                              </Box>
                            </Typography>
                          ))}
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12.5, color: 'kanap.text.secondary' }}>
                      {person.updated_at && person.updated_by_name
                        ? t('admin:dataAccess.modified', {
                          name: person.updated_by_name,
                          date: formatShortDate(person.updated_at, locale, { year: 'always' }),
                        })
                        : person.updated_at
                          ? formatShortDate(person.updated_at, locale, { year: 'always' })
                          : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      <DataAccessNodeFilterDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={pickNode}
      />
      {selectedPerson && (
        <UserDialog
          key={selectedPerson.id}
          open
          mode="edit"
          userId={selectedPerson.id}
          personName={selectedPerson.name}
          initialTab="access"
          onClose={() => setSelectedPerson(null)}
          onSaved={refresh}
        />
      )}
      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/data-access"
        title={t('admin:dataAccess.exportTitle')}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/data-access"
        title={t('admin:dataAccess.importTitle')}
        onImported={refresh}
        flexibleFormat
      />
    </>
  );
}

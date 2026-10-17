import React from 'react';
import { Alert, Box, Button, IconButton, LinearProgress, Typography, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useKanapDialogs } from '../../components/design';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import { refusalCounts } from '../../utils/deleteRefusal';
import { getDotColor, LIFECYCLE_COLORS } from '../../utils/statusColors';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import TechnologyOverviewTab, {
  TechnologyProperties,
  type TechnologyDetail,
  type TechnologyPatch,
} from './workspace/TechnologyOverviewTab';
import TechnologyServersTab, { countServers, technologyServersKey, type TechnologyServerRow } from './workspace/TechnologyServersTab';
import TechnologyApplicationsTab, { countApplications, technologyApplicationsKey, type TechnologyApplicationsData } from './workspace/TechnologyApplicationsTab';

type TabKey = 'overview' | 'servers' | 'applications' | 'operations' | 'compliance' | 'relations';
const TAB_KEYS: TabKey[] = ['overview', 'servers', 'applications', 'operations', 'compliance', 'relations'];
// The tabs not listed here arrive with the next lots of the technology layer.
const READY_TABS = new Set<TabKey>(['overview', 'servers', 'applications']);

function TechnologyDeleteButton({ technology, onDeleted, onError }: {
  technology: TechnologyDetail;
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = React.useState(false);
  const handleClick = async () => {
    const check = await api.post<{ removes: Array<{ type: string; total: number }> }>('/technologies/delete-check', { ids: [technology.id] })
      .then((res) => res.data)
      .catch((err) => {
        // Without the count of what goes with it, the delete is not offered.
        onError(getApiErrorMessage(err, t, t('workspace.technology.messages.deleteCheckFailed')));
        return null;
      });
    if (!check) return;
    const removes = check.removes || [];
    const confirmed = await dialogs.confirm({
      title: t('common:delete.recordTitle', { name: technology.name }),
      message: removes.length
        ? t('workspace.technology.deleteMessageWithUsages', { name: technology.name, usages: refusalCounts({ usages: removes }, t, locale) })
        : t('workspace.technology.deleteMessage', { name: technology.name }),
      confirmLabel: removes.length ? t('workspace.technology.deleteAnyway') : t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.delete(`/technologies/${technology.id}`);
      await queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith('technolog') });
      onDeleted();
    } catch (err) {
      setDeleting(false);
      onError(getApiErrorMessage(err, t, t('workspace.technology.messages.deleteFailed')));
    }
  };
  return (
    <Button
      variant="action-danger"
      size="small"
      startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
      onClick={() => { void handleClick(); }}
      disabled={deleting}
    >
      {t('common:buttons.delete')}
    </Button>
  );
}

export default function TechnologyWorkspacePage() {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { byField, labelFor } = useItOpsEnumOptions();
  const [error, setError] = React.useState<string | null>(null);

  const routeId = String(params.id || '');
  const routeTab: TabKey = TAB_KEYS.includes(params.tab as TabKey) && READY_TABS.has(params.tab as TabKey) ? params.tab as TabKey : 'overview';
  const canManage = hasLevel('infrastructure', 'member');
  const canDelete = hasLevel('infrastructure', 'admin');
  const queryKey = React.useMemo(() => ['technology-workspace', routeId], [routeId]);

  const technologyQuery = useQuery({
    queryKey,
    queryFn: async () => (await api.get<TechnologyDetail>(`/technologies/${routeId}`)).data,
    enabled: !!routeId,
    placeholderData: (previous) => previous,
  });
  const technology = technologyQuery.data || null;
  // One read per tab: the badges and the tabs share these queries.
  const technologyId = technology?.id ?? '';
  const serversQuery = useQuery({
    queryKey: technologyServersKey(technologyId),
    queryFn: async () => (await api.get<{ items: TechnologyServerRow[] }>(`/technologies/${technologyId}/assets`)).data,
    enabled: !!technologyId,
  });
  const applicationsQuery = useQuery({
    queryKey: technologyApplicationsKey(technologyId),
    queryFn: async () => (await api.get<TechnologyApplicationsData>(`/technologies/${technologyId}/applications`)).data,
    enabled: !!technologyId,
  });
  const badges: Partial<Record<TabKey, number>> = {
    servers: serversQuery.data ? countServers(serversQuery.data.items) : undefined,
    applications: applicationsQuery.data?.items ? countApplications(applicationsQuery.data.items) : undefined,
  };

  const listSearch = searchParams.toString();
  const closeWorkspace = React.useCallback(() => {
    navigate(`/it/technologies${listSearch ? `?${listSearch}` : ''}`);
  }, [listSearch, navigate]);

  const setCache = React.useCallback((updater: (prev: TechnologyDetail) => TechnologyDetail) => {
    queryClient.setQueryData<TechnologyDetail>(queryKey, (prev) => (prev ? updater(prev) : prev));
  }, [queryClient, queryKey]);

  // Edits are saved one after the other, each on the latest record.
  const saveQueue = React.useRef<Promise<void>>(Promise.resolve());
  const patchTechnology = React.useCallback((patch: TechnologyPatch) => {
    const id = technology?.id;
    if (!id) return;
    setCache((prev) => ({ ...prev, ...patch }));
    saveQueue.current = saveQueue.current.then(async () => {
      setError(null);
      try {
        const res = await api.patch<TechnologyDetail>(`/technologies/${id}`, patch);
        setCache((prev) => ({ ...prev, ...res.data }));
        await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'technologies' || query.queryKey[0] === 'grid-filter-values' });
      } catch (err) {
        setError(isDuplicateError(err)
          ? t('workspace.technology.messages.duplicateName')
          : getApiErrorMessage(err, t, t('workspace.technology.messages.saveFailed')));
        await technologyQuery.refetch();
      }
    });
  }, [queryClient, setCache, t, technology?.id, technologyQuery]);

  const lifecycleOptions = React.useMemo(() => (byField.lifecycleStatus || []).map((option) => ({
    value: option.code,
    label: option.label,
    color: getDotColor(LIFECYCLE_COLORS[option.code] || 'default', theme.palette.mode),
  })), [byField.lifecycleStatus, theme.palette.mode]);

  if (!hasLevel('infrastructure', 'reader')) {
    return <Box sx={{ p: 2 }}><Alert severity="error">{t('workspace.technology.notFound')}</Alert></Box>;
  }

  if (technologyQuery.isLoading && !technology) {
    return (
      <Box sx={{ p: 2 }}>
        <LinearProgress sx={{ mb: 2 }} />
        <Typography variant="body2" color="text.secondary">{t('workspace.technology.loading')}</Typography>
      </Box>
    );
  }

  if (technologyQuery.error || !technology) {
    return <Box sx={{ p: 2 }}><Alert severity="error">{t('workspace.technology.notFound')}</Alert></Box>;
  }

  const tabs = TAB_KEYS.map((key) => ({
    key,
    label: t(`workspace.technology.tabs.${key}`),
    disabled: !READY_TABS.has(key),
    badge: badges[key],
  }));

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!!error && <Alert severity="error" sx={{ mx: 2, mt: 1 }}>{error}</Alert>}
      <PortfolioDetailWorkspaceShell
        activeTab={routeTab}
        tabs={tabs}
        onTabChange={(next) => navigate(`/it/technologies/${technology.reference}/${next}${listSearch ? `?${listSearch}` : ''}`)}
        drawerStorageKey="kanap.technologies.drawerOpen"
        backLabel={t('pages.technologies.title')}
        onBack={closeWorkspace}
        itemReference={technology.reference}
        onCopyReference={() => { void navigator.clipboard?.writeText(technology.reference); }}
        title={technology.name}
        titleFallback={t('workspace.technology.untitled')}
        canEditTitle={canManage}
        onTitleSave={(value) => { if (value.trim()) patchTechnology({ name: value.trim() }); }}
        metadata={(
          <>
            <PortfolioStatusMetadata
              value={technology.lifecycle || 'active'}
              label={labelFor('lifecycleStatus', technology.lifecycle) || t('common:selects.notSet')}
              color={getDotColor(LIFECYCLE_COLORS[technology.lifecycle] || 'default', theme.palette.mode)}
              options={lifecycleOptions}
              onChange={(value) => patchTechnology({ lifecycle: value })}
              disabled={!canManage}
            />
            <PortfolioMetadataItem label={t('workspace.technology.fields.family')}>
              {labelFor('technologyFamily', technology.family) || t('common:selects.notSet')}
            </PortfolioMetadataItem>
          </>
        )}
        actions={(
          <>
            {canDelete && <TechnologyDeleteButton technology={technology} onDeleted={closeWorkspace} onError={setError} />}
            <IconButton aria-label={t('common:buttons.close')} title={t('common:buttons.close')} onClick={closeWorkspace} size="small">
              <CloseIcon />
            </IconButton>
          </>
        )}
        properties={(
          <TechnologyProperties
            technology={technology}
            canManage={canManage}
            onPatch={patchTechnology}
            onOwnersChange={(owners) => setCache((prev) => ({ ...prev, owners }))}
            onError={setError}
          />
        )}
      >
        {routeTab === 'overview' && (
          <TechnologyOverviewTab
            technology={technology}
            canManage={canManage}
            onPatch={patchTechnology}
            onVersionsChanged={async () => { await technologyQuery.refetch(); }}
            onError={setError}
          />
        )}
        {routeTab === 'servers' && (
          <TechnologyServersTab technologyId={technology.id} versions={technology.versions} canManage={canManage} />
        )}
        {routeTab === 'applications' && (
          <TechnologyApplicationsTab
            technologyId={technology.id}
            technologyReference={technology.reference}
            versions={technology.versions}
            canManage={canManage}
          />
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

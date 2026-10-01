import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, Divider, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useContractNav } from '../../hooks/useContractNav';
import ContractOverviewEditor, { ContractOverviewEditorHandle } from './editors/ContractOverviewEditor';
import ContractDetailsEditor, { ContractDetailsEditorHandle } from './editors/ContractDetailsEditor';
import ContractRelationsEditor, { ContractRelationsEditorHandle } from './editors/ContractRelationsEditor';
import EntityTasksPanel from '../../components/EntityTasksPanel';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { useKanapDialogs } from '../../components/design';

type TabKey = 'overview' | 'details' | 'relations' | 'tasks';

// Tab labels resolved inside component

export default function ContractWorkspacePage() {
  const { t } = useTranslation(['ops', 'common']);
  const dialogs = useKanapDialogs();
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: t('contracts.tabs.overview') },
    { key: 'details', label: t('contracts.tabs.details') },
    { key: 'relations', label: t('contracts.tabs.relations') },
    { key: 'tasks', label: t('contracts.tabs.tasks') },
  ];
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { hasLevel } = useAuth();
  const { addToRecent } = useRecentlyViewed();

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const id = idParam;
  const routeTab = (params.tab as TabKey) || 'overview';

  const sort = searchParams.get('sort');
  const q = searchParams.get('q');
  const filters = searchParams.get('filters');
  const statusScope = searchParams.get('scope');

  const nav = useContractNav({ id, sort, q, filters, statusScope });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }
    : nav;

  const { data, error } = useQuery({
    queryKey: ['contracts', id],
    queryFn: async () => { const res = await api.get(`/contracts/${id}`); return res.data; },
    enabled: !isCreate,
  });

  // Track recently viewed
  React.useEffect(() => {
    if (data?.id && data?.name) {
      addToRecent('contract', data.id, data.name);
    }
  }, [data?.id, data?.name, addToRecent]);

  const overviewRef = React.useRef<ContractOverviewEditorHandle>(null);
  const detailsRef = React.useRef<ContractDetailsEditorHandle>(null);
  const relationsRef = React.useRef<ContractRelationsEditorHandle>(null);

  const [dirty, setDirty] = React.useState(false);
  const updateDirty = React.useCallback((d: boolean) => setDirty(d), []);

  const canManageContracts = hasLevel('contracts', 'manager');
  const readOnly = !canManageContracts;
  const saveDisabled = !dirty || readOnly;

  const handleSave = async () => {
    const active = routeTab;
    try {
      if (active === 'overview') {
        const newId = await overviewRef.current?.save();
        if (newId && isCreate) {
          const sp = new URLSearchParams(searchParams);
          // After creating a contract, switch directly to Details
          navigate(`/ops/contracts/${newId}/details?${sp.toString()}`);
          setDirty(false);
          return;
        }
      } else if (active === 'details') {
        await detailsRef.current?.save();
      } else if (active === 'relations') {
        await relationsRef.current?.save();
      }
      setDirty(false);
    } catch {
      // child components handle error display
    }
  };

  const handleReset = () => {
    const active = routeTab;
    if (active === 'overview') overviewRef.current?.reset();
    if (active === 'details') detailsRef.current?.reset();
    if (active === 'relations') relationsRef.current?.reset();
    setDirty(false);
  };

  const confirmAndNavigate = async (targetId: string | null) => {
    if (!targetId) return;
    if (dirty) {
      const proceed = await dialogs.confirm(t('confirmations.unsavedNavigate'));
      if (proceed) {
        try { await handleSave(); } catch { return; }
      } else {
        handleReset();
      }
    }
    navigate(`/ops/contracts/${targetId}/${routeTab}?${searchParams.toString()}`);
  };

  const handlePrev = () => { void confirmAndNavigate(prevId); };
  const handleNext = () => { void confirmAndNavigate(nextId); };

  const onTabChange = async (_: React.SyntheticEvent, nextValue: TabKey) => {
    if (isCreate && nextValue !== 'overview') return;
    if (dirty) {
      const proceed = await dialogs.confirm(t('confirmations.unsavedSwitchTab'));
      if (proceed) {
        void handleSave().then(() => navigate(`/ops/contracts/${id}/${nextValue}?${searchParams.toString()}`));
        return;
      } else {
        handleReset();
      }
    }
    navigate(`/ops/contracts/${id}/${nextValue}?${searchParams.toString()}`);
  };

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    if (statusScope) sp.set('scope', statusScope);
    return sp;
  }, [filters, q, sort, statusScope]);

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack>
          <Typography variant="h6">
            {isCreate ? t('contracts.workspace.newContract') : (data?.name || t('contracts.workspace.contract'))}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {!isCreate && total > 0 ? t('contracts.workspace.contractOf', { index: index + 1, total }) : ''}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button onClick={handlePrev} disabled={!hasPrev}>{t('contracts.workspace.prev')}</Button>
          <Button onClick={handleReset} disabled={!dirty}>{t('common:buttons.reset')}</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saveDisabled}>{t('common:buttons.saveChanges')}</Button>
          <Button onClick={handleNext} disabled={!hasNext}>{t('contracts.workspace.next')}</Button>
          <IconButton
            aria-label="Close"
            title="Close"
            onClick={() => {
              const qs = listContextParams.toString();
              navigate(`/ops/contracts${qs ? `?${qs}` : ''}`);
            }}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>

      {!!error && <Alert severity="error">{t('contracts.workspace.failedToLoad')}</Alert>}

      <Divider sx={{ mb: 2 }} />

      <Box sx={{ display: 'flex', minHeight: 420 }}>
        <Tabs
          orientation="vertical"
          value={routeTab}
          onChange={(_, value) => onTabChange(null as any, value as TabKey)}
          sx={{ borderRight: 1, borderColor: 'divider', minWidth: 160 }}
        >
          {tabs.map((t) => (
            <Tab
              key={t.key}
              label={t.label}
              value={t.key}
              // During creation, only Overview tab is available
              disabled={isCreate && t.key !== 'overview'}
            />
          ))}
        </Tabs>

        <Box sx={{ flex: 1, pl: 3 }}>
          {routeTab === 'overview' && (
            <ContractOverviewEditor ref={overviewRef} id={isCreate ? undefined : id} readOnly={readOnly} onDirtyChange={updateDirty} />
          )}

          {routeTab === 'details' && (
            <ContractDetailsEditor ref={detailsRef} id={isCreate ? undefined : id} readOnly={readOnly} onDirtyChange={updateDirty} />
          )}

          {routeTab === 'relations' && !isCreate && (
            <ContractRelationsEditor ref={relationsRef} id={id} readOnly={readOnly} onDirtyChange={updateDirty} />
          )}

          {routeTab === 'tasks' && !isCreate && (
            <EntityTasksPanel entityType="contract" entityId={id} disabled={readOnly} />
          )}
        </Box>
      </Box>
    </Box>
  );
}

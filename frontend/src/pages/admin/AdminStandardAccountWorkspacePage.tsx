import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Box, Button, Divider, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import CloseIcon from '@mui/icons-material/Close';
import AccountOverviewEditor, { AccountOverviewEditorHandle } from '../accounts/editors/AccountOverviewEditor';
import AccountCreateEditor, { AccountCreateEditorHandle } from '../accounts/editors/AccountCreateEditor';
import { useTemplateAccountNav } from '../../hooks/useTemplateAccountNav';
import { unsavedConfirm, useKanapDialogs } from '../../components/design';

type TabKey = 'overview';

export default function AdminStandardAccountWorkspacePage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['admin', 'common']);
  const dialogs = useKanapDialogs();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const templateId = String(params.templateId || '');
  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const id = idParam;
  const routeTab = (params.tab as TabKey) || 'overview';
  const tabs: Array<{ key: TabKey; label: string }> = [{ key: 'overview', label: t('standardAccountWorkspace.tabs.overview') }];

  const sort = searchParams.get('sort');
  const q = searchParams.get('q');
  const filters = searchParams.get('filters');

  const nav = useTemplateAccountNav({ templateId, id, sort, q, filters });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }
    : nav;

  const overviewRef = React.useRef<AccountOverviewEditorHandle>(null);
  const overviewCreateRef = React.useRef<AccountCreateEditorHandle>(null);

  const [dirty, setDirty] = React.useState(false);
  const updateDirty = React.useCallback((d: boolean) => setDirty(d), []);

  const basePath = `/admin/coa-templates/${templateId}/accounts`;

  const handleSave = async () => {
    try {
      if (routeTab === 'overview') {
        if (isCreate) {
          const newId = await overviewCreateRef.current?.save();
          if (newId) {
            const sp = new URLSearchParams(searchParams);
            navigate(`/admin/standard-accounts/${templateId}/${newId}/overview?${sp.toString()}`);
          }
        } else {
          await overviewRef.current?.save();
        }
      }
      setDirty(false);
    } catch {
      // handled by child editors
    }
  };

  const handleReset = () => {
    if (routeTab === 'overview') {
      if (isCreate) overviewCreateRef.current?.reset(); else overviewRef.current?.reset();
    }
    setDirty(false);
  };

  // Previous/next keep the two answers from #825. Close also offers Stay.
  const confirmDirtyLeave = async (withStay = false): Promise<boolean> => {
    if (!dirty) return true;
    const labels = unsavedConfirm(t, 'saveAndLeave');
    const outcome = withStay
      ? await dialogs.confirmOutcome({ ...labels, stayLabel: t('common:unsaved.leaveWithoutSaving.cancel') })
      : ((await dialogs.confirm(labels)) ? 'confirm' : 'cancel');
    if (outcome === 'stay') return false;
    if (outcome === 'confirm') {
      try { await handleSave(); } catch { return false; }
    } else {
      handleReset();
    }
    return true;
  };

  const confirmAndNavigate = async (targetId: string | null) => {
    if (!targetId) return;
    if (!(await confirmDirtyLeave())) return;
    navigate(`/admin/standard-accounts/${templateId}/${targetId}/${routeTab}?${searchParams.toString()}`);
  };

  const handlePrev = () => { void confirmAndNavigate(prevId); };
  const handleNext = () => { void confirmAndNavigate(nextId); };

  const onTabChange = async (_: React.SyntheticEvent, nextValue: TabKey) => {
    if (isCreate && nextValue !== 'overview') return;
    if (dirty) {
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndSwitch'));
      if (proceed) {
        void handleSave().then(() => navigate(`/admin/standard-accounts/${templateId}/${id}/${nextValue}?${searchParams.toString()}`));
        return;
      } else {
        handleReset();
      }
    }
    navigate(`/admin/standard-accounts/${templateId}/${id}/${nextValue}?${searchParams.toString()}`);
  };

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    return sp;
  }, [filters, q, sort]);

  const closeToList = () => {
    const qs = listContextParams.toString();
    navigate(`/admin/standard-accounts${qs ? `?${qs}` : ''}`);
  };

  const handleClose = async () => {
    if (!(await confirmDirtyLeave(true))) return;
    closeToList();
  };

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack>
          <Typography variant="h6">
            {isCreate ? t('standardAccountWorkspace.newTitle') : t('standardAccountWorkspace.title', { id })}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {!isCreate && total > 0 ? t('standardAccountWorkspace.position', { current: index + 1, total }) : ''}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button onClick={handlePrev} disabled={!hasPrev}>{t('shared.labels.prev')}</Button>
          <Button onClick={handleReset} disabled={!dirty}>{t('common:buttons.reset')}</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={!dirty}>{t('common:buttons.save')}</Button>
          <Button onClick={handleNext} disabled={!hasNext}>{t('shared.labels.next')}</Button>
          <IconButton
            aria-label={t('common:buttons.close')}
            title={t('common:buttons.close')}
            onClick={() => { void handleClose(); }}
          >
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      <Box sx={{ display: 'flex', minHeight: 420 }}>
        <Tabs
          orientation="vertical"
          value={routeTab}
          onChange={(_, value) => onTabChange(null as any, value as TabKey)}
          sx={{ borderRight: 1, borderColor: 'divider', minWidth: 160 }}
        >
          {tabs.map((t) => (
            <Tab key={t.key} label={t.label} value={t.key} disabled={isCreate && t.key !== 'overview'} />
          ))}
        </Tabs>

        <Box sx={{ flex: 1, pl: 3 }}>
          {routeTab === 'overview' && (
            isCreate ? (
              <AccountCreateEditor
                ref={overviewCreateRef}
                onDirtyChange={updateDirty}
                basePath={basePath}
                extractCreatedId={(data) => String(data?.account_number ?? '') || null}
              />
            ) : (
              <AccountOverviewEditor
                ref={overviewRef}
                id={id}
                onDirtyChange={updateDirty}
                basePath={basePath}
              />
            )
          )}
        </Box>
      </Box>
    </Box>
  );
}

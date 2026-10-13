import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Divider, IconButton, Stack, Tab, Tabs, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import ContactOverviewEditor, { ContactOverviewEditorHandle } from './editors/ContactOverviewEditor';
import ContactCreateEditor, { ContactCreateEditorHandle } from './editors/ContactCreateEditor';
import { useKanapDialogs } from '../../components/design';

type TabKey = 'overview';
const tabs: Array<{ key: TabKey; label: string }> = [ { key: 'overview', label: 'Overview' } ];

export default function ContactWorkspacePage() {
  const navigate = useNavigate();
  const { t } = useTranslation(['master-data', 'common']);
  const dialogs = useKanapDialogs();
  const [searchParams] = useSearchParams();
  const params = useParams();
  const { hasLevel } = useAuth();

  const idParam = String(params.id || '');
  const isCreate = idParam === 'new';
  const id = idParam;
  const routeTab = (params.tab as TabKey) || 'overview';

  const qc = useQueryClient();
  const overviewRef = React.useRef<ContactOverviewEditorHandle>(null);
  const overviewCreateRef = React.useRef<ContactCreateEditorHandle>(null);

  const [dirty, setDirty] = React.useState(false);
  const updateDirty = React.useCallback((d: boolean) => setDirty(d), []);

  const returnTo = searchParams.get('returnTo');

  const navigateAfterSave = React.useCallback(() => {
    if (returnTo) {
      // Invalidate supplier-contacts so the supplier page shows the new contact
      const supplierIdParam = searchParams.get('supplier_id');
      if (supplierIdParam) {
        void qc.invalidateQueries({ queryKey: ['supplier-contacts', supplierIdParam] });
      }
      navigate(returnTo);
    } else {
      // Strip prefill params, keep other search params for default navigation
      const qs = new URLSearchParams(searchParams);
      qs.delete('returnTo');
      qs.delete('supplier_id');
      qs.delete('supplier_role');
      const remaining = qs.toString();
      navigate(`/master-data/contacts${remaining ? `?${remaining}` : ''}`);
    }
  }, [returnTo, searchParams, navigate, qc]);

  // True once the editor saved. An invalid form shows its field errors and a server error shows in
  // the editor's alert: either way the page stays open with its changes.
  const handleSave = async (): Promise<boolean> => {
    if (routeTab !== 'overview') return false;
    try {
      const saved = isCreate
        ? await overviewCreateRef.current?.save()
        : await overviewRef.current?.save();
      if (!saved) return false;
    } catch {
      return false;
    }
    navigateAfterSave();
    setDirty(false);
    return true;
  };

  const handleReset = () => {
    if (routeTab === 'overview') {
      if (isCreate) overviewCreateRef.current?.reset(); else overviewRef.current?.reset();
    }
    setDirty(false);
  };

  const onTabChange = async (_: React.SyntheticEvent, nextValue: TabKey) => {
    if (isCreate && nextValue !== 'overview') return;
    if (dirty) {
      const proceed = await dialogs.confirm(t('shared.workspace.unsavedSwitchTab'));
      if (proceed) {
        void handleSave().then((saved) => saved && navigate(`/master-data/contacts/${id}/${nextValue}?${searchParams.toString()}`));
        return;
      } else {
        handleReset();
      }
    }
    navigate(`/master-data/contacts/${id}/${nextValue}?${searchParams.toString()}`);
  };

  const canManage = hasLevel('contacts', 'manager');
  const saveDisabled = !dirty || !canManage;

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Stack>
          <Typography variant="h6">{isCreate ? t('contacts.newContact') : t('contacts.contactFallback')}</Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Button onClick={handleReset} disabled={!dirty}>Reset</Button>
          <Button variant="contained" onClick={() => void handleSave()} disabled={saveDisabled}>Save</Button>
          <IconButton aria-label="Close" title="Close" onClick={() => {
            if (returnTo) {
              navigate(returnTo);
            } else {
              const qs = searchParams.toString();
              navigate(`/master-data/contacts${qs ? `?${qs}` : ''}`);
            }
          }}>
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 2 }} />

      <Box sx={{ display: 'flex', minHeight: 420 }}>
        <Tabs orientation="vertical" value={routeTab} onChange={(_, value) => onTabChange(null as any, value as TabKey)} sx={{ borderRight: 1, borderColor: 'divider', minWidth: 160 }}>
          {tabs.map((t) => <Tab key={t.key} label={t.label} value={t.key} disabled={isCreate && t.key !== 'overview'} />)}
        </Tabs>
        <Box sx={{ flex: 1, pl: 3 }}>
          {routeTab === 'overview' && (
            isCreate
              ? <ContactCreateEditor ref={overviewCreateRef} onDirtyChange={updateDirty} />
              : <ContactOverviewEditor ref={overviewRef} id={id} onDirtyChange={updateDirty} readOnly={!canManage} />
          )}
        </Box>
      </Box>
    </Box>
  );
}

import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design/PropertyRow';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import LocationPropertiesDrawer from './workspace/LocationPropertiesDrawer';
import LocationMetadataBar from './workspace/LocationMetadataBar';
import LocationOverviewTab from './workspace/LocationOverviewTab';
import LocationContactsTab from './workspace/LocationContactsTab';
import LocationRelationsTab from './workspace/LocationRelationsTab';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useLocationItemNav } from '../../hooks/useModuleItemNav';
import { drawerSelectSx, drawerMenuItemSx, drawerFieldValueSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { carryListFilters } from '../../lib/listContext';

type TabKey = 'overview' | 'contacts' | 'relations';

type LocationRecord = {
  id: string;
  location_reference: string;
  name: string;
  hosting_type: string;
  operating_company_id: string | null;
  country_iso: string | null;
  city: string | null;
  provider: string | null;
  region: string | null;
  additional_info: string | null;
};

type HostingCategory = 'on_prem' | 'cloud';

const TAB_KEYS: TabKey[] = ['overview', 'contacts', 'relations'];

export default function LocationWorkspacePage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const routeId = String(params.id || '');
  const isCreate = routeId === 'new';
  const isLocationReferenceRoute = /^LOC-\d+(?:-.+)?$/i.test(routeId);
  const rawTab = (params.tab as TabKey) || 'overview';
  const validTab: TabKey = TAB_KEYS.includes(rawTab) ? rawTab : 'overview';

  const canManage = hasLevel('locations', 'member');
  const canDelete = hasLevel('locations', 'member');

  const { settings, byField } = useItOpsEnumOptions();
  const hostingOptions = byField.hostingType || [];

  const [data, setData] = React.useState<LocationRecord | null>(null);
  const [loading, setLoading] = React.useState(!isCreate);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [operatingCompanyName, setOperatingCompanyName] = React.useState<string | null>(null);
  const [subLocationsCount, setSubLocationsCount] = React.useState(0);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [pendingHostingType, setPendingHostingType] = React.useState<string | null>(null);

  // Create state
  const [createName, setCreateName] = React.useState('');
  const [createHostingType, setCreateHostingType] = React.useState<string>('');
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const subItemsAnchorRef = React.useRef<HTMLDivElement>(null);
  const locationId = React.useMemo(() => {
    if (isCreate) return '';
    if (data?.id) return data.id;
    return isLocationReferenceRoute ? '' : routeId;
  }, [data?.id, isCreate, isLocationReferenceRoute, routeId]);
  const workspaceRouteId = data?.location_reference || (isCreate ? 'new' : routeId);
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && data?.id && data?.name) addToRecent('location', data.id, data.name, data.location_reference || undefined);
  }, [addToRecent, data?.id, data?.name, data?.location_reference, isCreate]);
  const routeMatchesLoadedLocation = React.useMemo(() => {
    if (isCreate || !data) return false;
    if (routeId === data.id) return true;
    const routeKey = routeId.toUpperCase();
    const reference = data.location_reference?.toUpperCase();
    return !!reference && (routeKey === reference || routeKey.startsWith(`${reference}-`));
  }, [data, isCreate, routeId]);

  const getHostingCategory = React.useCallback(
    (hostingType: string | null | undefined): HostingCategory => {
      if (!hostingType) return 'cloud';
      const opt = settings?.hostingTypes?.find((item) => item.code === hostingType);
      return opt?.category === 'on_prem' ? 'on_prem' : 'cloud';
    },
    [settings?.hostingTypes],
  );

  React.useEffect(() => {
    if (isCreate && !createHostingType && hostingOptions.length > 0) {
      setCreateHostingType(hostingOptions[0].code);
    }
  }, [isCreate, createHostingType, hostingOptions]);

  const load = React.useCallback(async () => {
    if (isCreate || !routeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/locations/${routeId}`);
      const payload = res.data as LocationRecord;
      setData(payload);
      if (payload.operating_company_id) {
        try {
          const companyRes = await api.get(`/companies/${payload.operating_company_id}`);
          setOperatingCompanyName((companyRes.data as any)?.name || null);
        } catch {
          setOperatingCompanyName(null);
        }
      } else {
        setOperatingCompanyName(null);
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadLocationFailed')));
    } finally {
      setLoading(false);
    }
  }, [isCreate, routeId, t]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (isCreate || !data?.location_reference) return;
    if (!routeMatchesLoadedLocation) return;
    if (routeId.toUpperCase() === data.location_reference.toUpperCase()) return;
    const qs = searchParams.toString();
    window.history.replaceState(null, '', `/it/locations/${data.location_reference}/${validTab}${qs ? `?${qs}` : ''}`);
  }, [data?.location_reference, isCreate, navigate, routeId, routeMatchesLoadedLocation, searchParams, validTab]);

  React.useEffect(() => {
    let cancelled = false;
    if (locationId) {
      api.get(`/locations/${locationId}/sub-items`).then((res) => {
        if (!cancelled) setSubLocationsCount(((res.data || []) as unknown[]).length);
      }).catch(() => {
        if (!cancelled) setSubLocationsCount(0);
      });
    }
    return () => { cancelled = true; };
  }, [locationId]);

  const patchLocation = React.useCallback(
    async (patch: Partial<LocationRecord>) => {
      if (!locationId) return;
      setSaving(true);
      setData((prev) => (prev ? { ...prev, ...patch } as LocationRecord : prev));
      try {
        const res = await api.patch(`/locations/${locationId}`, patch);
        setData(res.data as LocationRecord);
        setError(null);
      } catch (e: any) {
        setError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load, locationId, t],
  );

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    carryListFilters(sp, searchParams);
    return sp;
  }, [searchParams]);

  const handleClose = React.useCallback(() => {
    const qs = listContextParams.toString();
    navigate(`/it/locations${qs ? `?${qs}` : ''}`);
  }, [listContextParams, navigate]);

  const handleTabChange = React.useCallback(
    (nextTab: string) => {
      if (nextTab === validTab) return;
      const qs = searchParams.toString();
      const targetId = workspaceRouteId;
      navigate(`/it/locations/${targetId}/${nextTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab, workspaceRouteId],
  );

  const handleTitleSave = React.useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!trimmed || !data || trimmed === data.name) return;
      void patchLocation({ name: trimmed });
    },
    [data, patchLocation],
  );

  const handleHostingTypeChange = React.useCallback(
    (next: string) => {
      if (!data || next === data.hosting_type) return;
      const prevCategory = getHostingCategory(data.hosting_type);
      const nextCategory = getHostingCategory(next);
      if (prevCategory !== nextCategory) {
        setPendingHostingType(next);
        return;
      }
      void patchLocation({ hosting_type: next });
    },
    [data, getHostingCategory, patchLocation],
  );

  const handleConfirmHostingBascule = React.useCallback(async () => {
    if (!pendingHostingType) return;
    const next = pendingHostingType;
    setPendingHostingType(null);
    await patchLocation({ hosting_type: next });
  }, [patchLocation, pendingHostingType]);

  const handleOperatingCompanyChange = React.useCallback(
    async (companyId: string | null) => {
      if (!data) return;
      if (companyId === data.operating_company_id) return;
      void patchLocation({ operating_company_id: companyId });
      if (companyId) {
        try {
          const res = await api.get(`/companies/${companyId}`);
          setOperatingCompanyName((res.data as any)?.name || null);
        } catch {
          setOperatingCompanyName(null);
        }
      } else {
        setOperatingCompanyName(null);
      }
    },
    [data, patchLocation],
  );

  const handleProviderChange = React.useCallback(
    (next: string) => {
      if (!data) return;
      const cleaned = (next || '').trim() || null;
      if (cleaned === data.provider) return;
      void patchLocation({ provider: cleaned });
    },
    [data, patchLocation],
  );

  const handleRegionChange = React.useCallback(
    (next: string) => {
      if (!data) return;
      const cleaned = (next || '').trim() || null;
      if (cleaned === data.region) return;
      void patchLocation({ region: cleaned });
    },
    [data, patchLocation],
  );

  const handleCountryChange = React.useCallback(
    (iso: string) => {
      if (!data) return;
      const cleaned = (iso || '').toUpperCase() || null;
      if (cleaned === data.country_iso) return;
      void patchLocation({ country_iso: cleaned });
    },
    [data, patchLocation],
  );

  const handleCityChange = React.useCallback(
    (next: string) => {
      if (!data) return;
      const cleaned = (next || '').trim() || null;
      if (cleaned === data.city) return;
      void patchLocation({ city: cleaned });
    },
    [data, patchLocation],
  );

  const handleCreate = async () => {
    if (!canManage) return;
    const name = createName.trim();
    if (!name) {
      setCreateError(t('messages.nameRequired'));
      return;
    }
    if (!createHostingType) {
      setCreateError(t('messages.hostingTypeRequired'));
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await api.post('/locations', {
        name,
        hosting_type: createHostingType,
      });
      const saved = res.data as LocationRecord;
      navigate(`/it/locations/${saved.location_reference || saved.id}/overview`, { replace: true });
    } catch (e: any) {
      setCreateError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!locationId || !canDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/locations/${locationId}`);
      handleClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.deleteLocationFailed')));
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const navSort = searchParams.get('sort') || '';
  const navQ = searchParams.get('q') || '';
  const navFilters = searchParams.get('filters') || '';
  const navState = useLocationItemNav({
    id: locationId,
    sort: navSort,
    q: navQ,
    filters: navFilters,
  });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate || !locationId
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as string | null, nextId: null as string | null }
    : navState;

  const goToLocation = React.useCallback(
    (targetId: string | null) => {
      if (!targetId) return;
      const qs = searchParams.toString();
      navigate(`/it/locations/${targetId}/${validTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab],
  );

  const handleScrollToSubLocations = () => {
    if (validTab !== 'overview') {
      handleTabChange('overview');
      setTimeout(() => {
        subItemsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return;
    }
    subItemsAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const workspaceTabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: t('workspace.location.tabs.overview') },
    { key: 'contacts', label: t('workspace.location.tabs.contacts'), disabled: isCreate },
    { key: 'relations', label: t('workspace.location.tabs.relations'), disabled: isCreate },
  ];

  const title = isCreate
    ? createName
    : data?.name || '';

  const category: HostingCategory = data ? getHostingCategory(data.hosting_type) : 'cloud';

  const drawerProperties = data ? (
    <LocationPropertiesDrawer
      data={{
        hosting_type: data.hosting_type,
        operating_company_id: data.operating_company_id,
        provider: data.provider,
        region: data.region,
        country_iso: data.country_iso,
        city: data.city,
      }}
      category={category}
      disabled={!canManage || saving}
      onHostingTypeChange={handleHostingTypeChange}
      onOperatingCompanyChange={handleOperatingCompanyChange}
      onProviderChange={handleProviderChange}
      onRegionChange={handleRegionChange}
      onCountryChange={handleCountryChange}
      onCityChange={handleCityChange}
    />
  ) : (
    <Box />
  );

  const metadata = !isCreate && data ? (
    <LocationMetadataBar
      hostingType={data.hosting_type}
      category={category}
      operatingCompanyId={data.operating_company_id}
      operatingCompanyName={operatingCompanyName}
      provider={data.provider}
      region={data.region}
      countryIso={data.country_iso}
      city={data.city}
      subLocationsCount={subLocationsCount}
      disabled={!canManage || saving}
      onHostingTypeChange={handleHostingTypeChange}
      onOperatingCompanyChange={handleOperatingCompanyChange}
      onProviderChange={handleProviderChange}
      onRegionChange={handleRegionChange}
      onCountryChange={handleCountryChange}
      onCityChange={handleCityChange}
      onSubLocationsClick={handleScrollToSubLocations}
    />
  ) : undefined;

  const actions = (
    <>
      {isCreate && (
        <Button
          variant="contained"
          onClick={() => void handleCreate()}
          disabled={createSubmitting || !canManage}
          size="small"
        >
          {t('common:buttons.create')}
        </Button>
      )}
      {!isCreate && data && (
        <SendLinkButton
          itemType="location"
          itemId={data.id}
          itemRef={data.location_reference || null}
          itemName={data.name || t('workspace.location.untitled')}
        />
      )}
      {!isCreate && canDelete && (
        <Button
          variant="action-danger"
          startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
          size="small"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={deleting}
        >
          {t('common:buttons.delete')}
        </Button>
      )}
    </>
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      <PortfolioDetailWorkspaceShell
        activeTab={validTab}
        tabs={workspaceTabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.locations.drawerOpen"
        backLabel={t('pages.locations.title')}
        onBack={handleClose}
        itemReference={!isCreate ? data?.location_reference || null : null}
        onCopyReference={
          !isCreate && data?.location_reference
            ? () => { void navigator.clipboard?.writeText(data.location_reference); }
            : undefined
        }
        title={title}
        titleFallback={isCreate ? t('workspace.location.newTitle') : t('workspace.location.untitled')}
        canEditTitle={canManage && !isCreate}
        onTitleSave={handleTitleSave}
        isCreate={isCreate}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => goToLocation(prevId),
          onNext: () => goToLocation(nextId),
          previousLabel: t('workspace.location.previous'),
          nextLabel: t('workspace.location.next'),
        } : undefined}
        metadata={metadata}
        actions={actions}
        properties={drawerProperties}
      >
        {isCreate ? (
          <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
            <PropertyRow label={t('common.name')} required valueSx={{ maxWidth: 520 }}>
              <TextField
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t('workspace.location.namePlaceholder')}
                required
                size="small"
                variant="standard"
                sx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('pages.locations.columns.hostingType')} required valueSx={{ maxWidth: 520 }}>
              <TextField
                select
                value={createHostingType}
                onChange={(e) => setCreateHostingType(e.target.value)}
                size="small"
                variant="standard"
                sx={drawerSelectSx}
              >
                {hostingOptions.map((opt) => (
                  <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                    {opt.deprecated ? t('common.deprecatedOption', { label: opt.label }) : opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </PropertyRow>
            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        ) : !data ? null : (
          <>
            {validTab === 'overview' && (
              <LocationOverviewTab
                locationId={data.id}
                initialNotes={data.additional_info || ''}
                canManage={canManage}
                onSubLocationsCountChange={setSubLocationsCount}
                subItemsAnchorRef={subItemsAnchorRef}
              />
            )}
            {validTab === 'contacts' && (
              <LocationContactsTab locationId={data.id} canManage={canManage} />
            )}
            {validTab === 'relations' && (
              <LocationRelationsTab locationId={data.id} />
            )}
          </>
        )}
      </PortfolioDetailWorkspaceShell>

      <KanapDialog
        open={deleteDialogOpen}
        title={t('workspace.location.deleteTitle')}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        onSave={handleDelete}
        saveLabel={t('common:buttons.delete')}
        saveDisabled={deleting}
        saveLoading={deleting}
      >
        <Stack spacing={1}>
          <Box sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {t('workspace.location.deleteMessage')}
          </Box>
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={!!pendingHostingType}
        title={t('workspace.location.changeHostingTitle')}
        onClose={() => setPendingHostingType(null)}
        onSave={handleConfirmHostingBascule}
        saveLabel={t('common:buttons.continue')}
        saveDisabled={saving}
        saveLoading={saving}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {pendingHostingType && data && getHostingCategory(pendingHostingType) === 'on_prem'
              ? t('workspace.location.switchToOnPrem')
              : t('workspace.location.switchToCloud')}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
            {t('workspace.location.savesOnConfirm')}
          </Typography>
        </Stack>
      </KanapDialog>
    </Box>
  );
}

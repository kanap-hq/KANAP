import React from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import KanapDialog from '../../components/design/KanapDialog';
import { useKanapDialogs } from '../../components/design';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import LocationPropertiesDrawer from './workspace/LocationPropertiesDrawer';
import LocationMetadataBar from './workspace/LocationMetadataBar';
import LocationOverviewTab from './workspace/LocationOverviewTab';
import LocationContactsTab from './workspace/LocationContactsTab';
import LocationRelationsTab from './workspace/LocationRelationsTab';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { useLocationItemNav } from '../../hooks/useModuleItemNav';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import { deleteFailureReason } from '../../utils/deleteRefusal';
import { useLocale } from '../../i18n/useLocale';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { carryListFilters } from '../../lib/listContext';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';

import { CreationActions, saveEditsSince, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
type TabKey = 'overview' | 'contacts' | 'relations' | typeof RECORD_HISTORY_TAB_KEY;

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
  /** The assets here: a location that holds any refuses its delete (`LOCATION_IN_USE`). */
  usage_count?: number;
};

type HostingCategory = 'on_prem' | 'cloud';

// A new site: the record page on a draft that Create posts.
const NEW_LOCATION: LocationRecord = {
  id: '',
  location_reference: '',
  name: '',
  hosting_type: '',
  operating_company_id: null,
  country_iso: null,
  city: null,
  provider: null,
  region: null,
  additional_info: null,
};

const TAB_KEYS: TabKey[] = ['overview', 'contacts', 'relations', RECORD_HISTORY_TAB_KEY];

// The History tab loads with its tab; a failed chunk shows a retry button in its place.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

/** The draft's fields that Create sends and a patch can change. */
const DRAFT_FIELDS = [
  'name', 'hosting_type', 'operating_company_id', 'country_iso', 'city', 'provider', 'region', 'additional_info',
] as const;

export default function LocationWorkspacePage() {
  const { id = '' } = useParams();
  // The site the draft has just created (its address on the page): the page stays the draft's, so
  // that what is typed while it is written, and the field being typed in, are kept.
  const [written, setWritten] = React.useState<string | null>(null);
  const fromDraft = !!written && id.toUpperCase() === written.toUpperCase();
  // A new site is a page of its own: nothing of a site seen before stays in its draft.
  return <LocationEditor key={id === 'new' || fromDraft ? 'draft' : 'record'} onDraftWritten={setWritten} />;
}

function LocationEditor({ onDraftWritten }: { onDraftWritten: (address: string) => void }) {
  const { t } = useTranslation(['it', 'common', 'errors']);
  const locale = useLocale();
  const dialogs = useKanapDialogs();
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

  const [data, setData] = React.useState<LocationRecord | null>(isCreate ? NEW_LOCATION : null);
  const [loading, setLoading] = React.useState(!isCreate);
  const [error, setError] = React.useState<string | null>(null);
  // HTTP status of the last failed read. Null once a location is on screen.
  const [loadStatus, setLoadStatus] = React.useState<number | null>(null);
  // A refused name shows under the title.
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [operatingCompanyName, setOperatingCompanyName] = React.useState<string | null>(null);
  const [subLocationsCount, setSubLocationsCount] = React.useState(0);
  // The Relations tab badge: assets, applications and web links the caller can see.
  const [relationsCount, setRelationsCount] = React.useState(0);
  const [deleting, setDeleting] = React.useState(false);
  const [pendingHostingType, setPendingHostingType] = React.useState<string | null>(null);

  const [createError, setCreateError] = React.useState<string | null>(null);
  // The draft is the live site until it is written: the write reads what was typed since it was sent.
  const dataRef = React.useRef(data);
  dataRef.current = data;
  // The address of the site the draft created: the page holds it already and does not read it.
  const handedOver = React.useRef<string | null>(null);

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
    if (isCreate && hostingOptions.length > 0) {
      setData((prev) => (prev && !prev.hosting_type ? { ...prev, hosting_type: hostingOptions[0].code } : prev));
    }
  }, [isCreate, hostingOptions]);

  const load = React.useCallback(async () => {
    if (isCreate || !routeId) return;
    setLoading(true);
    setError(null);
    setLoadStatus(null);
    try {
      const res = await api.get(`/locations/${routeId}`);
      const payload = res.data as LocationRecord;
      setData(payload);
      setLoadStatus(null);
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
      const status = e?.response?.status;
      const httpStatus = typeof status === 'number' ? status : null;
      setLoadStatus(httpStatus);
      // A missing location has its own screen. The API sentence stays off it.
      if (httpStatus === 404) {
        setData(null);
      } else {
        setError(getApiErrorMessage(e, t, t('messages.loadLocationFailed')));
      }
    } finally {
      setLoading(false);
    }
  }, [isCreate, routeId, t]);

  React.useEffect(() => {
    if (handedOver.current && routeId.toUpperCase() === handedOver.current.toUpperCase()) return;
    void load();
  }, [load, routeId]);
  React.useEffect(() => { setNameError(null); }, [routeId]);

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

  // Saves go one after the other, and a save under way blocks nothing: the fields stay editable.
  const saveChain = React.useRef<Promise<void>>(Promise.resolve());
  const savesPending = React.useRef(0);
  const patchLocation = React.useCallback(
    (patch: Partial<LocationRecord>): Promise<void> => {
      if (isCreate) {
        setCreateError(null);
        setData((prev) => (prev ? { ...prev, ...patch } : prev));
        return Promise.resolve();
      }
      if (!locationId) return Promise.resolve();
      savesPending.current += 1;
      setSaving(true);
      if ('name' in patch) setNameError(null);
      setData((prev) => (prev ? { ...prev, ...patch } as LocationRecord : prev));
      const run = async () => {
        try {
          const res = await api.patch(`/locations/${locationId}`, patch);
          // Only the last answer of a run of saves is shown: it holds the earlier ones, and a field
          // edited since is not put back to what an earlier answer says.
          if (savesPending.current === 1) {
            // The saved record has no asset count: the loaded one stays.
            setData((prev) => ({ ...(res.data as LocationRecord), usage_count: prev?.usage_count }));
            setError(null);
          }
        } catch (e: any) {
          if ('name' in patch && isDuplicateError(e)) setNameError(t('messages.locationNameTaken'));
          else setError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
          await load();
        } finally {
          savesPending.current -= 1;
          if (savesPending.current === 0) setSaving(false);
        }
      };
      const result = saveChain.current.then(run, run);
      saveChain.current = result.catch(() => undefined);
      return result;
    },
    [isCreate, load, locationId, t],
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
  // A new site: its name is typed in the header. The draft is created once it has its name and
  // hosting type; the site then opens, every tab available, with Create (kept, back where the
  // creation started) and Cancel (deleted).
  const leaveCreation = useCreationLeave(handleClose);
  const creationTitle = useCreationTitle({
    requiredMessage: t('messages.nameRequired'),
    onCancel: leaveCreation,
    onCommit: () => creation.attempt(),
  });
  const creation = useDraftCreation({
    isCreate,
    family: 'locations',
    apiBase: '/locations',
    recordId: data?.id || null,
    listPath: `/it/locations${listContextParams.toString() ? `?${listContextParams.toString()}` : ''}`,
    recordLabel: t('workspace.location.creationRecord'),
    queryKeyPrefixes: ['locations'],
    ready: () => canManage && !!creationTitle.current().trim() && !!data?.hosting_type,
    post: async () => {
      if (!data) return null;
      setCreateError(null);
      const { id: _id, location_reference: _reference, ...fields } = data;
      const sent = { ...fields, name: creationTitle.current().trim() };
      try {
        const { data: posted } = await api.post<LocationRecord & { creation_token: string }>('/locations', sent);
        // The answer of the create has no reference (the database gives it): the page reads the site
        // before moving to it, so that its address is the reference and never the long identifier.
        const stored = await api.get<LocationRecord>(`/locations/${posted.id}`).then((res) => res.data, () => null);
        const created = { ...posted, location_reference: stored?.location_reference ?? posted.location_reference };
        // The page moves to the site with its data in hand, and keeps what was typed since the
        // draft was sent (the next field, while the site was written): saved on the site.
        try {
          await saveEditsSince({
            sent,
            now: () => ({ ...(dataRef.current ?? sent), name: creationTitle.current().trim() }),
            fields: DRAFT_FIELDS,
            save: async (edits) => { await api.patch(`/locations/${created.id}`, edits); },
          });
        } catch (e: any) {
          setCreateError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
        }
        const address = created.location_reference || created.id;
        handedOver.current = address;
        onDraftWritten(address);
        setData((prev) => (prev ? { ...prev, id: created.id, location_reference: created.location_reference, name: creationTitle.current().trim() } : prev));
        const qs = listContextParams.toString();
        return {
          id: created.id,
          token: created.creation_token,
          path: `/it/locations/${address}/overview${qs ? `?${qs}` : ''}`,
        };
      } catch (e: any) {
        if (isDuplicateError(e)) creationTitle.refuse(t('messages.locationNameTaken'));
        else setCreateError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
        return null;
      }
    },
    onError: setCreateError,
  });
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, data]);

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
      // Asked only when the switch clears something: the operating company (to cloud), the provider or the region (to on-premises).
      const clears = nextCategory === 'on_prem' ? !!(data.provider || data.region) : !!data.operating_company_id;
      if (prevCategory !== nextCategory && !isCreate && clears) {
        setPendingHostingType(next);
        return;
      }
      void patchLocation({ hosting_type: next });
    },
    [data, getHostingCategory, isCreate, patchLocation],
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

  const handleCreate = () => {
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!canManage || !data) return;
    const name = creationTitle.require();
    if (!name) return;
    if (!data.hosting_type) {
      setCreateError(t('messages.hostingTypeRequired'));
      return;
    }
    void creation.createAndLeave();
  };

  const handleDelete = async () => {
    if (!locationId || !canDelete) return;
    const title = data?.name ? t('common:delete.recordTitle', { name: data.name }) : t('workspace.location.deleteTitle');
    // A location that still holds assets is refused: the reason and the count, with Close only.
    const assets = Number(data?.usage_count ?? 0);
    if (assets > 0) {
      await dialogs.alert({
        title,
        message: deleteFailureReason({ code: 'LOCATION_IN_USE', usages: [{ type: 'assets', total: assets }] }, t, locale),
      });
      return;
    }
    if (!(await dialogs.confirm({
      title,
      message: t('common:delete.cannotUndo'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    setDeleting(true);
    try {
      await api.delete(`/locations/${locationId}`);
      handleClose();
    } catch (e: any) {
      // An asset placed here meanwhile: the server's refusal, in the same words.
      const failure = e?.response?.data;
      if (failure?.code === 'LOCATION_IN_USE') {
        await dialogs.alert({ title, message: deleteFailureReason(failure, t, locale) });
      } else {
        setError(getApiErrorMessage(e, t, t('messages.deleteLocationFailed')));
      }
    } finally {
      setDeleting(false);
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

  const loadRelationCounts = React.useCallback(async () => {
    if (!data?.id) return;
    try {
      const res = await api.get<{ relations: number }>(`/locations/${data.id}/relation-counts`);
      setRelationsCount(Number(res.data?.relations) || 0);
    } catch {
      setRelationsCount(0);
    }
  }, [data?.id]);

  React.useEffect(() => {
    setRelationsCount(0);
    void loadRelationCounts();
  }, [loadRelationCounts]);

  const workspaceTabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: t('workspace.location.tabs.overview') },
    { key: 'contacts', label: t('workspace.location.tabs.contacts'), disabled: isCreate },
    { key: 'relations', label: t('workspace.location.tabs.relations'), disabled: isCreate, badge: relationsCount || undefined },
    { key: RECORD_HISTORY_TAB_KEY, label: t('workspace.location.tabs.history'), disabled: isCreate },
  ];

  const title = data?.name || '';

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
      disabled={!canManage}
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
      disabled={!canManage}
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
      {(isCreate || creation.beingCreated) && (
        <CreationActions
          onCreate={handleCreate}
          onCancel={isCreate ? leaveCreation : () => { void creation.cancelCreation(); }}
          busy={creation.cancelling || !canManage}
          writing={creation.writing}
        />
      )}
      {!isCreate && data && (
        <SendLinkButton
          itemType="location"
          itemId={data.id}
          itemRef={data.location_reference || null}
          itemName={data.name || t('workspace.location.untitled')}
        />
      )}
      {!isCreate && !creation.beingCreated && canDelete && (
        <DeleteIconButton onClick={() => { void handleDelete(); }} disabled={deleting} />
      )}
    </>
  );

  // A missing location is its own screen, in the language of the interface. The form stays for every other failure.
  if (!isCreate && !data && loadStatus === 404) {
    const qs = listContextParams.toString();
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{t('workspace.location.notFound')}</Alert>
        <MuiLink
          component={RouterLink}
          to={`/it/locations${qs ? `?${qs}` : ''}`}
          sx={{ display: 'inline-block', mt: 2, fontSize: 13, fontWeight: 400, color: 'kanap.teal' }}
        >
          {t('pages.locations.title')}
        </MuiLink>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={error ? <Alert severity="error" onClose={() => setError(null)}>{error}</Alert> : undefined}
        activeTab={validTab}
        tabs={workspaceTabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.locations.drawerOpen"
        backLabel={t('pages.locations.title')}
        onBack={isCreate ? leaveCreation : handleClose}
        itemReference={!isCreate ? data?.location_reference || null : null}
        onCopyReference={
          !isCreate && data?.location_reference
            ? () => { void navigator.clipboard?.writeText(data.location_reference); }
            : undefined
        }
        {...(isCreate ? creationTitle.shellProps : {
          title,
          canEditTitle: canManage,
          onTitleSave: handleTitleSave,
          titleError: nameError,
        })}
        titleFallback={isCreate ? t('workspace.location.newTitle') : t('workspace.location.untitled')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
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
        {data && (
          <>
            {createError && <Alert severity="error" sx={{ mb: 1.5 }}>{createError}</Alert>}
            {/* One element from the draft to the site it creates: the notes being typed keep their editor and their focus. */}
            {(isCreate || validTab === 'overview') && (
              <LocationOverviewTab
                locationId={isCreate ? '' : data.id}
                initialNotes={isCreate ? '' : data.additional_info || ''}
                canManage={canManage}
                onNotesDraft={isCreate ? (next) => { void patchLocation({ additional_info: next.trim() ? next : null }); } : undefined}
                onSubLocationsCountChange={isCreate ? undefined : setSubLocationsCount}
                subItemsAnchorRef={isCreate ? undefined : subItemsAnchorRef}
              />
            )}
            {!isCreate && validTab === 'contacts' && (
              <LocationContactsTab locationId={data.id} canManage={canManage} />
            )}
            {!isCreate && validTab === 'relations' && (
              <LocationRelationsTab locationId={data.id} onRelationsChange={() => { void loadRelationCounts(); }} />
            )}
            {!isCreate && validTab === RECORD_HISTORY_TAB_KEY && (
              <WorkspaceTabBoundary resetKey={validTab} onRetry={historyTab.retry}>
                <React.Suspense fallback={null}>
                  <HistoryTab table="locations" recordId={data.id} />
                </React.Suspense>
              </WorkspaceTabBoundary>
            )}
          </>
        )}
      </PortfolioDetailWorkspaceShell>

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

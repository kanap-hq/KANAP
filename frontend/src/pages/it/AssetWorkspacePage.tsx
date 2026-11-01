import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  IconButton,
  Link as MuiLink,
  Menu,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  CircularProgress,
  Switch,
  useTheme,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CloseIcon from '@mui/icons-material/Close';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LocationSelect from '../../components/fields/LocationSelect';
import { useCountryName } from '../../i18n/countries';
import AddIcon from '@mui/icons-material/Add';
import ApplicationSelect from '../../components/fields/ApplicationSelect';
import OptionWithHint from '../../components/fields/OptionWithHint';
import DateEUField from '../../components/fields/DateEUField';
import DateCalendarPopover from '../../components/fields/DateCalendarPopover';
import { ServerOption } from '../../components/fields/ServerSelect';
import ViaAssetNames from '../../components/workspace/ViaAssetNames';
import { DASH } from '../../components/workspace/relations';
import ClusterGroupLine from './components/ClusterGroupLine';
import useClusterAssignmentQuestion from './components/useClusterAssignmentQuestion';
import HardwareInfoPanel from './editors/HardwareInfoPanel';
import SupportInfoPanel from './editors/SupportInfoPanel';
import AssetConnectionsSection from './workspace/AssetConnectionsSection';
import AssetDependenciesTab from './workspace/AssetDependenciesTab';
import AssetRelationsTab from './workspace/AssetRelationsTab';
import { assetRelationsBadge, assetRelationsKey, fetchAssetRelationsTab } from './workspace/assetRelationsData';
import AssetTechnologiesSection from './components/AssetTechnologiesSection';
import { invalidateTechnologyLinks } from './components/technologyLinkQueries';
import ReachVulnerabilitiesSection, { reachVulnerabilitiesRefetchMs, type ReachVulnerabilities } from './workspace/ReachVulnerabilitiesSection';
import VulnerabilitySevereBadge, { highestSevereOf } from './workspace/VulnerabilitySevereBadge';
import PendingMetadata from './workspace/PendingMetadata';
import { useFeatures } from '../../config/FeaturesContext';
import { useAssetNav } from '../../hooks/useAssetNav';
import EntityKnowledgePanel from '../../components/EntityKnowledgePanel';
import { useAuth } from '../../auth/AuthContext';
import { formatShortDate } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';
import { joinNames } from '../working-day-calendars/workingDayCalendarFields';

import { useTranslation } from 'react-i18next';
import { screenLanguage } from '../../components/csv/readings';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { assetDeleteCheck } from '../../utils/deleteCheck';
import { deleteFailureReason } from '../../utils/deleteRefusal';
import { isValidHostname, sanitizeHostname } from '../../utils/hostname';
import { KanapDialog, PropertyGroup, PropertyRow, unsavedConfirm, useKanapDialogs } from '../../components/design';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { getDotColor, LIFECYCLE_COLORS } from '../../utils/statusColors';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import { RelationsEmpty } from '../../components/workspace/RelationsTable';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import type { AssetExternalLink } from '../../api/endpoints/assets';
import { isNetboxAttentionStatus } from '../../api/endpoints/netbox';
import { NETBOX_LOCKABLE_ASSET_FIELDS, NetboxLockableField, netboxFieldLock } from './netboxManagedFields';
import { carryListFilters } from '../../lib/listContext';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';
import InfoHint from '../../components/workspace/InfoHint';
import { ApplicationFeedbackProvider, type ApplicationFeedback } from './applicationFeedback';
const MarkdownEditor = React.lazy(() => import('../../components/MarkdownEditor'));
type IpAddressEntry = { type: string; ip: string; subnet_cidr: string | null };

/**
 * Asset fields Netbox can own on a linked asset, and which of them it actually
 * provides on this one. The controls for a managed field are disabled, but
 * `patchAsset` drops the managed fields as a last line of defence so no
 * autosave path (a debounce queued before the link data arrived, a stale
 * closure, a future control) can ever push a local value over the inventory.
 */

type AssetRecord = {
  id: string;
  name: string;
  asset_reference?: string | null;
  kind: string;
  provider: string;
  environment: string;
  hostname: string | null;
  domain: string | null;
  admin_zone: string | null;
  fqdn: string | null;
  aliases: string[] | null;
  ip_addresses: IpAddressEntry[] | null;
  cluster: string | null;
  is_cluster: boolean;
  status: string;
  go_live_date: string | null;
  end_of_life_date: string | null;
  location_id: string | null;
  sub_location_id?: string | null;
  operating_system: string | null;
  notes: string | null;
  external_links?: AssetExternalLink[] | null;
};

type AssignmentRow = {
  id: string;
  app_instance_id: string;
  role: string;
  since_date: string | null;
  notes: string | null;
  application: { id: string; name: string };
  environment: string;
  /** True on a row the server gets through its cluster: `id` is then the cluster's row. */
  inherited?: boolean;
  via_clusters?: Array<{ id: string; name: string }>;
};

/** A deployment and role assigned directly to every member of a cluster (A7). */
type GroupableSet = {
  cluster_id: string;
  cluster_name: string;
  app_instance_id: string;
  role: string;
  application_id: string;
  application_name: string;
  environment: string;
  member_ids: string[];
};

type ApplicationInstance = {
  id: string;
  environment: string;
};

/** The value of a deployment the assignment creates first, in the environment that follows. */
const NEW_DEPLOYMENT = 'new:';

type LocationDetails = {
  id: string;
  location_reference: string;
  name: string;
  hosting_type: string;
  operating_company_id: string | null;
  provider: string | null;
  country_iso: string | null;
  city: string | null;
};

type ClusterMember = {
  id: string;
  name: string;
  environment: string;
  status: string;
  kind: string;
  provider: string;
  location?: string | null;
  location_id?: string | null;
  operating_system?: string | null;
};

type LocationOption = { id: string; location_reference: string; name: string };

type ClusterSummary = {
  id: string;
  name: string;
  environment: string;
  status: string;
};

type TabKey = 'overview' | 'operations' | 'network' | 'hardware' | 'dependencies' | 'relations' | typeof RECORD_HISTORY_TAB_KEY;
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

const VALID_ASSET_TABS = new Set<TabKey>(['overview', 'operations', 'network', 'hardware', 'dependencies', 'relations', RECORD_HISTORY_TAB_KEY]);
/** Former tab keys, and the tab that holds their sections now. Old links land there. */
const LEGACY_TAB_TARGETS: Record<string, TabKey> = {
  technical: 'operations',
  support: 'overview',
  connections: 'network',
  knowledge: 'overview',
  assignments: 'operations',
};
const legacyTabTarget = (key: string | undefined): TabKey | null => (
  key && Object.prototype.hasOwnProperty.call(LEGACY_TAB_TARGETS, key) ? LEGACY_TAB_TARGETS[key] : null
);
/** Tabs shown for physical assets only. */
const PHYSICAL_ONLY_TABS: ReadonlySet<string> = new Set<TabKey>(['hardware']);
/** Tabs that need a saved asset: a creation falls back to the overview. */
const CREATE_DISABLED_TABS: ReadonlySet<string> = new Set<TabKey>(['operations', 'hardware', 'dependencies', 'relations', RECORD_HISTORY_TAB_KEY]);
/** A name longer than this wraps the title over the tabs. The column itself is unbounded. */
const ASSET_NAME_MAX = 200;

const MEMBER_OPTIONS_LIMIT = 50;
/** The last row of a full candidate list: not a choice, it asks to narrow the search. */
const MORE_MEMBERS_ROW: ServerOption = { id: '__more__', name: '', environment: '', kind: '', provider: '' };

const ENV_OPTION_KEYS = [
  { value: 'prod', labelKey: 'enums.environment.prod' },
  { value: 'pre_prod', labelKey: 'enums.environment.preProd' },
  { value: 'qa', labelKey: 'enums.environment.qa' },
  { value: 'test', labelKey: 'enums.environment.test' },
  { value: 'dev', labelKey: 'enums.environment.dev' },
  { value: 'sandbox', labelKey: 'enums.environment.sandbox' },
] as const;

function humanize(value: string | null | undefined, emptyLabel: string) {
  const text = String(value || '').trim();
  if (!text) return emptyLabel;
  // Only the start of the text and the letter after a space. A word boundary also
  // sits after an accent, which turned the catalog label "Obsolète" into "ObsolèTe".
  return text.replace(/_/g, ' ').replace(/(^|\s)(\w)/g, (_, lead: string, ch: string) => `${lead}${ch.toUpperCase()}`);
}

/** The lifecycle pill shows the catalog label unchanged. A code the catalog does not know is spaced. */
export function lifecyclePillLabel(catalogLabel: string, code: string | null | undefined, emptyLabel: string) {
  const catalog = catalogLabel.trim();
  const raw = String(code || '').trim();
  if (catalog && catalog !== raw) return catalog;
  return humanize(raw, emptyLabel);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="h2"
      sx={(theme) => ({
        m: 0,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.4,
        color: theme.palette.kanap.text.primary,
      })}
    >
      {children}
    </Typography>
  );
}

const contentFieldSx = {
  width: '100%',
  maxWidth: 520,
  '& .MuiInputBase-root': {
    fontSize: 13,
  },
} as const;

/** A tab fills the content column and wraps, so a 1280px window with the drawer open does not scroll sideways. */
const tabContentSx = { minWidth: 0, width: '100%', maxWidth: '100%' } as const;

const denseTableSx = {
  width: '100%',
  tableLayout: 'fixed',
  '& th': {
    fontSize: 12,
    fontWeight: 500,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.default',
    color: 'kanap.text.tertiary',
    py: 0.75,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  '& td': {
    fontSize: 13,
    borderBottom: '1px solid',
    borderColor: 'kanap.border.soft',
    color: 'kanap.text.primary',
    py: 0.75,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
  },
  '& tbody tr:hover': {
    bgcolor: 'kanap.bg.hover',
  },
  '& .MuiButton-root': {
    minWidth: 0,
    p: 0,
    height: 'auto',
    color: 'kanap.text.primary',
    fontSize: 13,
    fontWeight: 400,
    justifyContent: 'flex-start',
    textTransform: 'none',
    '&:hover': {
      bgcolor: 'transparent',
      color: 'kanap.teal',
      textDecoration: 'underline',
    },
  },
} as const;

/**
 * A banner reporter for one panel: a message is shown and remembered; `null` (a successful save)
 * clears the banner only while it still shows that panel's message.
 */
function useOwnedBannerError(setError: React.Dispatch<React.SetStateAction<string | null>>) {
  const owned = React.useRef<string | null>(null);
  return React.useCallback((message: string | null) => {
    if (message) {
      owned.current = message;
      setError(message);
      return;
    }
    const last = owned.current;
    owned.current = null;
    if (last) setError((current) => (current === last ? null : current));
  }, [setError]);
}

type AssetLoadResult =
  | { ok: true; data: AssetRecord }
  | { ok: false; status: number; error: unknown };

/** A banner message, and the validation that can clear it once the field it names is filled. */
type AssetBannerError = {
  message: string;
  kind?: 'locationRequired' | 'assetTypeRequired' | 'providerRequired';
};

// One read in flight per address. A 404 is kept until the fiche leaves that address, so a second
// mount (the tab in the address, or a new translation function) does not ask again.
const assetLoadInflight = new Map<string, Promise<AssetLoadResult>>();
const assetLoadNotFound = new Map<string, AssetLoadResult>();

function loadAssetRecord(url: string, fresh = false): Promise<AssetLoadResult> {
  if (fresh) {
    assetLoadNotFound.delete(url);
    assetLoadInflight.delete(url);
  } else {
    const missed = assetLoadNotFound.get(url);
    if (missed) return Promise.resolve(missed);
    const pending = assetLoadInflight.get(url);
    if (pending) return pending;
  }
  const pending = api.get<AssetRecord>(url).then(
    (res) => ({ ok: true as const, data: res.data }),
    (error: unknown) => ({
      ok: false as const,
      status: Number((error as { response?: { status?: number } } | null)?.response?.status) || 0,
      error,
    }),
  );
  assetLoadInflight.set(url, pending);
  void pending.finally(() => {
    if (assetLoadInflight.get(url) === pending) assetLoadInflight.delete(url);
  });
  return pending;
}

export default function AssetWorkspacePage() {
  const routeId = String(useParams().id || '');
  // A new asset in the address remounts the fiche. Timers, fields and a response
  // still in flight stay with the asset that was on screen, so they cannot paint
  // over the next one or be saved onto it.
  return <AssetWorkspaceRoute key={routeId} />;
}

function AssetWorkspaceRoute() {
  const { t, i18n } = useTranslation(['it', 'common', 'errors']);
  const notSetLabel = t('common:selects.notSet');
  const ENV_OPTIONS = ENV_OPTION_KEYS.map((option) => ({ value: option.value, label: t(option.labelKey) }));
  const environmentLabel = (value: string | null | undefined) =>
    ENV_OPTIONS.find((option) => option.value === value)?.label || value || notSetLabel;
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  // The feedback snackbar is rendered by this route, so the route itself reaches it through the ref.
  const feedbackRef = React.useRef<ApplicationFeedback>({ error: () => undefined, undo: () => undefined, info: () => undefined });
  const { hasLevel } = useAuth();
  const theme = useTheme();
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeId = String(params.id || '');
  const assetReferenceRoute = /^AST-\d+$/i.test(routeId);
  const rawTab = params.tab as string | undefined;
  const tab = React.useMemo<TabKey>(() => {
    if (VALID_ASSET_TABS.has(rawTab as TabKey)) return rawTab as TabKey;
    return legacyTabTarget(rawTab) ?? 'overview';
  }, [rawTab]);
  const isCreate = routeId === 'new';
  const [canonicalAssetId, setCanonicalAssetId] = React.useState<string | null>(null);
  const id = isCreate ? routeId : (assetReferenceRoute ? canonicalAssetId || '' : routeId);
  const canManage = hasLevel('infrastructure', 'member');
  const canDelete = hasLevel('infrastructure', 'admin');
  // Assignments belong to the applications module: a reader sees them, inherited ones included, and changes none.
  // Changing one also changes the server, so it needs the member level on the infrastructure too.
  const canReadApplications = hasLevel('applications', 'reader');
  const canAssignApplications = canManage && hasLevel('applications', 'member');

  const notesSaveTimerRef = React.useRef<number | null>(null);
  // The description typed but not yet sent, and the asset it belongs to.
  const pendingNotesRef = React.useRef<{ assetId: string; value: string } | null>(null);
  // The asset the screen is showing. A response or a write for any other asset is dropped:
  // moving to the next asset must not paint the previous one, nor save onto the next one.
  const shownAssetIdRef = React.useRef<string | null>(null);
  const dataRef = React.useRef<AssetRecord | null>(null);
  const routeIdRef = React.useRef(routeId);
  routeIdRef.current = routeId;

  const [data, setData] = React.useState<AssetRecord | null>(null);
  dataRef.current = data;
  // Netbox owns the inventory fields it feeds; KANAP keeps the business layer editable.
  const netboxLink = React.useMemo(
    () => (data?.external_links || []).find((link) => link.source === 'netbox') || null,
    [data?.external_links],
  );
  const netboxManaged = netboxLink?.state === 'linked';
  const netboxAttentionStatus = netboxManaged && isNetboxAttentionStatus(netboxLink?.external_status)
    ? (netboxLink?.external_status as string)
    : null;
  const netboxOwns = React.useMemo(() => netboxFieldLock(netboxLink), [netboxLink]);
  /** True when this field is the administrator's to edit: Netbox does not provide it. */
  const canEditNetboxField = React.useCallback(
    (field: NetboxLockableField) => canManage && !netboxOwns(field),
    [canManage, netboxOwns],
  );
  const netboxSyncedLabel = React.useMemo(() => {
    const value = netboxLink?.last_synced_at;
    if (!value) return null;
    const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
    if (!Number.isFinite(minutes)) return null;
    if (minutes < 1) return t('pages.netbox.time.justNow');
    if (minutes < 60) return t('pages.netbox.time.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('pages.netbox.time.hoursAgo', { count: hours });
    return t('pages.netbox.time.daysAgo', { count: Math.floor(hours / 24) });
  }, [netboxLink?.last_synced_at, t]);
  const [error, setErrorState] = React.useState<AssetBannerError | null>(null);
  // Every banner message keeps its text, and a validation also keeps the code of the field it names.
  const setError = React.useCallback((next: React.SetStateAction<string | null>) => {
    setErrorState((current) => {
      const message = typeof next === 'function' ? next(current?.message ?? null) : next;
      return message ? { message } : null;
    });
  }, []);
  const setValidationError = React.useCallback((kind: AssetBannerError['kind'], message: string) => {
    setErrorState({ message, kind });
  }, []);
  // The HTTP status of the last failed read of the asset (0 without a response), null once read.
  const [loadFailure, setLoadFailure] = React.useState<number | null>(null);
  // A support or hardware save that runs after the panel has left reports here. While the panel
  // is on screen it shows the failure itself. A later success clears only that panel's message.
  const supportSaveError = useOwnedBannerError(setError);
  const hardwareSaveError = useOwnedBannerError(setError);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [assignments, setAssignments] = React.useState<AssignmentRow[]>([]);
  const [assignmentsError, setAssignmentsError] = React.useState<string | null>(null);
  const [groupable, setGroupable] = React.useState<GroupableSet[]>([]);
  const [clusterMembers, setClusterMembers] = React.useState<ClusterMember[]>([]);
  const [clusterError, setClusterError] = React.useState<string | null>(null);
  const [clusterLoading, setClusterLoading] = React.useState(false);
  // The asset whose members were last read: until then the cluster section is loading, not empty.
  const [membersLoadedFor, setMembersLoadedFor] = React.useState<string | null>(null);
  const [clustersForServer, setClustersForServer] = React.useState<ClusterSummary[]>([]);
  const [clustersError, setClustersError] = React.useState<string | null>(null);
  const canCreateKnowledge = hasLevel('knowledge', 'member');
  const [memberDialogOpen, setMemberDialogOpen] = React.useState(false);
  const [memberSelection, setMemberSelection] = React.useState<ServerOption[]>([]);
  const [memberOptions, setMemberOptions] = React.useState<ServerOption[]>([]);
  const [memberSearch, setMemberSearch] = React.useState('');
  const [memberOptionsLoading, setMemberOptionsLoading] = React.useState(false);
  // The search returned as many candidates as it may: the list invites to narrow it.
  const [memberOptionsFull, setMemberOptionsFull] = React.useState(false);
  const [memberSaving, setMemberSaving] = React.useState(false);
  const [memberSaveError, setMemberSaveError] = React.useState<string | null>(null);
  const [assetTypeAnchorEl, setAssetTypeAnchorEl] = React.useState<HTMLElement | null>(null);
  const [locationAnchorEl, setLocationAnchorEl] = React.useState<HTMLElement | null>(null);
  const [goLiveAnchorEl, setGoLiveAnchorEl] = React.useState<HTMLElement | null>(null);
  const [locationOptions, setLocationOptions] = React.useState<LocationOption[]>([]);
  const workspaceRouteId = data?.asset_reference || (isCreate ? 'new' : routeId);
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && data?.id && data?.name) addToRecent('asset', data.id, data.name, data.asset_reference || undefined);
  }, [addToRecent, data?.id, data?.name, data?.asset_reference, isCreate]);
  const routeMatchesLoadedAsset = React.useMemo(() => {
    if (isCreate || !data) return false;
    if (routeId === data.id) return true;
    const routeKey = routeId.toUpperCase();
    const reference = data.asset_reference?.toUpperCase();
    return !!reference && (routeKey === reference || routeKey.startsWith(`${reference}-`));
  }, [data, isCreate, routeId]);
  const queryClient = useQueryClient();
  const { byField, labelFor, settings } = useItOpsEnumOptions();
  const serverRoleOptions = React.useMemo(
    () => (byField.serverRole || []).map((o) => ({
      value: o.code,
      label: o.deprecated ? t('common.deprecatedOption', { label: o.label }) : o.label,
      deprecated: !!o.deprecated,
    })),
    [byField.serverRole, t],
  );

  // `t` changes when a namespace arrives. A missing asset must not be read again for that.
  const tRef = React.useRef(t);
  tRef.current = t;
  const load = React.useCallback(async (fresh = false) => {
    if (isCreate) return;
    const requestedRoute = routeId;
    const url = assetReferenceRoute ? `/assets/by-ref/${routeId}` : `/assets/${routeId}`;
    setError(null);
    setLoadFailure(null);
    const result = await loadAssetRecord(url, fresh);
    // The person already moved on: this response belongs to an asset the screen no longer shows.
    if (routeIdRef.current !== requestedRoute) return;
    if (result.ok) {
      shownAssetIdRef.current = result.data.id;
      setData(result.data);
      setCanonicalAssetId(result.data.id);
      return;
    }
    if (result.status === 404) assetLoadNotFound.set(url, result);
    const translate = tRef.current;
    setLoadFailure(result.status);
    setError(getApiErrorMessage(result.error, translate, translate('messages.loadAssetFailed')));
  }, [assetReferenceRoute, isCreate, routeId]);

  React.useEffect(() => {
    const url = assetReferenceRoute ? `/assets/by-ref/${routeId}` : `/assets/${routeId}`;
    let active = true;
    void load().finally(() => {
      // Leaving the address, including a strict-mode remount's first pass, forgets the 404.
      // The pass that stays on screen records it again.
      if (!active) assetLoadNotFound.delete(url);
    });
    return () => {
      active = false;
      assetLoadNotFound.delete(url);
    };
  }, [assetReferenceRoute, load, routeId]);

  React.useEffect(() => {
    if (isCreate || !data?.asset_reference) return;
    if (!routeMatchesLoadedAsset) return;
    if (routeId.toUpperCase() === data.asset_reference.toUpperCase()) return;
    const qs = searchParams.toString();
    window.history.replaceState(null, '', `/it/assets/${data.asset_reference}/${tab}${qs ? `?${qs}` : ''}`);
  }, [data?.asset_reference, isCreate, navigate, routeId, routeMatchesLoadedAsset, searchParams, tab]);

  React.useEffect(() => {
    let cancelled = false;
    const loadLocations = async () => {
      try {
        const res = await api.get<{ items: LocationOption[] }>('/locations', {
          params: { limit: 500, sort: 'location_reference:ASC' },
        });
        if (cancelled) return;
        const items = [...(res.data?.items || [])].sort((a, b) => (
          a.location_reference.localeCompare(b.location_reference, undefined, { sensitivity: 'base', numeric: true })
        ));
        setLocationOptions(items);
      } catch {
        if (!cancelled) setLocationOptions([]);
      }
    };
    void loadLocations();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshAssignments = React.useCallback(async () => {
    if (isCreate || !id) return;
    if (!canReadApplications) {
      setAssignments([]);
      setAssignmentsError(null);
      return;
    }
    setAssignmentsError(null);
    try {
      const [rows, sets] = await Promise.all([
        api.get<AssignmentRow[]>(`/assets/${id}/assignments`),
        api.get<{ items: GroupableSet[] }>(`/assets/${id}/assignments/groupable`),
      ]);
      setAssignments(Array.isArray(rows.data) ? rows.data : []);
      setGroupable(sets.data?.items ?? []);
    } catch (e: any) {
      setAssignmentsError(getApiErrorMessage(e, t, t('messages.loadAssignmentsFailed')));
    }
  }, [id, isCreate, canReadApplications, t]);

  React.useEffect(() => { void refreshAssignments(); }, [refreshAssignments]);

  const [name, setName] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [provider, setProvider] = React.useState('on_prem');
  const [environment, setEnvironment] = React.useState('prod');
  const [hostname, setHostname] = React.useState('');
  const [ipAddresses, setIpAddresses] = React.useState<IpAddressEntry[]>([]);
  // The refused address stays in the field: a failed save reloads the asset and would otherwise wipe it.
  const [ipFieldError, setIpFieldError] = React.useState<{ index: number; message: string } | null>(null);
  const keepLocalIps = React.useRef(false);
  // A new cluster (`?cluster=1` from the assets list) opens the creation with the switch on.
  const [isCluster, setIsCluster] = React.useState(() => isCreate && searchParams.get('cluster') === '1');
  // True while the Cluster switch is saved: the cluster lists wait for the server to agree.
  const [clusterSwitchSaving, setClusterSwitchSaving] = React.useState(false);
  const [status, setStatus] = React.useState<string>('active');
  const [goLiveDate, setGoLiveDate] = React.useState<string>('');
  const [endOfLifeDate, setEndOfLifeDate] = React.useState<string>('');
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [subLocationId, setSubLocationId] = React.useState<string | null>(null);
  const [subLocationOptions, setSubLocationOptions] = React.useState<Array<{ id: string; name: string; description?: string | null }>>([]);
  const [subLocationLoading, setSubLocationLoading] = React.useState(false);
  const [notes, setNotes] = React.useState<string>('');
  const [domain, setDomain] = React.useState<string>('');
  const [adminZone, setAdminZone] = React.useState<string>('');
  const [aliases, setAliases] = React.useState<string[]>([]);
  const [locationDetails, setLocationDetails] = React.useState<LocationDetails | null>(null);
  const [locationCompanyName, setLocationCompanyName] = React.useState<string | null>(null);
  const [locationInfoLoading, setLocationInfoLoading] = React.useState(false);
  const [locationInfoError, setLocationInfoError] = React.useState<string | null>(null);
  const countryName = useCountryName();
  const getHostingCategory = React.useCallback(
    (code?: string | null) => {
      if (!code) return 'cloud' as const;
      const opt = settings?.hostingTypes?.find((item) => item.code === code);
      return opt?.category === 'on_prem' ? 'on_prem' : 'cloud';
    },
    [settings?.hostingTypes],
  );
  const fallbackProviderCode = React.useMemo(() => {
    const providers = byField.serverProvider || [];
    const other = providers.find((opt) => opt.code === 'other');
    return other?.code || providers[0]?.code || '';
  }, [byField.serverProvider]);

  // The cluster lists follow the loaded asset, once it is the one of the route: the local switch state
  // still holds the previous asset's value for a render after a move to another asset.
  const loadedAssetId = !isCreate && data?.id === id ? data.id : null;
  const loadedIsCluster = !!data?.is_cluster;
  const loadClusterMembers = React.useCallback(async () => {
    if (clusterSwitchSaving) return;
    if (!isCreate && !loadedAssetId) return;
    if (isCreate || !id || !loadedIsCluster) {
      setClusterMembers([]);
      setClusterError(null);
      setClusterLoading(false);
      setMembersLoadedFor(null);
      return;
    }
    setClusterLoading(true);
    setClusterError(null);
    try {
      const res = await api.get<{ items: ClusterMember[] }>(`/assets/${id}/members`);
      setClusterMembers((res.data?.items || []) as ClusterMember[]);
    } catch (e: any) {
      setClusterError(getApiErrorMessage(e, t, t('messages.loadClusterMembersFailed')));
      setClusterMembers([]);
    } finally {
      setClusterLoading(false);
      setMembersLoadedFor(id);
    }
  }, [clusterSwitchSaving, id, isCreate, loadedAssetId, loadedIsCluster]);

  const loadClustersForServer = React.useCallback(async () => {
    if (clusterSwitchSaving) return;
    if (!isCreate && !loadedAssetId) return;
    if (isCreate || !id || loadedIsCluster) {
      setClustersForServer([]);
      setClustersError(null);
      return;
    }
    setClustersError(null);
    try {
      const res = await api.get<{ items: ClusterSummary[] }>(`/assets/${id}/clusters`);
      setClustersForServer((res.data?.items || []) as ClusterSummary[]);
    } catch (e: any) {
      setClustersError(getApiErrorMessage(e, t, t('messages.loadClustersFailed')));
      setClustersForServer([]);
    }
  }, [clusterSwitchSaving, id, isCreate, loadedAssetId, loadedIsCluster]);

  React.useEffect(() => { void loadClusterMembers(); }, [loadClusterMembers]);
  React.useEffect(() => { void loadClustersForServer(); }, [loadClustersForServer]);

  React.useEffect(() => {
    if (!memberDialogOpen) return;
    let cancelled = false;
    setMemberOptionsLoading(true);
    const loadOptions = async () => {
      try {
        const res = await api.get<{ items: ServerOption[] }>('/assets', {
          params: {
            q: memberSearch || undefined,
            limit: MEMBER_OPTIONS_LIMIT,
            sort: 'name:ASC',
            // The assets list reads this from its filter model (the grid's format): a cluster is never a member.
            filters: JSON.stringify({ is_cluster: { filterType: 'set', values: ['false'] } }),
          },
        });
        if (cancelled) return;
        const items = res.data.items || [];
        setMemberOptionsFull(items.length >= MEMBER_OPTIONS_LIMIT);
        setMemberOptions(items.filter((item) => item.id !== id));
      } catch {
        if (!cancelled) setMemberOptions([]);
      } finally {
        if (!cancelled) setMemberOptionsLoading(false);
      }
    };
    void loadOptions();
    return () => { cancelled = true; };
  }, [id, memberDialogOpen, memberSearch]);
  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    const current = status;
    const opts = list.map((item) => ({
      value: item.code,
      label: item.deprecated ? t('common.deprecatedOption', { label: item.label }) : item.label,
      deprecated: !!item.deprecated,
    }));
    if (current && !opts.some((opt) => opt.value === current)) {
      opts.push({ value: current, label: current, deprecated: false });
    }
    return opts.filter((opt) => !opt.deprecated || opt.value === current);
  }, [byField.lifecycleStatus, status, t]);

  const kindOptions = React.useMemo(
    () => (byField.serverKind || [])
      .map((o) => ({
        value: o.code,
        label: o.deprecated ? t('common.deprecatedOption', { label: o.label }) : o.label,
        deprecated: !!o.deprecated,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [byField.serverKind, t],
  );

  // Determine if the current asset type is physical (shows Hardware/Support tabs)
  const isPhysicalAsset = React.useMemo(() => {
    const assetKind = kind || data?.kind || '';
    if (!assetKind) return false;
    const assetType = (settings?.serverKinds || []).find((o) => o.code === assetKind);
    return assetType?.is_physical ?? false;
  }, [data?.kind, kind, settings?.serverKinds]);
  // A switch, a firewall or a virtual machine is an asset. Only a physical server is a server.
  const isPhysicalServer = (kind || data?.kind || '') === 'physical_server';

  // Redirect to valid tab if current tab is not available for this asset type
  React.useEffect(() => {
    if (isCreate) return;
    if (!data) return; // Wait for data to load
    if (!routeMatchesLoadedAsset) return;
    if (!settings) return; // Wait for asset type metadata before deciding physical-only tabs
    if (PHYSICAL_ONLY_TABS.has(tab) && !isPhysicalAsset) {
      navigate(`/it/assets/${workspaceRouteId}/overview`, { replace: true });
    }
  }, [tab, isPhysicalAsset, isCreate, data, navigate, routeMatchesLoadedAsset, settings, workspaceRouteId]);

  // Compute valid tab value for Tabs component (prevents MUI warning)
  const validTab = React.useMemo<TabKey>(() => {
    if (isCreate && CREATE_DISABLED_TABS.has(tab)) return 'overview'; // Fallback while redirect happens
    if (!settings) return tab;
    if (PHYSICAL_ONLY_TABS.has(tab) && !isPhysicalAsset) {
      return 'overview'; // Fallback while redirect happens
    }
    return tab;
  }, [isCreate, tab, isPhysicalAsset, settings]);

  const domainOptions = React.useMemo(
    () => (settings?.domains || []).map((d) => ({
      value: d.code,
      label: d.deprecated ? t('common.deprecatedOption', { label: d.label }) : d.label,
      dns_suffix: d.dns_suffix,
      system: d.system,
      deprecated: !!d.deprecated,
    })),
    [settings?.domains, t],
  );
  const adminZoneOptions = React.useMemo(() => {
    const zones = (byField.adminZone || []).filter((option) => !option.deprecated || option.code === adminZone);
    if (adminZone && !zones.some((option) => option.code === adminZone)) {
      return [{ value: adminZone, label: t('common.legacyOption', { label: adminZone }) }, ...zones.map((option) => ({
        value: option.code,
        label: option.deprecated ? t('common.deprecatedOption', { label: option.label }) : option.label,
      }))];
    }
    return zones.map((option) => ({
      value: option.code,
      label: option.deprecated ? t('common.deprecatedOption', { label: option.label }) : option.label,
    }));
  }, [adminZone, byField.adminZone, t]);

  // Compute FQDN from hostname and domain
  const computedFqdn = React.useMemo(() => {
    if (!hostname) return '';
    const cleanHostname = hostname.trim().toLowerCase();
    if (!domain || domain === 'workgroup' || domain === 'n-a') {
      return cleanHostname;
    }
    const domainOpt = domainOptions.find((d) => d.value === domain);
    if (domainOpt?.dns_suffix) {
      return `${cleanHostname}.${domainOpt.dns_suffix}`;
    }
    return cleanHostname;
  }, [hostname, domain, domainOptions]);

  // Prefill hostname from sanitized name on create (keep syncing until user manually edits hostname)
  const [hostnameManuallyEdited, setHostnameManuallyEdited] = React.useState(false);
  React.useEffect(() => {
    if (!isCreate) return;
    if (hostnameManuallyEdited) return;
    if (!name) return;
    const sanitized = sanitizeHostname(name);
    setHostname(sanitized);
  }, [isCreate, name, hostnameManuallyEdited]);

  // Check if hostname is required (domain is a "real" domain)
  const hostnameRequired = domain && domain !== 'workgroup' && domain !== 'n-a';
  // A host name may carry several dot-separated parts, so `dl3.robot-15ms.ie2000` is fine.
  const hostnameMalformed = !!hostname.trim() && !isValidHostname(hostname.trim());
  // A creation banner names the problem that blocked the last attempt. Once that problem is gone, the
  // banner goes with it. A host name problem stays under the field, so it never uses this banner.
  React.useEffect(() => {
    if (!error?.kind) return;
    const gone =
      (error.kind === 'locationRequired' && !!locationId)
      || (error.kind === 'assetTypeRequired' && !!kind)
      || (error.kind === 'providerRequired' && !!provider);
    if (gone) setErrorState(null);
  }, [error, kind, locationId, provider]);

  const networkSegmentOptions = React.useMemo(
    () => (byField.networkSegment || []).map((o) => ({
      value: o.code,
      label: o.deprecated ? t('common.deprecatedOption', { label: o.label }) : o.label,
      deprecated: !!o.deprecated,
    })),
    [byField.networkSegment, t],
  );

  const subnetOptions = React.useMemo(
    () => (settings?.subnets || [])
      .filter((s) => s.location_id === locationId && !s.deprecated)
      .map((s) => ({
        value: s.cidr,
        label: s.cidr,
        vlan_number: s.vlan_number,
        network_zone: s.network_zone,
        description: s.description,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [settings?.subnets, locationId],
  );

  // IP address type options
  const ipAddressTypeOptions = React.useMemo(
    () => (byField.ipAddressType || []).map((o) => ({
      value: o.code,
      label: o.label,
    })),
    [byField.ipAddressType],
  );

  React.useEffect(() => {
    if (!isCreate) return;
    if (provider) return;
    if (!fallbackProviderCode) return;
    setProvider(fallbackProviderCode);
  }, [isCreate, provider, fallbackProviderCode]);

  React.useEffect(() => {
    if (!data) return;
    setName(data.name);
    setKind(data.kind);
    setProvider(data.provider);
    setEnvironment(data.environment);
    setHostname(data.hostname || '');
    setDomain(data.domain || '');
    setAdminZone(data.admin_zone || '');
    setAliases(data.aliases || []);
    if (keepLocalIps.current) {
      keepLocalIps.current = false;
    } else {
      // A row with no address is still being filled. A save of the others must not drop it.
      setIpAddresses((prev) => {
        const drafts = prev.filter((entry) => !(entry.ip || '').trim());
        const saved = data.ip_addresses || [];
        return drafts.length > 0 ? [...saved, ...drafts] : saved;
      });
      setIpFieldError(null);
    }
    setIsCluster(!!data.is_cluster);
    setStatus((data.status as 'enabled' | 'disabled') || 'enabled');
    setGoLiveDate(data.go_live_date || '');
    setEndOfLifeDate(data.end_of_life_date || '');
    setLocationId(data.location_id || null);
    setSubLocationId((data as any).sub_location_id || null);
    setNotes(data.notes || '');
    setDirty(false);
  }, [data]);

  React.useEffect(() => {
    let cancelled = false;
    if (!locationId) {
      setLocationDetails(null);
      setLocationCompanyName(null);
      setLocationInfoError(null);
      setLocationInfoLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLocationInfoLoading(true);
    setLocationInfoError(null);
    setLocationDetails(null);
    setLocationCompanyName(null);
    const fetchDetails = async () => {
      try {
        const res = await api.get(`/locations/${locationId}`);
        if (cancelled) return;
        const payload = res.data as any;
        const details: LocationDetails = {
          id: payload.id,
          location_reference: payload.location_reference,
          name: payload.name,
          hosting_type: payload.hosting_type,
          operating_company_id: payload.operating_company_id || null,
          provider: payload.provider || null,
          country_iso: payload.country_iso || null,
          city: payload.city || null,
        };
        setLocationDetails(details);
        if (details.operating_company_id) {
          try {
            const companyRes = await api.get(`/companies/${details.operating_company_id}`);
            if (cancelled) return;
            const company = companyRes.data as any;
            setLocationCompanyName(company?.name || '');
          } catch (companyError: any) {
            if (cancelled) return;
            setLocationCompanyName(null);
            setLocationInfoError(
              getApiErrorMessage(companyError, t, t('messages.loadCompanyFailed')),
            );
          }
        } else {
          setLocationCompanyName(null);
        }
        const category = getHostingCategory(details.hosting_type);
        if (category === 'cloud') {
          const nextProvider = details.provider || fallbackProviderCode;
          if (nextProvider) setProvider(nextProvider);
        } else if (fallbackProviderCode) {
          setProvider(fallbackProviderCode);
        }
      } catch (err: any) {
        if (cancelled) return;
        setLocationDetails(null);
        setLocationCompanyName(null);
        setLocationInfoError(getApiErrorMessage(err, t, t('messages.loadLocationDetailsFailed')));
      } finally {
        if (!cancelled) {
          setLocationInfoLoading(false);
        }
      }
    };
    void fetchDetails();
    return () => {
      cancelled = true;
    };
  }, [locationId, getHostingCategory, fallbackProviderCode]);

  // Fetch sub-location options when locationId changes
  React.useEffect(() => {
    let cancelled = false;
    if (!locationId) {
      setSubLocationOptions([]);
      setSubLocationLoading(false);
      return () => { cancelled = true; };
    }
    setSubLocationLoading(true);
    const fetchSubLocations = async () => {
      try {
        const res = await api.get(`/locations/${locationId}/sub-items`);
        if (cancelled) return;
        setSubLocationOptions((res.data || []) as Array<{ id: string; name: string; description?: string | null }>);
      } catch {
        if (cancelled) return;
        setSubLocationOptions([]);
      } finally {
        if (!cancelled) setSubLocationLoading(false);
      }
    };
    void fetchSubLocations();
    return () => { cancelled = true; };
  }, [locationId]);

  const handleSave = async () => {
    if (!locationId) {
      setValidationError('locationRequired', t('messages.locationRequired'));
      return;
    }
    if (!kind) {
      setValidationError('assetTypeRequired', t('messages.assetTypeRequired'));
      return;
    }
    if (!provider) {
      setValidationError('providerRequired', t('messages.providerRequired'));
      return;
    }
    if (hostnameMalformed || (hostnameRequired && !hostname.trim())) {
      // The host name field already states the problem. Open the Network tab so it is on screen.
      if (isCreate && validTab !== 'network') handleTabChange('network');
      return;
    }
    setSaving(true);
    setError(null);
    try {
    const payload = {
      name: name.trim(),
      kind,
      provider,
      environment,
      hostname: hostname || null,
      domain: domain || null,
      admin_zone: adminZone || null,
      aliases: aliases.length > 0 ? aliases : null,
      ip_addresses: ipAddresses.filter((e) => e.ip.trim()).length > 0 ? ipAddresses.filter((e) => e.ip.trim()) : null,
      is_cluster: isCluster,
      status,
      go_live_date: goLiveDate || null,
      end_of_life_date: endOfLifeDate || null,
      location_id: locationId || null,
      sub_location_id: subLocationId || null,
      notes: notes || null,
    };
      if (isCreate) {
      const res = await api.post('/assets', payload);
      const newId = (res.data?.asset_reference || res.data?.id) as string;
      setDirty(false);
      navigate(`/it/assets/${newId}/overview`);
    } else {
        await api.patch(`/assets/${id}`, payload);
        setDirty(false);
        await load();
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveAssetFailed')));
    } finally {
      setSaving(false);
    }
  };

  const [assignMessage, setAssignMessage] = React.useState<string | null>(null);

  const handleRemoveAssignment = async (assignment: AssignmentRow) => {
    const name = assignment.application?.name || '';
    if (!(await dialogs.confirm({
      message: t('confirmations.removeAssignment', { name }),
      confirmLabel: t('common:buttons.remove'),
      intent: 'danger',
    }))) return;
    try {
      await api.delete(`/app-instances/${assignment.app_instance_id}/assets/${assignment.id}`);
      setAssignMessage(null);
      await refreshAssignments();
      // The impact reads the applications the asset hosts.
      void queryClient.invalidateQueries({ queryKey: ['asset-impact', id] });
      feedbackRef.current.undo(t('workspace.asset.assignments.removed', { name }), async () => {
        try {
          await api.post(`/app-instances/${assignment.app_instance_id}/assets`, {
            server_id: id,
            role: assignment.role,
            since_date: assignment.since_date,
            notes: assignment.notes,
          });
          await refreshAssignments();
          void queryClient.invalidateQueries({ queryKey: ['asset-impact', id] });
        } catch (err) {
          // The snackbar swallows a rejected undo, so the refusal is shown on the page.
          feedbackRef.current.error(getApiErrorMessage(err, t, t('messages.restoreFailed')));
        }
      });
    } catch (e: any) {
      setAssignmentsError(getApiErrorMessage(e, t, t('messages.removeServerFailed')));
    }
  };

  const { resolveTargets, questionDialog } = useClusterAssignmentQuestion();
  const [assignDialogOpen, setAssignDialogOpen] = React.useState(false);
  const [appNames, setAppNames] = React.useState<Record<string, string>>({});
  const [assigning, setAssigning] = React.useState(false);
  const [selectedAppId, setSelectedAppId] = React.useState<string | null>(null);
  const [appInstances, setAppInstances] = React.useState<Record<string, ApplicationInstance[]>>({});
  const [instanceId, setInstanceId] = React.useState<string | null>(null);
  const [assignRole, setAssignRole] = React.useState<string>('');
  const [assignSince, setAssignSince] = React.useState<string>('');
  const [assignNotes, setAssignNotes] = React.useState<string>('');
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [instancesLoading, setInstancesLoading] = React.useState(false);
  const appInstancesRef = React.useRef(appInstances);
  appInstancesRef.current = appInstances;
  const assignAppRequest = React.useRef(0);

  // The green line closes on its own, and a removal clears it at once.
  React.useEffect(() => {
    if (!assignMessage) return undefined;
    const timer = window.setTimeout(() => setAssignMessage(null), 3000);
    return () => window.clearTimeout(timer);
  }, [assignMessage]);

  const loadAppInstances = React.useCallback(async (appId: string): Promise<ApplicationInstance[]> => {
    const cached = appInstancesRef.current[appId];
    if (cached) return cached;
    setInstancesLoading(true);
    try {
      const res = await api.get(`/applications/${appId}`, { params: { include: 'instances' } });
      const instances: ApplicationInstance[] = (res.data?.instances || []).map((i: any) => ({
        id: i.id,
        environment: i.environment,
      }));
      appInstancesRef.current = { ...appInstancesRef.current, [appId]: instances };
      setAppInstances(appInstancesRef.current);
      setAppNames((prev) => ({ ...prev, [appId]: String(res.data?.name || '') }));
      return instances;
    } catch (e: any) {
      setAssignError(getApiErrorMessage(e, t, t('messages.loadAppInstancesFailed')));
      appInstancesRef.current = { ...appInstancesRef.current, [appId]: [] };
      setAppInstances(appInstancesRef.current);
      return [];
    } finally {
      setInstancesLoading(false);
    }
  }, [t]);

  const openAssignDialog = () => {
    setAssignDialogOpen(true);
    setAssignError(null);
    setAssignMessage(null);
    const defaultRole = serverRoleOptions[0]?.value || '';
    setAssignRole(defaultRole);
    setAssignSince('');
    setAssignNotes('');
    setSelectedAppId(null);
    setInstanceId(null);
  };

  const onSelectApplication = async (appId: string | null) => {
    const request = ++assignAppRequest.current;
    setSelectedAppId(appId);
    setInstanceId(null);
    if (!appId) return;
    const list = await loadAppInstances(appId);
    // A later choice of application wins. The list just read is used, not the state from before the request.
    if (assignAppRequest.current !== request) return;
    if (list.length === 1) setInstanceId(list[0].id);
  };

  const handleAssignSave = async () => {
    if (!id) return;
    if (!selectedAppId) {
      setAssignError(t('workspace.asset.assignments.applicationRequired'));
      return;
    }
    const instances = appInstancesRef.current[selectedAppId] || [];
    const newEnvironment = instanceId?.startsWith(NEW_DEPLOYMENT) ? instanceId.slice(NEW_DEPLOYMENT.length) : null;
    if (!instanceId || (!newEnvironment && !instances.some((i) => i.id === instanceId))) {
      setAssignError(t('workspace.asset.assignments.environmentRequired'));
      return;
    }
    if (!assignRole) {
      setAssignError(t('workspace.asset.assignments.roleRequired'));
      return;
    }
    setAssigning(true);
    setAssignError(null);
    try {
      let serverId = id;
      // A member of a cluster: assign to the cluster, or to this server only (A2, A3). A cluster:
      // say the members' rows it replaces (A4).
      {
        const deployment = (await api.get<{ items: Array<{ app_instance_id: string; server_id: string; role: string }> }>(`/applications/${selectedAppId}/deployment-servers`)).data?.items ?? [];
        const environment = environmentLabel(newEnvironment ?? instances.find((instance) => instance.id === instanceId)?.environment);
        const outcome = await resolveTargets({
          assetIds: [id],
          subject: `${appNames[selectedAppId] || t('components.clusterAssignment.thisApplication')} (${environment}, ${labelFor('serverRole', assignRole) || assignRole})`,
          applicationName: appNames[selectedAppId] || t('components.clusterAssignment.thisApplication'),
          role: assignRole,
          rows: deployment.filter((row) => row.app_instance_id === instanceId).map((row) => ({ asset_id: row.server_id, role: row.role })),
        });
        if (outcome.status === 'cancelled') return;
        if (outcome.status === 'inherited') {
          setAssignError(t('errors:assignment_inherited', { cluster: outcome.cluster }));
          return;
        }
        serverId = outcome.targets[0];
      }
      let deploymentId = instanceId;
      if (newEnvironment) {
        // The application has no deployment in that environment yet: create it, then assign.
        const created = (await api.post<{ id: string; environment: string }>(`/applications/${selectedAppId}/deployments`, { environment: newEnvironment })).data;
        deploymentId = created.id;
        appInstancesRef.current = {
          ...appInstancesRef.current,
          [selectedAppId]: [...instances, { id: created.id, environment: created.environment }],
        };
        setAppInstances(appInstancesRef.current);
        setInstanceId(created.id);
      }
      await api.post(`/app-instances/${deploymentId}/assets`, {
        server_id: serverId,
        role: assignRole,
        since_date: assignSince || null,
        notes: assignNotes || null,
      });
      setAssignMessage(t('workspace.asset.assignments.assignmentAdded'));
      setAssignDialogOpen(false);
      await refreshAssignments();
      // The impact reads the applications the asset hosts.
      void queryClient.invalidateQueries({ queryKey: ['asset-impact', id] });
    } catch (e: any) {
      setAssignError(getApiErrorMessage(e, t, t('messages.addAssignmentFailed')));
    } finally {
      setAssigning(false);
    }
  };

  /** A7: this cluster takes the assignment its members carry one by one (the server replaces their rows). */
  const assignGroupToCluster = async (set: GroupableSet, application: string) => {
    if (!id) return;
    if (!(await dialogs.confirm({
      message: t('components.clusterAssignment.groupConfirm', { application }),
      title: t('components.clusterAssignment.title'),
      confirmLabel: t('components.clusterAssignment.assignToCluster'),
    }))) return;
    try {
      await api.post(`/app-instances/${set.app_instance_id}/assets`, { server_id: id, role: set.role });
      await refreshAssignments();
      // The impact reads the applications the asset hosts.
      void queryClient.invalidateQueries({ queryKey: ['asset-impact', id] });
    } catch (e: any) {
      setAssignmentsError(getApiErrorMessage(e, t, t('messages.addAssignmentFailed')));
    }
  };

  const memberOptionsCombined = React.useMemo(() => {
    const map = new Map(memberOptions.map((o) => [o.id, o]));
    memberSelection.forEach((sel) => {
      if (!map.has(sel.id)) map.set(sel.id, sel);
    });
    const list = Array.from(map.values());
    return memberOptionsFull ? [...list, MORE_MEMBERS_ROW] : list;
  }, [memberOptions, memberOptionsFull, memberSelection]);
  /** The provider code of an asset: a server provider, else a hosting type. */
  const providerName = (code: string) => (
    (byField.serverProvider || []).some((o) => o.code === code) ? labelFor('serverProvider', code) : labelFor('hostingType', code)
  );

  const openMemberDialog = () => {
    setMemberDialogOpen(true);
    setMemberSaveError(null);
    setMemberSearch('');
    setMemberSelection(
      clusterMembers.map((m) => ({
        id: m.id,
        name: m.name,
        environment: m.environment,
        kind: m.kind,
        provider: m.provider,
        is_cluster: false,
      })),
    );
  };

  /** A cluster with members has no operating system: asked once, in one sentence, before it is removed. */
  const confirmOperatingSystemRemoval = (os: string) => dialogs.confirm({
    title: t('workspace.asset.editMembersDialog.removeOsTitle'),
    message: t('workspace.asset.editMembersDialog.removeOsMessage', { os }),
    confirmLabel: t('workspace.asset.editMembersDialog.removeOsConfirm'),
  });

  /** The rows of a server (`GET /assets/:id/assignments`); `fallback` when the read fails. */
  const readAssignments = async (assetId: string, fallback: AssignmentRow[]): Promise<AssignmentRow[]> => {
    try {
      const rows = (await api.get<AssignmentRow[]>(`/assets/${assetId}/assignments`)).data;
      return Array.isArray(rows) ? rows : fallback;
    } catch {
      return fallback;
    }
  };

  /**
   * A8: the applications a removed member stops hosting, by name: those the cluster carries on its
   * own rows, except those the member also holds directly or through another cluster.
   */
  const lostApplicationNames = async (clusterRows: AssignmentRow[], memberId: string): Promise<string[]> => {
    const kept = new Set((await readAssignments(memberId, []))
      .filter((row) => !row.inherited || (row.via_clusters ?? []).some((via) => via.id !== id))
      .map((row) => row.application.id));
    return Array.from(new Set(clusterRows
      .filter((row) => !row.inherited && !kept.has(row.application.id))
      .map((row) => row.application.name)))
      .sort((a, b) => a.localeCompare(b));
  };

  /** "CheeseTrack, Sage X3 and 2 others": the first three, then a count. */
  const applicationList = (names: string[]) => joinNames(
    names.length > 3
      ? [...names.slice(0, 3), t('workspace.asset.editMembersDialog.andOthers', { count: names.length - 3 })]
      : names,
    locale,
  );

  /**
   * One question for what a save takes away: the applications each removed member stops hosting (A8)
   * and, with the first members, the operating system of the cluster. One sentence per fact.
   */
  const confirmMemberChanges = (lines: string[], os: string | null) => {
    if (lines.length === 0) return confirmOperatingSystemRemoval(os ?? '');
    return dialogs.confirm({
      title: t('workspace.asset.editMembersDialog.removeMembersTitle'),
      message: (
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          {[...lines, ...(os ? [t('workspace.asset.editMembersDialog.removeOsMessage', { os })] : [])].map((line) => (
            <Typography key={line} sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>{line}</Typography>
          ))}
        </Box>
      ),
      confirmLabel: t('workspace.asset.editMembersDialog.removeAnyway'),
    });
  };

  const handleSaveMembers = async () => {
    if (isCreate || !id) return;
    const ids = memberSelection.map((m) => m.id);
    let removeOperatingSystem = false;
    // A8: the members taken out stop hosting what the cluster carries.
    const removed = clusterMembers.filter((m) => !ids.includes(m.id));
    const clusterRows = removed.length > 0 && id ? await readAssignments(id, assignments) : [];
    const lines: string[] = [];
    for (const m of removed) {
      const applications = clusterRows.length > 0 ? await lostApplicationNames(clusterRows, m.id) : [];
      if (applications.length > 0) {
        lines.push(t('workspace.asset.editMembersDialog.removeMemberLine', { member: m.name, applications: applicationList(applications) }));
      }
    }
    // The first members of a cluster that carries an operating system take it away.
    const os = ids.length > 0 && data?.operating_system ? data.operating_system : null;
    if (lines.length > 0 || os) {
      if (!(await confirmMemberChanges(lines, os))) return;
      removeOperatingSystem = !!os;
    }
    setMemberSaveError(null);
    for (;;) {
      setMemberSaving(true);
      try {
        await api.post(`/assets/${id}/members`, {
          server_ids: ids,
          ...(removeOperatingSystem ? { remove_operating_system: true } : {}),
        });
        setMemberDialogOpen(false);
        await loadClusterMembers();
        // A cluster's technologies, vulnerabilities and severe badge follow its members: every save
        // that changes them reads those again, and so do the applications it inherits from them.
        void invalidateTechnologyLinks(queryClient);
        void refreshAssignments();
        if (removeOperatingSystem) {
          // The asset and its technologies no longer carry the system.
          void load();
        }
        // The impact reads the members of a cluster.
        void queryClient.invalidateQueries({ queryKey: ['asset-impact', id] });
        return;
      } catch (e: any) {
        // A system set since the dialog opened: the same question.
        const refused = e?.response?.data;
        if (!removeOperatingSystem && refused?.code === 'cluster_os_with_members') {
          setMemberSaving(false);
          if (!(await confirmOperatingSystemRemoval(String(refused?.params?.os ?? '')))) return;
          removeOperatingSystem = true;
          continue;
        }
        setMemberSaveError(getApiErrorMessage(e, t, t('messages.saveMembersFailed')));
        return;
      } finally {
        setMemberSaving(false);
      }
    }
  };

  const createDisabled =
    saving ||
    locationInfoLoading ||
    !name.trim() ||
    !locationId ||
    !kind ||
    !provider;
  const locationCategory = locationDetails ? getHostingCategory(locationDetails.hosting_type) : null;
  const loadingPlaceholder = '-';
  const hostingTypeDisplay = locationDetails
    ? labelFor('hostingType', locationDetails.hosting_type) || locationDetails.hosting_type
    : loadingPlaceholder;
  const providerOrCompanyLabel = locationCategory === 'cloud'
    ? t('workspace.asset.overview.cloudProvider')
    : locationCategory === 'on_prem'
      ? t('workspace.asset.overview.operatingCompany')
      : t('workspace.asset.overview.operatingCompanyCloudProvider');
  const providerOrCompanyDisplay = locationDetails
    ? locationCategory === 'cloud'
      ? locationDetails.provider
        ? labelFor('serverProvider', locationDetails.provider) || locationDetails.provider
        : '-'
      : locationCompanyName || '-'
    : loadingPlaceholder;
  const countryDisplay = locationDetails && locationDetails.country_iso
    ? (() => {
        const code = (locationDetails.country_iso || '').toUpperCase();
        const name = countryName(code);
        return `${name} (${code})`;
      })()
    : locationDetails
      ? '-'
      : loadingPlaceholder;
  const cityDisplay = locationDetails
    ? locationDetails.city || '-'
    : loadingPlaceholder;

  // Navigation for prev/next
  const sort = searchParams.get('sort') || 'created_at:DESC';
  const q = searchParams.get('q') || '';
  const filters = searchParams.get('filters') || '';
  const nav = useAssetNav({
    id,
    sort,
    q,
    filters,
    extraParams: { language: screenLanguage(i18n.resolvedLanguage || i18n.language) },
  });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as any, nextId: null as any }
    : nav;
  // One read for both tabs and both badges; the tabs write through the same key.
  const assetRelationsQuery = useQuery({
    queryKey: assetRelationsKey(id),
    queryFn: () => fetchAssetRelationsTab(id),
    enabled: !isCreate && !!id,
  });
  const relationCounts = assetRelationsQuery.data?.counts;
  // One query for the Vulnerabilities section and the severe badge. Its key sits under the asset's
  // technologies: every change of a technology link (`invalidateTechnologyLinks`), on this asset or on
  // the host or cluster that carries technologies to it, reads it again. While the search is still
  // pending (a match, or the first collection of a linked product), it reads again every second,
  // and stops once the answer is no longer pending.
  const { config: featuresConfig } = useFeatures();
  const vulnerabilityFeed = featuresConfig.features.vulnerabilityFeed === true;
  const assetVulnerabilitiesKey = React.useMemo(() => ['asset-technologies', id, 'vulnerabilities'] as const, [id]);
  const assetVulnerabilitiesQuery = useQuery({
    queryKey: assetVulnerabilitiesKey,
    queryFn: async () => (await api.get<ReachVulnerabilities>(`/assets/${id}/vulnerabilities`)).data,
    enabled: vulnerabilityFeed && !isCreate && !!id,
    refetchInterval: (query) => reachVulnerabilitiesRefetchMs(query.state.data),
  });
  // A retired asset counts nothing (`totals: null`): no section and no badge.
  const reachVulnerabilities = vulnerabilityFeed && !isCreate && assetVulnerabilitiesQuery.data?.totals
    ? assetVulnerabilitiesQuery.data
    : null;
  // A cluster's badge counts its members' vulnerabilities too (`member_totals`), as its column in the list does.
  const badgeTotals = reachVulnerabilities ? reachVulnerabilities.member_totals ?? reachVulnerabilities.totals : null;
  // The metadata bar appears in one go: hidden on its line until the asset and its vulnerabilities
  // have arrived, so the severe badge does not push the header down afterwards. A failed read shows
  // the bar without the badge.
  const assetLoading = !isCreate && !data && !error;
  const metadataPending = assetLoading
    || (vulnerabilityFeed && !isCreate && !!id && assetVulnerabilitiesQuery.isPending);

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sortVal = searchParams.get('sort');
    const qVal = searchParams.get('q');
    if (sortVal) sp.set('sort', sortVal);
    if (qVal) sp.set('q', qVal);
    carryListFilters(sp, searchParams);
    return sp;
  }, [searchParams]);

  // A former or unknown tab key, or a tab a creation cannot open, gets the address of the tab shown.
  React.useEffect(() => {
    if (!rawTab) return;
    const createBlocked = isCreate && CREATE_DISABLED_TABS.has(tab);
    if (VALID_ASSET_TABS.has(rawTab as TabKey) && !createBlocked) return;
    if (!isCreate && data && !routeMatchesLoadedAsset) return;
    const qs = listContextParams.toString();
    const target: TabKey = createBlocked ? 'overview' : tab;
    navigate(`/it/assets/${workspaceRouteId}/${target}${qs ? `?${qs}` : ''}`, { replace: true });
  }, [data, isCreate, listContextParams, navigate, rawTab, routeMatchesLoadedAsset, tab, workspaceRouteId]);

  const handleReset = () => {
    setName(data?.name || '');
    setDirty(false);
    load();
  };

  // Autosaves run one at a time, in the order they were made: a field changed while another saves
  // waits for it, and keeps its new value while that first answer arrives (`pendingPatches`). Each
  // save keeps the asset it was made on: the fiche remounts per asset, so a queue left behind
  // finishes on its own asset and never paints or writes the next one.
  const saveTail = React.useRef<Promise<unknown> | null>(null);
  const pendingPatches = React.useRef<Array<{ patch: Record<string, unknown> }>>([]);

  const patchAsset = React.useCallback(async (patch: Partial<AssetRecord> & { sub_location_id?: string | null }) => {
    if (isCreate) {
      setDirty(true);
      return false;
    }
    // Writes go to the asset on screen, never to whichever id the address resolved to afterwards.
    const targetId = shownAssetIdRef.current;
    if (!targetId || dataRef.current?.id !== targetId) return false;
    let safePatch = patch;
    if (netboxManaged) {
      safePatch = Object.fromEntries(
        Object.entries(patch).filter(([key]) => !(
          NETBOX_LOCKABLE_ASSET_FIELDS.includes(key as never)
          && netboxOwns(key as NetboxLockableField)
        )),
      ) as typeof patch;
      if (Object.keys(safePatch).length === 0) return false;
    }
    setSaving(true);
    setError(null);
    setData((prev) => (prev && prev.id === targetId ? ({ ...prev, ...safePatch } as AssetRecord) : prev));
    const entry = { patch: safePatch as Record<string, unknown> };
    pendingPatches.current.push(entry);
    const settle = () => {
      pendingPatches.current = pendingPatches.current.filter((pending) => pending !== entry);
      if (pendingPatches.current.length === 0 && shownAssetIdRef.current === targetId) setSaving(false);
    };
    const run = async (): Promise<boolean> => {
      try {
        const res = await api.patch(`/assets/${targetId}`, safePatch);
        settle();
        const returned = res.data as AssetRecord | undefined;
        // A response for an asset the screen no longer shows must not replace the fiche.
        if (shownAssetIdRef.current !== targetId || (returned?.id && returned.id !== targetId)) return false;
        // The changes still waiting for their own save stay shown over this answer.
        const waiting = Object.assign({}, ...pendingPatches.current.map((pending) => pending.patch));
        setData({ ...(returned as AssetRecord), ...waiting } as AssetRecord);
        if (pendingPatches.current.length === 0) setDirty(false);
        // Retiring an asset, or bringing it back, changes what it counts.
        if ('status' in safePatch) void queryClient.invalidateQueries({ queryKey: assetVulnerabilitiesKey });
        return true;
      } catch (e: any) {
        settle();
        // The screen moved on: the failure belongs to the asset we left, not the one now shown.
        if (shownAssetIdRef.current !== targetId) return false;
        const message = getApiErrorMessage(e, t, t('messages.saveAssetFailed'));
        // load() clears the banner before it reads the asset back. Put the refusal back afterwards,
        // unless the field that was saved already shows it (an IP address).
        const shownOnField = Object.prototype.hasOwnProperty.call(safePatch, 'ip_addresses');
        await load();
        if (shownAssetIdRef.current !== targetId) return false;
        if (!shownOnField) setError(message);
        throw e;
      }
    };
    const previous = saveTail.current;
    const result = previous ? previous.then(run, run) : run();
    const tail = result.catch(() => undefined);
    saveTail.current = tail;
    void tail.then(() => {
      if (saveTail.current === tail) saveTail.current = null;
    });
    return result;
  }, [assetVulnerabilitiesKey, isCreate, load, netboxManaged, netboxOwns, queryClient, t]);

  // A field saves on blur. The banner already shows a refusal; the rejected promise must not
  // reach the console (a host name that duplicates another FQDN answers 409).
  const savePatch = React.useCallback((patch: Parameters<typeof patchAsset>[0]) => {
    void patchAsset(patch).catch(() => undefined);
  }, [patchAsset]);

  const handleNotesChange = React.useCallback((value: string) => {
    setNotes(value);
    if (isCreate) {
      setDirty(true);
      return;
    }
    const assetId = shownAssetIdRef.current;
    if (!assetId) return;
    pendingNotesRef.current = { assetId, value };
    if (notesSaveTimerRef.current != null) {
      window.clearTimeout(notesSaveTimerRef.current);
    }
    notesSaveTimerRef.current = window.setTimeout(() => {
      notesSaveTimerRef.current = null;
      const pending = pendingNotesRef.current;
      pendingNotesRef.current = null;
      // The screen moved on: the route change saves this description on the asset it was typed on.
      if (!pending || shownAssetIdRef.current !== pending.assetId) return;
      if ((pending.value || '') === (dataRef.current?.notes || '')) return;
      savePatch({ notes: pending.value || null });
    }, 900);
  }, [isCreate, savePatch]);

  React.useEffect(() => () => {
    if (notesSaveTimerRef.current != null) {
      window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }
    const pending = pendingNotesRef.current;
    pendingNotesRef.current = null;
    if (!pending) return;
    const saved = dataRef.current?.id === pending.assetId ? (dataRef.current.notes || '') : '';
    if ((pending.value || '') === saved) return;
    void api.patch(`/assets/${pending.assetId}`, { notes: pending.value || null }).catch(() => undefined);
  }, []);

  const confirmAndNavigate = React.useCallback(async (targetId: string | null) => {
    if (!targetId) return;
    if (isCreate && dirty) {
      // True saves, then the move continues. False drops the draft and still moves.
      const proceed = await dialogs.confirm(unsavedConfirm(t, 'saveAndLeave'));
      if (proceed) {
        try { await handleSave(); } catch { return; }
      } else {
        handleReset();
      }
    }
    const qs = listContextParams.toString();
    navigate(`/it/assets/${targetId}/${tab}${qs ? `?${qs}` : ''}`);
  }, [dialogs, dirty, handleSave, handleReset, isCreate, listContextParams, navigate, tab, t]);

  // True leaves and drops the draft. False stays. A menu link asks the same question.
  const confirmLeaveWithoutSaving = React.useCallback(async () => {
    if (!(isCreate && dirty)) return true;
    return dialogs.confirm(unsavedConfirm(t, 'leaveWithoutSaving'));
  }, [dialogs, dirty, isCreate, t]);
  useLeaveGuard(() => isCreate && dirty, confirmLeaveWithoutSaving);

  const handleClose = async () => {
    if (!(await confirmLeaveWithoutSaving())) return;
    const qs = listContextParams.toString();
    navigate(`/it/assets${qs ? `?${qs}` : ''}`);
  };

  const showPhysicalTabs = isPhysicalAsset || (!settings && PHYSICAL_ONLY_TABS.has(tab));

  const workspaceTabs = [
    { key: 'overview', label: t('workspace.asset.tabs.overview') },
    { key: 'operations', label: t('workspace.asset.tabs.operations'), disabled: isCreate },
    { key: 'network', label: t('workspace.asset.tabs.network') },
    ...(showPhysicalTabs ? [
      { key: 'hardware', label: t('workspace.asset.tabs.hardware'), disabled: isCreate },
    ] : []),
    {
      key: 'dependencies',
      label: t('workspace.asset.tabs.dependencies'),
      // Relations between assets: the one thing the tab shows. Nothing while the shared read is in
      // flight: 0 would flash before the real count.
      badge: assetRelationsQuery.data ? (relationCounts?.assets ?? 0) : undefined,
      disabled: isCreate,
    },
    { key: 'relations', label: t('workspace.asset.tabs.relations'), badge: assetRelationsBadge(assetRelationsQuery.data) ?? 0, disabled: isCreate },
    { key: RECORD_HISTORY_TAB_KEY, label: t('workspace.asset.tabs.history'), disabled: isCreate },
  ];

  const canonicalPathFor = (targetId: string, nextTab: TabKey = validTab) => {
    const qs = listContextParams.toString();
    const targetRouteId = targetId === id || targetId === data?.id ? workspaceRouteId : targetId;
    return `/it/assets/${targetRouteId}/${nextTab}${qs ? `?${qs}` : ''}`;
  };

  const handleTabChange = (nextTab: string) => {
    navigate(canonicalPathFor(id, nextTab as TabKey));
  };

  const updateAssetType = (nextValue: string) => {
    setKind(nextValue);
    if (isCreate) {
      setDirty(true);
    } else if (nextValue) {
      savePatch({ kind: nextValue });
    }
  };

  const updateLocation = (nextValue: string | null) => {
    if (!nextValue && !isCreate) {
      setValidationError('locationRequired', t('messages.locationRequired'));
      return;
    }
    if (nextValue !== locationId) {
      setSubLocationId(null);
    }
    setLocationId(nextValue);
    if (isCreate) {
      setDirty(true);
    } else {
      savePatch({ location_id: nextValue, sub_location_id: null });
    }
  };

  const updateScalar = <K extends keyof AssetRecord>(key: K, value: AssetRecord[K]) => {
    if (isCreate) {
      setDirty(true);
      return;
    }
    savePatch({ [key]: value } as Partial<AssetRecord>);
  };

  const persistIpAddresses = (nextEntries: IpAddressEntry[]) => {
    const clean = nextEntries.filter((entry) => entry.ip.trim()).map((entry) => ({ ...entry, ip: entry.ip.trim() }));
    if (isCreate) {
      setDirty(true);
      return;
    }
    // Choosing a type or a subnet on an empty row writes nothing: the row would otherwise
    // be dropped, because only rows with an address are stored.
    const savedKey = JSON.stringify((dataRef.current?.ip_addresses || []).map((entry) => ({
      type: entry.type, ip: (entry.ip || '').trim(), subnet_cidr: entry.subnet_cidr || null,
    })));
    const nextKey = JSON.stringify(clean.map((entry) => ({
      type: entry.type, ip: entry.ip, subnet_cidr: entry.subnet_cidr || null,
    })));
    if (savedKey === nextKey) return;
    void patchAsset({ ip_addresses: clean.length > 0 ? clean : null }).then(() => {
      setIpFieldError(null);
    }).catch((e: unknown) => {
      keepLocalIps.current = true;
      setIpAddresses(nextEntries);
      const value = (e as { response?: { data?: { params?: { value?: unknown } } } })?.response?.data?.params?.value;
      const index = typeof value === 'string'
        ? nextEntries.findIndex((entry) => entry.ip.trim() === value)
        : -1;
      setIpFieldError({
        index: index >= 0 ? index : 0,
        message: getApiErrorMessage(e, t, t('messages.saveAssetFailed')),
      });
    });
  };

  const lifecycleMetadataOptions = lifecycleOptions.map((option) => ({
    value: option.value,
    label: option.label,
    color: getDotColor(LIFECYCLE_COLORS[option.value] || 'default', theme.palette.mode),
  }));

  const environmentMetadataOptions = ENV_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    color: getEnvDotColor(option.value, theme.palette.mode),
  }));

  const assetTypeLabel = labelFor('serverKind', kind) || kind || notSetLabel;
  const locationLabel = locationDetails
    ? `${locationDetails.location_reference} · ${locationDetails.name}`
    : (locationId ? t('common.loading') : notSetLabel);

  const actions = (
    <>
      {isCreate && (
        <Button variant="contained" onClick={() => void handleSave()} disabled={createDisabled} size="small">
          {t('common:buttons.create')}
        </Button>
      )}
      {!isCreate && canDelete && (
        <DeleteIconButton
          onClick={async () => {
            if (!id) return;
            // Asked first: an asset still in use gets the refusal and why, with Close only.
            const { refusal, lines } = await assetDeleteCheck(id, t, locale);
            if (refusal) {
              await dialogs.alert({
                title: t('common:delete.recordTitle', { name: data?.name || name }),
                message: deleteFailureReason(refusal, t, locale),
              });
              return;
            }
            const question = t('workspace.asset.deleteConfirm', { name: data?.name || name });
            if (!(await dialogs.confirm({
              // What the delete takes with it, one line per case; the asset itself is always deleted.
              message: lines.length > 0 ? [question, ...lines].join('\n') : question,
              confirmLabel: lines.length > 0 ? t('common:delete.anyway') : t('common:buttons.delete'),
              intent: 'danger',
            }))) return;
            try {
              await api.delete(`/assets/${id}`);
            } catch (e) {
              setError(getApiErrorMessage(e, t, t('common:delete.failedGeneric')));
              return;
            }
            await handleClose();
          }}
        />
      )}
      {!isCreate && data && id && (
        <SendLinkButton
          itemType="asset"
          itemId={id}
          itemRef={data.asset_reference || null}
          itemName={data.name || name || t('workspace.asset.untitled')}
        />
      )}
      <IconButton onClick={() => { void handleClose(); }} title={t('common.close')} aria-label={t('common.close')} size="small">
        <CloseIcon />
      </IconButton>
    </>
  );

  const properties = (
    <>
      <PropertyGroup>
        <PropertyRow label={t('workspace.asset.overview.assetType')} required>
          <Autocomplete
            options={kindOptions.filter((opt) => !opt.deprecated || opt.value === kind)}
            value={kind ? kindOptions.find((opt) => opt.value === kind) || { value: kind, label: kind, deprecated: false } : null}
            onChange={(_, val) => updateAssetType(val?.value || '')}
            getOptionLabel={(opt) => opt.label}
            isOptionEqualToValue={(opt, val) => opt.value === val.value}
            disabled={!canEditNetboxField('kind')}
            renderInput={(params) => (
              <TextField
                {...params}
                variant="standard"
                placeholder={t('workspace.asset.overview.searchAssetTypes')}
                sx={drawerFieldValueSx}
              />
            )}
            ListboxProps={{ sx: drawerAutocompleteListboxSx }}
            fullWidth
          />
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.meta.cluster')}>
          {/* A span carries the tooltip: it also shows on a disabled switch. */}
          <Tooltip title={canManage ? t('workspace.asset.clusterSwitch.hint') : t('workspace.asset.readOnlyRole')}>
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <Switch
                checked={isCluster}
                onChange={(e) => {
                  // The switch stays enabled while it saves, so that the focus stays on it: a second click waits.
                  if (clusterSwitchSaving) return;
                  const next = e.target.checked;
                  setIsCluster(next);
                  if (isCreate) {
                    setDirty(true);
                    return;
                  }
                  setClusterSwitchSaving(true);
                  const targetId = shownAssetIdRef.current;
                  void (async () => {
                    let sent = false;
                    try {
                      // A refusal (members left, a membership) shows as the page's error, and the switch goes back.
                      sent = await patchAsset({ is_cluster: next });
                    } catch {
                      return;
                    } finally {
                      setClusterSwitchSaving(false);
                    }
                    // The screen moved on: the impact of another asset is not this one's.
                    if (!sent || !targetId || shownAssetIdRef.current !== targetId) return;
                    // The impact reads the members of a cluster.
                    void queryClient.invalidateQueries({ queryKey: ['asset-impact', targetId] });
                  })();
                }}
                disabled={!canManage}
                color="primary"
                size="small"
                inputProps={{ 'aria-label': t('workspace.asset.meta.cluster') }}
              />
            </Box>
          </Tooltip>
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.technical.environment')}>
          <Select
            value={environment}
            onChange={(e) => {
              const next = e.target.value;
              setEnvironment(next);
              updateScalar('environment', next as AssetRecord['environment']);
            }}
            variant="standard"
            disabled={!canManage}
            sx={drawerSelectSx}
          >
            {ENV_OPTIONS.map((opt) => <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>)}
          </Select>
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.technical.adminZone')}>
          <Select
            value={adminZone}
            onChange={(e) => {
              const next = e.target.value;
              setAdminZone(next);
              updateScalar('admin_zone', (next || null) as AssetRecord['admin_zone']);
            }}
            variant="standard"
            disabled={!canManage}
            displayEmpty
            SelectDisplayProps={{ 'aria-label': t('workspace.asset.technical.adminZone') } as React.HTMLAttributes<HTMLDivElement>}
            sx={drawerSelectSx}
            renderValue={(value) => (value
              ? adminZoneOptions.find((opt) => opt.value === value)?.label ?? String(value)
              : <Box component="span" sx={(muiTheme) => ({ color: muiTheme.palette.kanap.text.tertiary })}>{t('pages.administrationView.noZone')}</Box>)}
          >
            <MenuItem value="" sx={drawerMenuItemSx}>{t('pages.administrationView.noZone')}</MenuItem>
            {adminZoneOptions.map((opt) => <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>)}
          </Select>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('workspace.asset.overview.location')} required>
          <Box sx={drawerFieldValueSx}>
            <LocationSelect
              value={locationId}
              onChange={updateLocation}
              label={t('workspace.asset.overview.location')}
              required
              size="small"
              hideLabel
              textFieldSx={drawerFieldValueSx}
              disabled={!canEditNetboxField('location_id')}
            />
          </Box>
        </PropertyRow>
        {subLocationOptions.length > 0 && (
          <PropertyRow label={t('workspace.asset.overview.subLocation')}>
            <Autocomplete
              options={subLocationOptions}
              getOptionLabel={(option) => option.name}
              value={subLocationOptions.find((o) => o.id === subLocationId) || null}
              onChange={(_, val) => {
                const next = val?.id || null;
                setSubLocationId(next);
                if (isCreate) setDirty(true);
                else savePatch({ sub_location_id: next });
              }}
              loading={subLocationLoading}
              disabled={!canManage || !locationId}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder={t('workspace.asset.overview.searchSubLocations')}
                  sx={drawerFieldValueSx}
                />
              )}
              renderOption={(props, option) => (
                <OptionWithHint key={option.id} optionProps={props} label={option.name} hint={option.description} />
              )}
              ListboxProps={{ sx: drawerAutocompleteListboxSx }}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              fullWidth
            />
          </PropertyRow>
        )}
        {(locationId || !isCreate) && (
          <>
            {locationInfoError && (
              <PropertyRow label={t('workspace.asset.overview.locationContext')}>
                <Typography sx={(muiTheme) => ({ fontSize: 13, color: muiTheme.palette.kanap.text.secondary })}>
                  {locationInfoError}
                </Typography>
              </PropertyRow>
            )}
            <PropertyRow label={t('workspace.asset.overview.hostingType')}>{hostingTypeDisplay}</PropertyRow>
            <PropertyRow label={providerOrCompanyLabel}>{providerOrCompanyDisplay}</PropertyRow>
            <PropertyRow label={t('workspace.asset.overview.country')}>{countryDisplay}</PropertyRow>
            <PropertyRow label={t('workspace.asset.overview.city')}>{cityDisplay}</PropertyRow>
          </>
        )}
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label={t('workspace.asset.overview.lifecycle')}>
          <Select
            value={status}
            onChange={(e) => {
              const next = e.target.value;
              setStatus(next);
              updateScalar('status', next as AssetRecord['status']);
            }}
            variant="standard"
            disabled={!canEditNetboxField('status')}
            sx={drawerSelectSx}
          >
            {lifecycleOptions.map((opt) => <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>)}
          </Select>
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.overview.goLiveDate')}>
          <DateEUField label="" valueYmd={goLiveDate} onChangeYmd={(val) => { setGoLiveDate(val); updateScalar('go_live_date', (val || null) as AssetRecord['go_live_date']); }} disabled={!canManage} size="small" hideLabel textFieldSx={drawerFieldValueSx} />
        </PropertyRow>
        <PropertyRow label={t('workspace.asset.overview.endOfLifeDate')}>
          <DateEUField label="" valueYmd={endOfLifeDate} onChangeYmd={(val) => { setEndOfLifeDate(val); updateScalar('end_of_life_date', (val || null) as AssetRecord['end_of_life_date']); }} disabled={!canManage} size="small" hideLabel textFieldSx={drawerFieldValueSx} />
        </PropertyRow>
      </PropertyGroup>
    </>
  );

  // The cluster sections at the top of the Operations tab, which is off in creation.
  const membersPending = isCluster && !isCreate && (clusterLoading || membersLoadedFor !== id);
  const clusterSection = (
    <>
      {isCluster && (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <SectionLabel>{t('workspace.asset.technical.members')}</SectionLabel>
              <InfoHint text={t('workspace.asset.clusterSwitch.membersHint')} />
            </Stack>
            {!membersPending && (
              <Tooltip title={canManage ? '' : t('workspace.asset.readOnlyRole')}>
                <Box component="span">
                  <Button
                    variant="action"
                    size="small"
                    onClick={openMemberDialog}
                    disabled={!canManage}
                  >
                    {clusterMembers.length === 0 ? t('workspace.asset.technical.addMembers') : t('workspace.asset.technical.editMembers')}
                  </Button>
                </Box>
              </Tooltip>
            )}
          </Stack>
          {clusterError && <Alert severity="error" sx={{ mb: 1 }}>{clusterError}</Alert>}
          {membersPending && (
            <Typography variant="body2" color="text.secondary">{t('workspace.asset.technical.loadingMembers')}</Typography>
          )}
          {!membersPending && clusterMembers.length > 0 && (
            <Table size="small" sx={denseTableSx}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('workspace.asset.technical.clusterTableHeaders.name')}</TableCell>
                  <TableCell>{t('workspace.asset.technical.clusterTableHeaders.environment')}</TableCell>
                  <TableCell>{t('workspace.asset.technical.clusterTableHeaders.status')}</TableCell>
                  <TableCell>{t('workspace.asset.technical.clusterTableHeaders.operatingSystem')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {clusterMembers.map((member) => (
                  <TableRow key={member.id} hover>
                    <TableCell>
                      <Button size="small" onClick={() => navigate(`/it/assets/${member.id}/overview`)}>
                        {member.name}
                      </Button>
                    </TableCell>
                    <TableCell>{environmentLabel(member.environment)}</TableCell>
                    <TableCell>{labelFor('lifecycleStatus', member.status) || member.status}</TableCell>
                    <TableCell>{member.operating_system || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      )}
      {!isCluster && (clustersError || clustersForServer.length > 0) && (
        <Box>
          <Box sx={{ mb: 1 }}>
            <SectionLabel>{t('workspace.asset.technical.clusterMembership')}</SectionLabel>
          </Box>
          {clustersError && <Alert severity="error" sx={{ mb: 1 }}>{clustersError}</Alert>}
          {clustersForServer.length > 0 && (
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              {clustersForServer.map((c) => (
                <Stack key={c.id} direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Button size="small" onClick={() => navigate(`/it/assets/${c.id}/overview`)}>{c.name}</Button>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {environmentLabel(c.environment)} / {labelFor('lifecycleStatus', c.status) || c.status}
                    </Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">{t('workspace.asset.meta.cluster')}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Box>
      )}
    </>
  );

  // An asset that could not be read is a screen of its own: an empty editable fiche stays hidden.
  // Only a 404 is "not found" (the English refusal stays hidden); any other failure says what
  // went wrong and offers to read the asset again.
  if (!isCreate && !data && loadFailure !== null) {
    const qs = listContextParams.toString();
    const notFound = loadFailure === 404;
    return (
      <Box sx={{ p: 2 }}>
        {notFound ? (
          <Alert severity="error">{t('workspace.asset.notFound')}</Alert>
        ) : (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={() => { void load(true); }}>{t('common:buttons.retry')}</Button>}
          >
            {error?.message || t('messages.loadAssetFailed')}
          </Alert>
        )}
        <MuiLink
          component={RouterLink}
          to={`/it/assets${qs ? `?${qs}` : ''}`}
          sx={{ display: 'inline-block', mt: 2, fontSize: 13, fontWeight: 400, color: 'kanap.teal' }}
        >
          {t('workspace.asset.backToList')}
        </MuiLink>
      </Box>
    );
  }

  return (
    <ApplicationFeedbackProvider onError={setError} capture={feedbackRef}>
    <Box sx={{ height: '100%', minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={error ? <Alert severity="error">{error.message}</Alert> : undefined}
        activeTab={validTab}
        tabs={workspaceTabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.assets.drawerOpen"
        backLabel={t('pages.assets.title')}
        onBack={handleClose}
        itemReference={!isCreate ? data?.asset_reference || data?.id?.slice(0, 8) || null : null}
        onCopyReference={!isCreate && (data?.asset_reference || data?.id) ? () => { void navigator.clipboard?.writeText(data?.asset_reference || data?.id || ''); } : undefined}
        title={isCreate ? name : data?.name || name || ''}
        // While the asset loads, an empty title keeps its line: "Untitled" is for a loaded asset without a name.
        titleFallback={isCreate ? t('workspace.asset.newAsset') : assetLoading ? '\u00A0' : t('workspace.asset.untitled')}
        canEditTitle={canEditNetboxField('name') && !assetLoading}
        titleMaxLength={ASSET_NAME_MAX}
        onTitleSave={(value) => {
          const next = value.trim().slice(0, ASSET_NAME_MAX);
          if (!next) return;
          setName(next);
          if (isCreate) setDirty(true);
          else savePatch({ name: next });
        }}
        isCreate={isCreate}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void confirmAndNavigate(prevId); },
          onNext: () => { void confirmAndNavigate(nextId); },
          previousLabel: t('workspace.asset.previous'),
          nextLabel: t('workspace.asset.next'),
        } : undefined}
        onSaveShortcut={isCreate ? () => { void handleSave(); } : undefined}
        metadata={!isCreate ? (
          <PendingMetadata pending={metadataPending}>
            <PortfolioStatusMetadata
              value={status || 'active'}
              label={lifecyclePillLabel(labelFor('lifecycleStatus', status), status, notSetLabel)}
              color={getDotColor(LIFECYCLE_COLORS[status] || 'default', theme.palette.mode)}
              options={lifecycleMetadataOptions}
              onChange={(value) => {
                setStatus(value);
                savePatch({ status: value });
              }}
              disabled={!canEditNetboxField('status')}
            />
            <PortfolioStatusMetadata
              value={environment}
              label={ENV_OPTIONS.find((option) => option.value === environment)?.label || environment}
              color={getEnvDotColor(environment, theme.palette.mode)}
              options={environmentMetadataOptions}
              onChange={(value) => {
                setEnvironment(value);
                savePatch({ environment: value });
              }}
              disabled={!canManage}
            />
            <PortfolioMetadataItem
              onClick={(event) => setAssetTypeAnchorEl(event.currentTarget)}
              disabled={!canEditNetboxField('kind') || saving}
              title={t('workspace.asset.meta.editAssetType')}
            >
              {assetTypeLabel}
            </PortfolioMetadataItem>
            <Menu
              anchorEl={assetTypeAnchorEl}
              open={!!assetTypeAnchorEl}
              onClose={() => setAssetTypeAnchorEl(null)}
            >
              {kindOptions.filter((option) => !option.deprecated || option.value === kind).map((option) => (
                <MenuItem
                  key={option.value}
                  selected={option.value === kind}
                  onClick={() => {
                    updateAssetType(option.value);
                    setAssetTypeAnchorEl(null);
                  }}
                  sx={drawerMenuItemSx}
                >
                  {option.label}
                </MenuItem>
              ))}
            </Menu>
            {isCluster && <PortfolioMetadataItem>{t('workspace.asset.meta.cluster')}</PortfolioMetadataItem>}
            <PortfolioMetadataItem
              label={t('workspace.asset.overview.location')}
              onClick={(event) => setLocationAnchorEl(event.currentTarget)}
              disabled={!canEditNetboxField('location_id') || saving}
              title={t('workspace.asset.meta.editLocation')}
            >
              {locationLabel}
            </PortfolioMetadataItem>
            <Menu
              anchorEl={locationAnchorEl}
              open={!!locationAnchorEl}
              onClose={() => setLocationAnchorEl(null)}
            >
              {locationOptions.map((option) => (
                <MenuItem
                  key={option.id}
                  selected={option.id === locationId}
                  onClick={() => {
                    updateLocation(option.id);
                    setLocationAnchorEl(null);
                  }}
                  sx={drawerMenuItemSx}
                >
                  <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, color: 'kanap.text.secondary', mr: 0.75 }}>
                    {option.location_reference}
                  </Box>
                  {option.name}
                </MenuItem>
              ))}
            </Menu>
            <PortfolioMetadataItem
              label={t('workspace.asset.meta.goLive')}
              onClick={(event) => setGoLiveAnchorEl(event.currentTarget)}
              disabled={!canManage || saving}
              title={t('workspace.asset.meta.editGoLive')}
            >
              {formatShortDate(goLiveDate, locale, { empty: notSetLabel })}
            </PortfolioMetadataItem>
            <DateCalendarPopover
              anchorEl={goLiveAnchorEl}
              open={!!goLiveAnchorEl}
              valueYmd={goLiveDate || ''}
              onSelect={(next) => {
                setGoLiveDate(next);
                updateScalar('go_live_date', (next || null) as AssetRecord['go_live_date']);
              }}
              onClose={() => setGoLiveAnchorEl(null)}
              allowClear
            />
            {reachVulnerabilities && badgeTotals && (
              <VulnerabilitySevereBadge
                severe={badgeTotals.severe}
                exploitedSevere={badgeTotals.exploited_severe}
                includesMembers={!!reachVulnerabilities.member_totals}
                highestSeverity={reachVulnerabilities.member_totals
                  ? ((reachVulnerabilities.member_totals.critical ?? 0) > 0 ? 'critical' : 'high')
                  : highestSevereOf(reachVulnerabilities.rows)}
                to={`/it/vulnerabilities?asset=${encodeURIComponent(data?.asset_reference || id)}`}
              />
            )}
          </PendingMetadata>
        ) : undefined}
        actions={actions}
        properties={properties}
      >
          {validTab === 'overview' && (
            <Stack spacing={3.5} sx={tabContentSx}>
              {!isCreate && netboxLink ? (
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  flexWrap="wrap"
                  useFlexGap
                  sx={{ fontSize: 12, color: 'kanap.text.tertiary', rowGap: 0.5 }}
                >
                  <Box component="span">{t('pages.netbox.assetSource.label')}</Box>
                  <Box
                    component="span"
                    sx={netboxLink.state === 'missing'
                      ? { color: getDotColor('warning', theme.palette.mode) }
                      : undefined}
                  >
                    {netboxLink.state === 'missing'
                      ? t('pages.netbox.assetSource.missing')
                      : netboxSyncedLabel
                        ? t('pages.netbox.assetSource.synchronised', { when: netboxSyncedLabel })
                        : t('pages.netbox.assetSource.never')}
                  </Box>
                  <Box component="span">·</Box>
                  <MuiLink
                    href={netboxLink.external_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    underline="hover"
                    sx={{ fontSize: 12 }}
                  >
                    {t('pages.netbox.assetSource.open')}
                  </MuiLink>
                  {netboxAttentionStatus ? (
                    <>
                      <Box component="span">·</Box>
                      <Box component="span" sx={{ color: getDotColor('warning', theme.palette.mode) }}>
                        {t('pages.netbox.assetSource.netboxStatus', {
                          status: t(`pages.netbox.netboxStatus.${netboxAttentionStatus}`, {
                            defaultValue: netboxAttentionStatus,
                          }),
                        })}
                      </Box>
                    </>
                  ) : null}
                  {netboxManaged ? (
                    <>
                      <Box component="span">·</Box>
                      <Box component="span">{t('pages.netbox.assetSource.managed')}</Box>
                    </>
                  ) : null}
                </Stack>
              ) : null}
              {isCreate ? (
                <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
                  <Box>
                    <SectionLabel>{t('workspace.asset.overview.basics')}</SectionLabel>
                  </Box>
                  <PropertyRow label={t('workspace.asset.overview.name')} required valueSx={{ maxWidth: 520 }}>
                    <TextField
                      value={name}
                      onChange={(e) => { setName(e.target.value.slice(0, ASSET_NAME_MAX)); setDirty(true); }}
                      placeholder={t('workspace.asset.overview.namePlaceholder')}
                      required
                      size="small"
                      variant="standard"
                      sx={contentFieldSx}
                      inputProps={{ maxLength: ASSET_NAME_MAX }}
                    />
                  </PropertyRow>
                </Stack>
              ) : null}
              <Box>
                <Box sx={{ mb: 1 }}>
                  <SectionLabel>{t('workspace.asset.overview.description')}</SectionLabel>
                </Box>
                <React.Suspense fallback={<Box sx={(muiTheme) => ({ minHeight: 154, maxWidth: 900, border: `1px solid ${muiTheme.palette.kanap.border.default}`, borderRadius: '8px', bgcolor: muiTheme.palette.kanap.bg.composer })} />}>
                  <MarkdownEditor
                    key={isCreate ? 'new' : (data?.id || routeId)}
                    value={notes}
                    onChange={handleNotesChange}
                    placeholder={t('workspace.asset.overview.descriptionPlaceholder')}
                    minRows={4}
                    maxRows={12}
                    disabled={!canManage}
                    hideToolbarUntilFocus
                    surface
                  />
                </React.Suspense>
              </Box>
              {!isCreate && id && (
                <Box>
                  <Box sx={{ mb: 1 }}>
                    <SectionLabel>{t('workspace.asset.support.title')}</SectionLabel>
                  </Box>
                  <SupportInfoPanel key={id} assetId={id} onSaveError={supportSaveError} />
                </Box>
              )}
              {!isCreate && (
                <Box>
                  <EntityKnowledgePanel
                    entityType="assets"
                    entityId={id}
                    canCreate={canCreateKnowledge}
                    controlsMaxWidth={560}
                  />
                </Box>
              )}
            </Stack>
          )}
          {validTab === 'operations' && (
            <Stack spacing={3.5} sx={tabContentSx}>
              {!isCreate && clusterSection}
              {!isCreate && (
                <Box>
                  {canReadApplications && assignmentsError && <Alert severity="error" sx={{ mb: 2 }}>{assignmentsError}</Alert>}
                  {canReadApplications && assignMessage && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAssignMessage(null)}>{assignMessage}</Alert>}
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <SectionLabel>{t('workspace.asset.operations.hostedApplications')}</SectionLabel>
                    {canAssignApplications && (
                      <Button
                        variant="action"
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={openAssignDialog}
                        disabled={serverRoleOptions.length === 0}
                      >
                        {t('workspace.asset.assignments.addAssignment')}
                      </Button>
                    )}
                  </Stack>
                  {canReadApplications ? (
                    <>
                    <Table size="small" sx={denseTableSx}>
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('workspace.asset.assignments.application')}</TableCell>
                          <TableCell>{t('workspace.asset.assignments.environment')}</TableCell>
                          <TableCell>{t('workspace.asset.assignments.role')}</TableCell>
                          <TableCell>{t('workspace.asset.assignments.since')}</TableCell>
                          <TableCell>{t('workspace.asset.assignments.notes')}</TableCell>
                          {canAssignApplications && <TableCell align="right">{t('workspace.asset.assignments.actions')}</TableCell>}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {assignments.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={canAssignApplications ? 6 : 5}>
                              <Typography variant="body2" color="text.secondary">{t('workspace.asset.assignments.noAssignments')}</Typography>
                            </TableCell>
                          </TableRow>
                        )}
                        {assignments.map((assignment) => (
                          <TableRow key={`${assignment.id}|${assignment.inherited ? 'via' : 'own'}`}>
                            <TableCell>
                              <Button size="small" onClick={() => navigate(`/it/applications/${assignment.application.id}/deployments`)}>
                                {assignment.application.name}
                              </Button>
                              {assignment.inherited && (assignment.via_clusters?.length ?? 0) > 0 && (
                                <Box component="span" sx={(muiTheme) => ({ ml: 0.5, fontSize: 12, color: muiTheme.palette.kanap.text.tertiary })}>
                                  {t('components.clusterAssignment.via')} <ViaAssetNames assets={assignment.via_clusters ?? []} />
                                </Box>
                              )}
                            </TableCell>
                            <TableCell>{environmentLabel(assignment.environment)}</TableCell>
                            <TableCell>{labelFor('serverRole', assignment.role) || assignment.role}</TableCell>
                            <TableCell>{assignment.since_date ? formatShortDate(assignment.since_date, locale, { year: 'always' }) : DASH}</TableCell>
                            <TableCell>{assignment.notes || DASH}</TableCell>
                            {canAssignApplications && (
                            <TableCell align="right">
                              {!assignment.inherited && (
                              <>
                              <Tooltip title={t('workspace.asset.assignments.editAssignment')}>
                                <span>
                                  <IconButton
                                    size="small"
                                    aria-label={t('workspace.asset.assignments.editAssignment')}
                                    onClick={() => navigate(`/it/applications/${assignment.application.id}/deployments`)}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              <Tooltip title={t('workspace.asset.assignments.removeAssignment')}>
                                <span>
                                  <IconButton
                                    size="small"
                                    color="error"
                                    aria-label={t('workspace.asset.assignments.removeAssignment')}
                                    onClick={() => void handleRemoveAssignment(assignment)}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              </>
                              )}
                            </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {canAssignApplications && isCluster && groupable.map((set) => {
                      const names = set.member_ids.map((memberId) => clusterMembers.find((member) => member.id === memberId)?.name).filter(Boolean).join(', ');
                      const subject = `${set.application_name} (${environmentLabel(set.environment)}, ${labelFor('serverRole', set.role) || set.role})`;
                      return (
                        <ClusterGroupLine
                          key={`${set.app_instance_id}|${set.role}`}
                          text={t('components.clusterAssignment.groupLine', { subject, members: names })}
                          actionLabel={t('components.clusterAssignment.assignToCluster')}
                          onAssign={() => void assignGroupToCluster(set, set.application_name)}
                        />
                      );
                    })}
                    </>
                  ) : (
                    <RelationsEmpty>{t('workspace.asset.assignments.noApplicationAccess')}</RelationsEmpty>
                  )}
                </Box>
              )}
              {!isCreate && id && (
                <Box sx={{ width: '100%', maxWidth: 900, minWidth: 0 }}>
                  <AssetTechnologiesSection assetId={id} canManage={canManage} isServer={isPhysicalServer} heading={(title) => <SectionLabel>{title}</SectionLabel>} />
                </Box>
              )}
              {reachVulnerabilities && id && (
                <Box sx={{ width: '100%', maxWidth: 900, minWidth: 0 }}>
                  <ReachVulnerabilitiesSection
                    data={reachVulnerabilities}
                    kind="asset"
                    subjectReference={data?.asset_reference || id}
                    heading={<SectionLabel>{t('pages.vulnerabilities.section.title')}</SectionLabel>}
                  />
                </Box>
              )}
            </Stack>
          )}
          {validTab === 'network' && (
            <Stack spacing={3.5} sx={tabContentSx}>
              {netboxManaged ? (
                <Typography variant="caption" sx={{ display: 'block', color: 'kanap.text.tertiary' }}>
                  {t('pages.netbox.assetSource.managedFields')}
                </Typography>
              ) : null}
              {/* IDENTITY SECTION */}
              <Box>
                <Box sx={{ mb: 1.5 }}>
                  <SectionLabel>{t('workspace.asset.technical.identity')}</SectionLabel>
                </Box>
                <Stack spacing={0} sx={{ maxWidth: 560 }}>
                  <PropertyRow label={t('workspace.asset.technical.hostname')} valueSx={{ maxWidth: 520 }}>
                    <TextField
                      value={hostname}
                      onChange={(e) => { setHostname(e.target.value); setHostnameManuallyEdited(true); if (isCreate) setDirty(true); }}
                      onBlur={(e) => {
                        const next = e.currentTarget.value;
                        const cleanHostname = next.trim().toLowerCase();
                        const domainOpt = domainOptions.find((domainOption) => domainOption.value === domain);
                        const nextFqdn = cleanHostname
                          ? (!domain || domain === 'workgroup' || domain === 'n-a' || !domainOpt?.dns_suffix
                              ? cleanHostname
                              : `${cleanHostname}.${domainOpt.dns_suffix}`)
                          : null;
                        setHostname(next);
                        if (hostnameMalformed) return;
                        if (!isCreate && (next || '') !== (data?.hostname || '')) savePatch({ hostname: next || null, fqdn: nextFqdn });
                      }}
                      error={(!!hostnameRequired && !hostname) || hostnameMalformed}
                      helperText={
                        hostnameRequired && !hostname
                          ? t('workspace.asset.technical.hostnameRequired')
                          : hostnameMalformed
                            ? t('workspace.asset.technical.hostnameInvalid')
                            : undefined
                      }
                      placeholder={t('workspace.asset.technical.hostnamePlaceholder')}
                      size="small"
                      variant="standard"
                      sx={contentFieldSx}
                      disabled={!canEditNetboxField('hostname')}
                    />
                  </PropertyRow>
                  <PropertyRow label={t('workspace.asset.technical.domain')} valueSx={{ maxWidth: 520 }}>
                    <TextField
                      select
                      value={domain}
                      onChange={(e) => {
                        const next = e.target.value;
                        setDomain(next);
                        if (isCreate) setDirty(true);
                        else savePatch({ domain: next || null });
                      }}
                      size="small"
                      variant="standard"
                      sx={contentFieldSx}
                      disabled={!canEditNetboxField('domain')}
                    >
                      <MenuItem value="" sx={drawerMenuItemSx}>{t('common:labels.none')}</MenuItem>
                      {domainOptions
                        .filter((opt) => !opt.deprecated || opt.value === domain)
                        .map((opt) => (
                          <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
                        ))}
                    </TextField>
                  </PropertyRow>
                  <PropertyRow label={t('workspace.asset.technical.fqdn')} valueSx={{ maxWidth: 520 }}>
                    <TextField
                      value={computedFqdn}
                      InputProps={{
                        readOnly: true,
                        sx: { color: 'text.secondary', '& input': { cursor: 'default' } },
                      }}
                      size="small"
                      variant="standard"
                      sx={contentFieldSx}
                    />
                  </PropertyRow>
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={aliases}
                    onChange={(_, newValue) => {
                      const next = newValue.map((v) => String(v).trim().toLowerCase()).filter(Boolean);
                      setAliases(next);
                      if (isCreate) setDirty(true);
                      else savePatch({ aliases: next.length > 0 ? next : null });
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((option, index) => (
                        <Chip size="small" label={option} {...getTagProps({ index })} key={index} />
                      ))
                    }
                    renderInput={(params) => (
                      <PropertyRow label={t('workspace.asset.technical.aliases')} valueSx={{ maxWidth: 520 }}>
                        <TextField
                          {...params}
                          placeholder={aliases.length === 0 ? t('workspace.asset.technical.aliasesExamplePlaceholder') : ''}
                          size="small"
                          variant="standard"
                          sx={contentFieldSx}
                        />
                      </PropertyRow>
                    )}
                    disabled={!canManage}
                  />
                </Stack>
              </Box>
              {/* NETWORK INFORMATION SECTION */}
              <Box>
                <Box sx={{ mb: 1.5 }}>
                  <SectionLabel>{t('workspace.asset.technical.ipAddresses')}</SectionLabel>
                </Box>
                <Stack spacing={2}>
                  {/* Keep the network block in the main work area; it is too wide for the properties drawer. */}
                  <Button
                    size="small"
                    variant="action"
                    startIcon={<AddIcon />}
                    onClick={() => {
                      const defaultType = ipAddressTypeOptions[0]?.value || 'host';
                      setIpAddresses((prev) => [...prev, { type: defaultType, ip: '', subnet_cidr: null }]);
                      if (isCreate) setDirty(true);
                    }}
                    disabled={!canEditNetboxField('ip_addresses')}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {t('workspace.asset.technical.addIpAddress')}
                  </Button>
                  {ipAddresses.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('workspace.asset.technical.noIpAddresses')}
                    </Typography>
                  )}
                  {ipAddresses.map((entry, idx) => {
                    const selectedSubnet = subnetOptions.find((s) => s.value === entry.subnet_cidr);
                    return (
                      <Box
                        key={idx}
                        sx={(muiTheme) => ({
                          p: 1.5,
                          border: `1px solid ${muiTheme.palette.kanap.border.default}`,
                          borderRadius: '8px',
                          bgcolor: muiTheme.palette.kanap.bg.primary,
                          maxWidth: 760,
                        })}
                      >
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap" alignItems={{ xs: 'stretch', sm: 'flex-end' }} sx={{ mb: 1.5 }}>
                          <PropertyRow label={t('workspace.asset.technical.type')} sx={{ flex: '1 1 140px', minWidth: 0, maxWidth: '100%' }} valueSx={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
                            <TextField
                              select
                              value={entry.type}
                              onChange={(e) => {
                                const next = ipAddresses.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x));
                                setIpAddresses(next);
                                persistIpAddresses(next);
                              }}
                              size="small"
                              variant="standard"
                              sx={contentFieldSx}
                              disabled={!canEditNetboxField('ip_addresses')}
                            >
                              {ipAddressTypeOptions.map((opt) => (
                                <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
                              ))}
                            </TextField>
                          </PropertyRow>
                          <PropertyRow label={t('workspace.asset.technical.ipAddress')} sx={{ flex: '2 1 180px', minWidth: 0, maxWidth: '100%' }} valueSx={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
                            <TextField
                              value={entry.ip}
                              onChange={(e) => {
                                if (ipFieldError?.index === idx) setIpFieldError(null);
                                const next = ipAddresses.map((x, i) => (i === idx ? { ...x, ip: e.target.value } : x));
                                setIpAddresses(next);
                                if (isCreate) setDirty(true);
                              }}
                              onBlur={(e) => {
                                const next = ipAddresses.map((x, i) => (i === idx ? { ...x, ip: e.currentTarget.value } : x));
                                setIpAddresses(next);
                                persistIpAddresses(next);
                              }}
                              placeholder={t('workspace.asset.technical.ipAddressPlaceholder')}
                              fullWidth
                              size="small"
                              variant="standard"
                              sx={contentFieldSx}
                              error={ipFieldError?.index === idx}
                              helperText={ipFieldError?.index === idx ? ipFieldError.message : undefined}
                              disabled={!canEditNetboxField('ip_addresses')}
                            />
                          </PropertyRow>
                          <IconButton
                            aria-label={t('workspace.asset.technical.removeIpAddress')}
                            onClick={() => {
                              const next = ipAddresses.filter((_, i) => i !== idx);
                              setIpAddresses(next);
                              persistIpAddresses(next);
                            }}
                            size="small"
                            disabled={!canEditNetboxField('ip_addresses')}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} useFlexGap flexWrap="wrap" alignItems={{ xs: 'stretch', sm: 'flex-start' }}>
                          <PropertyRow label={t('workspace.asset.technical.subnet')} sx={{ flex: '2 1 180px', minWidth: 0, maxWidth: '100%' }} valueSx={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
                            <TextField
                              select
                              value={entry.subnet_cidr || ''}
                              onChange={(e) => {
                                const next = ipAddresses.map((x, i) => (i === idx ? { ...x, subnet_cidr: e.target.value || null } : x));
                                setIpAddresses(next);
                                persistIpAddresses(next);
                              }}
                              size="small"
                              variant="standard"
                              sx={contentFieldSx}
                              helperText={subnetOptions.length === 0 ? t('workspace.asset.technical.defineSubnets') : undefined}
                              disabled={!canEditNetboxField('ip_addresses')}
                            >
                              <MenuItem value="" sx={drawerMenuItemSx}>{t('common:labels.none')}</MenuItem>
                              {subnetOptions.map((opt) => (
                                <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>
                                  {opt.label}
                                  {opt.description && ` / ${opt.description}`}
                                </MenuItem>
                              ))}
                            </TextField>
                          </PropertyRow>
                          <PropertyRow label={t('workspace.asset.technical.networkZone')} sx={{ flex: '1 1 120px', minWidth: 0, maxWidth: '100%' }} valueSx={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
                            <TextField
                              value={selectedSubnet ? (labelFor('networkSegment', selectedSubnet.network_zone) || selectedSubnet.network_zone || '-') : '-'}
                              size="small"
                              variant="standard"
                              sx={contentFieldSx}
                              InputProps={{ readOnly: true }}
                            />
                          </PropertyRow>
                          <PropertyRow label={t('workspace.asset.technical.vlan')} sx={{ flex: '1 1 80px', minWidth: 0, maxWidth: '100%' }} valueSx={{ minWidth: 0, width: '100%', maxWidth: '100%' }}>
                            <TextField
                              value={selectedSubnet?.vlan_number ?? '-'}
                              size="small"
                              variant="standard"
                              sx={contentFieldSx}
                              InputProps={{ readOnly: true }}
                            />
                          </PropertyRow>
                        </Stack>
                      </Box>
                    );
                  })}
                </Stack>
              </Box>
              {!isCreate && (
                <Box>
                  <Box sx={{ mb: 1 }}>
                    <SectionLabel>{t('workspace.asset.connections.title')}</SectionLabel>
                  </Box>
                  <AssetConnectionsSection assetId={id} />
                </Box>
              )}
            </Stack>
          )}
          {validTab === 'hardware' && isPhysicalAsset && !isCreate && (
            <HardwareInfoPanel
              key={id}
              assetId={id}
              netboxManaged={netboxManaged}
              netboxOwns={netboxOwns}
              onSaveError={hardwareSaveError}
            />
          )}
          {validTab === 'dependencies' && !isCreate && !!id && (
            <Box sx={tabContentSx}>
              <AssetDependenciesTab assetId={id} isServer={isPhysicalServer} />
            </Box>
          )}
          {validTab === 'relations' && !isCreate && !!id && (
            <Box sx={tabContentSx}>
              <AssetRelationsTab assetId={id} />
            </Box>
          )}
          {validTab === RECORD_HISTORY_TAB_KEY && !isCreate && !!id && (
            <Box sx={tabContentSx}>
              <WorkspaceTabBoundary resetKey={validTab} onRetry={historyTab.retry}>
                <React.Suspense fallback={null}>
                  <HistoryTab key={id} table="assets" recordId={id} />
                </React.Suspense>
              </WorkspaceTabBoundary>
            </Box>
          )}
      </PortfolioDetailWorkspaceShell>
      <KanapDialog
        open={memberDialogOpen}
        title={t('workspace.asset.editMembersDialog.title')}
        onClose={() => setMemberDialogOpen(false)}
        onSave={handleSaveMembers}
        saveLabel={t('common:buttons.save')}
        saveDisabled={memberSaving}
        saveLoading={memberSaving}
        sx={{ maxWidth: 560 }}
      >
          <Stack spacing={1.5}>
            <Autocomplete
              multiple
              options={memberOptionsCombined}
              loading={memberOptionsLoading}
              value={memberSelection}
              inputValue={memberSearch}
              onInputChange={(_, v) => setMemberSearch(v)}
              onChange={(_, vals) => {
                setMemberSelection((vals as ServerOption[]).filter((val) => val.id !== MORE_MEMBERS_ROW.id));
                setMemberSaveError(null);
              }}
              // The server filters on the search: its answer is shown whole.
              filterOptions={(list) => list}
              filterSelectedOptions
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              getOptionDisabled={(opt) => opt.id === MORE_MEMBERS_ROW.id || opt.id === id || !!opt.is_cluster}
              getOptionLabel={(opt) => opt.name}
              renderTags={(chosen, getTagProps) => chosen.map((option, index) => {
                const { key, ...tagProps } = getTagProps({ index });
                // A8: another environment than the cluster's is allowed, and flagged on the chip.
                const differs = !!option.environment && !!data?.environment && option.environment !== data.environment;
                return (
                  <Chip
                    key={key}
                    label={option.name}
                    icon={differs ? (
                      <Tooltip title={t('workspace.asset.editMembersDialog.differentEnvironment')}>
                        <WarningAmberOutlinedIcon
                          role="img"
                          aria-hidden={false}
                          aria-label={t('workspace.asset.editMembersDialog.differentEnvironment')}
                          sx={{ color: `${getDotColor('warning', theme.palette.mode)} !important` }}
                        />
                      </Tooltip>
                    ) : undefined}
                    {...tagProps}
                  />
                );
              })}
              renderOption={(props, option) => (
                option.id === MORE_MEMBERS_ROW.id ? (
                  <li {...props} key={option.id}>
                    <Typography variant="body2" color="text.secondary">{t('workspace.asset.editMembersDialog.narrowSearch')}</Typography>
                  </li>
                ) : (
                  <li {...props} key={option.id}>
                    <div>
                      <div style={{ fontWeight: 500 }}>{option.name}</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>
                        {[environmentLabel(option.environment), labelFor('serverKind', option.kind) || option.kind, providerName(option.provider) || option.provider].join(' / ')}
                      </div>
                    </div>
                  </li>
                )
              )}
              renderInput={(params) => (
                <PropertyRow label={t('workspace.asset.editMembersDialog.memberServers')} valueSx={{ width: '100%' }}>
                  <TextField
                    {...params}
                    placeholder={t('workspace.asset.editMembersDialog.searchServers')}
                    variant="standard"
                    sx={drawerFieldValueSx}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {memberOptionsLoading ? <CircularProgress color="inherit" size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                </PropertyRow>
              )}
            />
            {memberSaveError && <Alert severity="error">{memberSaveError}</Alert>}
          </Stack>
      </KanapDialog>

      {questionDialog}

      <KanapDialog
        open={assignDialogOpen}
        title={t('workspace.asset.assignments.addAssignmentDialog')}
        onClose={() => setAssignDialogOpen(false)}
        onSave={handleAssignSave}
        saveLabel={t('workspace.asset.assignments.assign')}
        saveDisabled={assigning || serverRoleOptions.length === 0 || !selectedAppId || !instanceId || !assignRole}
        saveLoading={assigning}
        sx={{ maxWidth: 560 }}
      >
          <Stack spacing={1.5}>
            <PropertyRow label={t('workspace.asset.assignments.application')} required>
              <ApplicationSelect
                label={t('workspace.asset.assignments.application')}
                value={selectedAppId}
                onChange={(appId) => { void onSelectApplication(appId); }}
                required
                hideLabel
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('workspace.asset.assignments.environment')} required valueSx={{ width: '100%', maxWidth: '100%' }}>
              <TextField
                select
                fullWidth
                value={instanceId || ''}
                onChange={(e) => setInstanceId(e.target.value)}
                disabled={!selectedAppId || instancesLoading}
                required
                variant="standard"
                sx={drawerFieldValueSx}
                SelectProps={{
                  displayEmpty: true,
                  renderValue: (selected) => {
                    const value = String(selected ?? '');
                    const list = selectedAppId ? appInstances[selectedAppId] || [] : [];
                    const inst = list.find((item) => item.id === value);
                    if (inst) return environmentLabel(inst.environment);
                    if (value.startsWith(NEW_DEPLOYMENT)) {
                      return t('workspace.asset.assignments.createDeployment', { environment: environmentLabel(value.slice(NEW_DEPLOYMENT.length)) });
                    }
                    return (
                      <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
                        {selectedAppId ? t('workspace.asset.assignments.chooseEnvironment') : t('workspace.asset.assignments.selectAppForEnv')}
                      </Box>
                    );
                  },
                }}
              >
                {(selectedAppId ? appInstances[selectedAppId] || [] : []).map((inst) => (
                  <MenuItem key={inst.id} value={inst.id} sx={drawerMenuItemSx}>{environmentLabel(inst.environment)}</MenuItem>
                ))}
                {selectedAppId && !instancesLoading && ENV_OPTIONS
                  .filter((option) => !(appInstances[selectedAppId] || []).some((inst) => inst.environment === option.value))
                  .map((option) => (
                    <MenuItem key={option.value} value={`${NEW_DEPLOYMENT}${option.value}`} sx={drawerMenuItemSx}>
                      {t('workspace.asset.assignments.createDeployment', { environment: option.label })}
                    </MenuItem>
                  ))}
              </TextField>
            </PropertyRow>
            <PropertyRow label={t('workspace.asset.assignments.role')} required>
              <TextField
                select
                value={assignRole}
                onChange={(e) => setAssignRole(e.target.value)}
                required
                helperText={serverRoleOptions.length === 0 ? t('workspace.asset.assignments.noServerRoles') : undefined}
                variant="standard"
                sx={drawerFieldValueSx}
              >
                {serverRoleOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
                ))}
              </TextField>
            </PropertyRow>
            <PropertyRow label={t('workspace.asset.assignments.since')}>
              <DateEUField
                label=""
                hideLabel
                valueYmd={assignSince}
                onChangeYmd={setAssignSince}
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('workspace.asset.assignments.notes')}>
              <TextField
                multiline
                minRows={3}
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                variant="standard"
                sx={drawerFieldValueSx}
              />
            </PropertyRow>
            {assignError && <Alert severity="error">{assignError}</Alert>}
          </Stack>
      </KanapDialog>
    </Box>
    </ApplicationFeedbackProvider>
  );
}

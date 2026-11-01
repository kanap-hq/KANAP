import { classificationText } from '../../utils/applicationClassification';
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Alert, Box, Button, Stack, Chip, Tooltip, Typography, RadioGroup, FormControlLabel, Radio, Link, useTheme } from '@mui/material';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, type ListRequest } from '../../components/ServerDataGrid';
import type { CellStyle, ICellRendererParams } from 'ag-grid-community';
import { useNavigate, useLocation } from 'react-router-dom';
import { LinkCellRenderer, wholeCellLinkSx, aboveCellLinkSx } from '../../components/grid/renderers';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { getDotColor } from '../../utils/statusColors';
import { APPLICATION_ENVIRONMENTS } from '../../utils/applicationEnvironments';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import { useQuery } from '@tanstack/react-query';
import ForbiddenPage from '../ForbiddenPage';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { removedWithLinks } from '../../utils/deleteRefusal';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { APPLICATION_NAME_MAX } from './applicationLimits';
import { applicationDeleteCheck } from './applicationDeleteCheck';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { useGridScopePreference } from '../../hooks/useGridScopePreference';
import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import { formatDuration } from './components/DurationEditor';

import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';
import { useUrlFilterModel } from '../../hooks/useListContextSearch';
import { useFeatures } from '../../config/FeaturesContext';
import VulnerabilityCountCell from '../../components/vulnerabilities/VulnerabilityCountCell';
import {
  VULNERABILITIES_FIELD,
  vulnerabilityFilterFromSearch,
  vulnerabilityFilterOptions,
} from '../../components/vulnerabilities/vulnerabilityListColumn';
import { ImportLabel } from '../../components/csv/importFiles';
/** The environments of the pills, in the one display order; their abbreviation and full name come from `pages.applications.environments.<value>`. */
const ENV_SUMMARY = APPLICATION_ENVIRONMENTS;

/** An empty value, in every column. */
const EMPTY_CELL = '—';

type AppInstanceSummary = {
  id: string;
  environment: string;
  base_url: string | null;
  region: string | null;
  zone: string | null;
  lifecycle?: 'proposed' | 'active' | 'deprecated' | 'retired';
  sso_enabled: boolean;
  mfa_supported: boolean;
  status: string;
  notes?: string | null;
  disabled_at?: string | null;
};

type AppRow = {
  id: string;
  sequential_id?: string | null;
  name: string;
  category: string;
  supplier_id: string | null;
  editor: string | null;
  lifecycle: string;
  criticality: string;
  cyber_criticality?: string | null;
  recovery_wave?: string | null;
  rto_minutes?: number | null;
  rpo_minutes?: number | null;
  classification_review_state?: string;
  classification_reviewed_at?: string | null;
  environment?: 'prod' | 'pre_prod' | 'qa' | 'test' | 'dev' | 'sandbox' | string;
  etl_enabled?: boolean;
  derived_total_users?: number;
  created_at: string;
  // Optional fields for expanded columns (populated when requested)
  supplier_name?: string | null;
  data_class?: 'public' | 'internal' | 'confidential' | 'restricted';
  hosting_model?: 'on_premise' | 'saas' | 'public_cloud' | 'private_cloud';
  external_facing?: boolean;
  sso_enabled?: boolean;
  mfa_supported?: boolean;
  contains_pii?: boolean;
  owners_business?: string[];
  owners_it?: string[];
  data_residency?: string[]; // ISO codes
  hosting_types?: string[]; // Derived from server locations
  // Relation summaries
  spend_count?: number;
  spend_first_name?: string | null;
  capex_count?: number;
  capex_first_description?: string | null;
  contracts_count?: number;
  contracts_first_name?: string | null;
  // Structure summaries
  suites_count?: number;
  first_suite_name?: string | null;
  /** Reference of the suite named by first_suite_name */
  first_suite_ref?: string | null;
  components_count?: number;
  first_component_name?: string | null;
  instances?: AppInstanceSummary[];
  /** CVE still to review, and those critical or high (asked with `include=vulnerabilities`; null out of service or with the feed off). */
  vulnerabilities_to_review?: number | null;
  vulnerabilities_severe?: number | null;
};

/** The vulnerabilities to review of an application, a link to the Vulnerabilities page filtered on it. */
function VulnerabilitiesCell({ data }: ICellRendererParams<AppRow, any>) {
  if (!data) return null;
  return (
    <VulnerabilityCountCell
      count={data.vulnerabilities_to_review}
      severe={data.vulnerabilities_severe}
      to={`/it/vulnerabilities?application=${encodeURIComponent(data.sequential_id || data.id)}`}
    />
  );
}

/**
 * Filters an address names outside `filters` (links from the home page): `?vulnerabilities=` on
 * the Vulnerabilities column, `?criticality=<code>` on the Business criticality column.
 */
export function applicationFiltersFromSearch(search: string): Record<string, unknown> | null {
  const criticality = new URLSearchParams(search).get('criticality');
  const model = {
    ...(vulnerabilityFilterFromSearch(search) || {}),
    ...(criticality ? { criticality: { filterType: 'set', values: [criticality] } } : {}),
  };
  return Object.keys(model).length > 0 ? model : null;
}

/** Orders set-filter values like the catalog: most severe first (waves in restoration order); unknown codes and blanks last. */
export function catalogRankComparator(levels: Array<{ code: string; rank?: number; order?: number }> | undefined, kind: 'rank' | 'order' = 'rank') {
  const position = new Map((levels || []).map((level) => [level.code, kind === 'order' ? Number(level.order) : -Number(level.rank)]));
  return (a: { value: string | null }, b: { value: string | null }) => {
    const left = a.value == null ? Number.POSITIVE_INFINITY : position.get(String(a.value)) ?? Number.MAX_SAFE_INTEGER;
    const right = b.value == null ? Number.POSITIVE_INFINITY : position.get(String(b.value)) ?? Number.MAX_SAFE_INTEGER;
    return left === right ? String(a.value ?? '').localeCompare(String(b.value ?? '')) : left - right;
  };
}

/**
 * The optional parts of the list rows the visible columns need (`include`). The name column is
 * always shown and its cell shows the first suite ("Included in") when the suites column is
 * hidden: the structure is always asked for.
 */
function includeFlagsFor(visible: Set<string>): string {
  const flags: string[] = [];
  if (visible.has('supplier_name')) flags.push('supplier');
  if (visible.has('owners_business') || visible.has('owners_it')) flags.push('owners');
  if (visible.has('data_residency')) flags.push('residency');
  if (visible.has('hosting_types')) flags.push('hosting');
  if (visible.has('spend_count') || visible.has('capex_count') || visible.has('contracts_count')) flags.push('counts');
  flags.push('structure');
  if (visible.has('environments')) flags.push('instances');
  if (visible.has(VULNERABILITIES_FIELD)) flags.push('vulnerabilities');
  return flags.join(',');
}

export default function ApplicationsPage() {
  const { t } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel, profile } = useAuth();
  const { config, isLoading: featuresLoading } = useFeatures();
  const vulnerabilityFeed = config.features.vulnerabilityFeed === true;
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<AppRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const { labelFor, byField } = useItOpsEnumOptions();
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const [includeFlags, setIncludeFlags] = useState<string>(() => includeFlagsFor(new Set(['name'])));

  // Read filters from URL to restore state when returning from workspace: inline, or the saved
  // filters its `ctx` stands for (filters too long for a URL), read before the grid mounts.
  const urlFilterState = useUrlFilterModel(location.search, '/applications');
  const searchFilters = useMemo(() => applicationFiltersFromSearch(location.search), [location.search]);
  const urlFilters = useMemo(
    () => (searchFilters ? { ...(urlFilterState.model || {}), ...searchFilters } : urlFilterState.model),
    [searchFilters, urlFilterState.model],
  );
  const urlAppScope = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const scope = params.get('appScope');
    if (scope === 'my' || scope === 'team' || scope === 'all') {
      return scope;
    }
    return null;
  }, [location.search]);
  const [appScope, setAppScope] = useGridScopePreference('apps', urlAppScope);

  // Fetch current user's team config (for My team's apps scope)
  const { data: myTeamConfig, isFetched: isTeamConfigFetched } = useQuery({
    queryKey: ['my-team-config', profile?.id],
    queryFn: async () => {
      const res = await api.get<{ id: string; team_id?: string | null }>(`/portfolio/team-members/by-user/${profile?.id}`);
      return res.data;
    },
    enabled: !!profile?.id && hasLevel('applications', 'reader'),
  });

  const hasTeam = !!myTeamConfig?.team_id;

  useEffect(() => {
    if (appScope === 'team' && isTeamConfigFetched && !hasTeam) {
      setAppScope('my');
    }
  }, [appScope, isTeamConfigFetched, hasTeam, setAppScope]);

  const lifecycleDefaultValues = useMemo(() => {
    const codes = (byField.lifecycleStatus || [])
      .map((opt) => opt.code)
      .filter((code) => typeof code === 'string' && code.trim() !== '');
    if (codes.length === 0) return null;
    const filtered = codes.filter((code) => code !== 'retired');
    return filtered.length > 0 ? filtered : null;
  }, [byField.lifecycleStatus]);

  // Default filter: hide retired applications (set filter values excluding 'retired')
  const defaultFilterModel = useMemo(() => {
    if (!lifecycleDefaultValues) return null;
    return {
      lifecycle: { filterType: 'set', values: lifecycleDefaultValues },
    };
  }, [lifecycleDefaultValues]);

  // Restored filters (returning from a record) replace the default. A filter the address names
  // outside `filters` (`?vulnerabilities=`, `?criticality=`) adds to it: retired stays hidden.
  const initialFilterModel = useMemo(() => {
    if (urlFilterState.model) return urlFilters || undefined;
    if (searchFilters) return { ...(defaultFilterModel || {}), ...searchFilters };
    return defaultFilterModel || undefined;
  }, [urlFilterState.model, urlFilters, searchFilters, defaultFilterModel]);
  const [suitesColVisible, setSuitesColVisible] = useState<boolean>(false);
  const [exportOpen, setExportOpen] = useState(false);
  // What the list asked last (filters, quick search, scope), and the export dialog's view of it taken when it opens.
  const listRequestRef = useRef<ListRequest | null>(null);
  const [exportScope, setExportScope] = useState<{ params: Record<string, unknown>; summary: string }>({ params: {}, summary: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'name:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/applications', filters);
    sp.set('appScope', appScope);
    if (appScope === 'my' && profile?.id) {
      sp.set('ownerUserId', profile.id);
    } else if (appScope === 'team' && hasTeam && myTeamConfig?.team_id) {
      sp.set('ownerTeamId', myTeamConfig.team_id);
      if (profile?.id) sp.set('ownerUserId', profile.id);
    }
    return sp;
  }, [appScope, profile?.id, hasTeam, myTeamConfig?.team_id]);
  const extraParams = useMemo(() => {
    const params: Record<string, any> = {};
    if (includeFlags) params.include = includeFlags;
    if (appScope === 'my' && profile?.id) {
      params.ownerUserId = profile.id;
    } else if (appScope === 'team' && hasTeam && myTeamConfig?.team_id) {
      params.ownerTeamId = myTeamConfig.team_id;
      if (profile?.id) params.ownerUserId = profile.id;
    }
    return params;
  }, [includeFlags, appScope, profile?.id, hasTeam, myTeamConfig?.team_id]);

  const appScopeToolbar = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2">{t('pages.applications.scope.show')}</Typography>
      <RadioGroup
        row
        value={appScope}
        onChange={(e) => setAppScope(e.target.value as 'my' | 'team' | 'all')}
        sx={{ '& .MuiFormControlLabel-root': { mr: 1 } }}
      >
        <FormControlLabel value="my" control={<Radio size="small" />} label={t('pages.applications.scope.myApps')} />
        <Tooltip title={hasTeam ? '' : t('pages.applications.scope.notAssignedToTeam')}>
          <span>
            <FormControlLabel
              value="team"
              control={<Radio size="small" />}
              label={t('pages.applications.scope.myTeamApps')}
              disabled={!hasTeam}
            />
          </span>
        </Tooltip>
        <FormControlLabel value="all" control={<Radio size="small" />} label={t('pages.applications.scope.allApps')} />
      </RadioGroup>
    </Stack>
  );

  const isPlainLeftClick = useCallback((event: React.MouseEvent) => {
    return (
      event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
    );
  }, []);

  const buildAppHref = useCallback((row: AppRow | null | undefined, tab: 'overview' | 'ownership' | 'technical' | 'relations' | 'compliance' | 'instances') => {
    if (!row?.id) return undefined;
    const workspaceTab = tab === 'instances'
      ? 'deployments'
      : tab === 'technical'
        ? 'operations'
        : tab === 'relations'
          ? 'business'
          : tab === 'ownership'
            ? 'overview'
            : tab;
    const routeId = row.sequential_id || row.id;
    const sp = buildWorkspaceSearch();
    return `/it/applications/${routeId}/${workspaceTab}?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  // The suite a row belongs to (its first one, the one named in the cell); the row itself as a fallback.
  const buildSuiteHref = useCallback((row: AppRow | null | undefined) => (
    row?.first_suite_ref
      ? buildAppHref({ id: row.first_suite_ref, sequential_id: row.first_suite_ref } as AppRow, 'overview')
      : buildAppHref(row, 'relations')
  ), [buildAppHref]);

  const handleInternalNavigate = useCallback((event: React.MouseEvent, href: string | undefined) => {
    if (!href) return;
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate(href);
  }, [isPlainLeftClick, navigate]);

  // Clickable cell to navigate to a specific tab
  const makeClickableCell = useCallback((tab: 'overview' | 'ownership' | 'technical' | 'relations' | 'compliance') => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        emptyText={EMPTY_CELL}
        linkType="internal"
        getHref={(row) => buildAppHref(row, tab)}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [buildAppHref, navigate]);

  const ClickToOverview = useMemo(() => makeClickableCell('overview'), [makeClickableCell]);
  const ClickToOwnership = useMemo(() => makeClickableCell('ownership'), [makeClickableCell]);
  const ClickToTechnical = useMemo(() => makeClickableCell('technical'), [makeClickableCell]);
  const ClickToRelations = useMemo(() => makeClickableCell('relations'), [makeClickableCell]);
  const ClickToCompliance = useMemo(() => makeClickableCell('compliance'), [makeClickableCell]);

  const lifecycleLabel = useCallback((v?: string) => {
    const label = labelFor('lifecycleStatus', v);
    if (label) return label;
    return String(v || '');
  }, [labelFor]);
  const categoryLabel = useCallback((value?: string) => labelFor('applicationCategory', value), [labelFor]);
  const criticalityLabel = useCallback((v?: string) => {
    const configured = classificationCatalog?.businessCriticalityLevels.find((item) => item.code === v);
    if (configured) return configured.label;
    return String(v || '');
  }, [classificationCatalog?.businessCriticalityLevels]);
  const catalogLabel = useCallback((axis: 'cyber' | 'wave', value?: string | null) => {
    if (!value) return '';
    const options = axis === 'cyber' ? classificationCatalog?.cyberCriticalityLevels : classificationCatalog?.recoveryWaves;
    return options?.find((item) => item.code === value)?.label || value;
  }, [classificationCatalog]);
  const hostingModelLabel = useCallback((v?: string) => {
    switch (String(v || '')) {
      case 'on_premise': return t('enums.hostingModel.onPremise');
      case 'saas': return t('enums.hostingModel.saas');
      case 'public_cloud': return t('enums.hostingModel.publicCloud');
      case 'private_cloud': return t('enums.hostingModel.privateCloud');
      default: return String(v || '');
    }
  }, []);
  const environmentLabel = useCallback((v?: string) => {
    const env = ENV_SUMMARY.find((item) => item.value === v);
    return env ? t(`pages.applications.environments.${env.value}.name`) : String(v || '');
  }, [t]);
  const dataClassLabel = useCallback((v?: string) => {
    return classificationCatalog?.dataClasses.find((item) => item.code === v)?.label || v || '';
  }, [classificationCatalog?.dataClasses]);

  const getAppFilterValues = useCallback((
    field: string,
    opts?: { labelFormatter?: (value: any) => string; emptyLabel?: string; coerceBoolean?: boolean },
  ) => {
    const emptyLabel = opts?.emptyLabel ?? t('common:filters.blank');
    const labelFormatter = opts?.labelFormatter;
    const coerceBoolean = opts?.coerceBoolean ?? false;
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = {
        fields: field,
        ...(queryState.extraParams || {}),
      };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext(`/applications/filter-values`, params);
      const values = (res.data?.[field] || []) as Array<any>;
      const options = values.map((raw) => {
        let value = raw;
        if (coerceBoolean) {
          value = raw === true || raw === 'true' || raw === 1 || raw === '1';
        } else if (value === undefined) {
          value = null;
        }
        if (!coerceBoolean && (value === null || value === undefined)) {
          return { value: null, label: emptyLabel };
        }
        const label = labelFormatter ? labelFormatter(value) : String(value);
        return { value, label };
      }).filter(Boolean) as Array<{ value: any; label?: string }>;
      const deduped = new Map<any, { value: any; label?: string }>();
      options.forEach((opt) => {
        if (!deduped.has(opt.value)) deduped.set(opt.value, opt);
      });
      const list = Array.from(deduped.values());
      list.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      return list;
    };
  }, []);

  const isInstanceActive = useCallback((inst?: AppInstanceSummary) => {
    if (!inst) return false;
    if (inst.lifecycle) return inst.lifecycle === 'active';
    if (inst.status) return inst.status === 'enabled';
    if (inst.disabled_at) {
      const ts = Date.parse(inst.disabled_at);
      if (!Number.isNaN(ts)) return ts > Date.now();
    }
    return true;
  }, []);

  const formatYesNo = useCallback((b?: boolean) => (b ? t('enums.yesNo.yes') : t('enums.yesNo.no')), []);

  if (!hasLevel('applications', 'reader')) {
    return <ForbiddenPage resource="applications" level="reader" />;
  }

  const OwnersCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const arr = (params?.value as string[] | undefined) || [];
      const first = arr[0] || '';
      const extra = arr.length > 1 ? ` +${arr.length - 1}` : '';
      const title = arr.join(', ');
      return (
        <Link
          href={buildAppHref(params.data as AppRow, 'ownership')}
          onClick={(event) => handleInternalNavigate(event, buildAppHref(params.data as AppRow, 'ownership'))}
          sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
          underline="none"
          color="inherit"
        >
          {`${first}${extra}` || EMPTY_CELL}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, handleInternalNavigate]);

  const ResidencyCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const arr = (params?.value as string[] | undefined) || [];
      const firstTwo = arr.slice(0, 2);
      const extra = arr.length > 2 ? ` +${arr.length - 2}` : '';
      return (
        <Link
          href={buildAppHref(params.data as AppRow, 'compliance')}
          onClick={(event) => handleInternalNavigate(event, buildAppHref(params.data as AppRow, 'compliance'))}
          sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
          underline="none"
          color="inherit"
        >
          {firstTwo.join(', ') + extra || EMPTY_CELL}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, handleInternalNavigate]);

  const RelationSummaryCell = useCallback((tab: 'relations') => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const data = params.data as AppRow | undefined;
      const field = String((params as any)?.colDef?.field ?? '');
      let first: string | null | undefined;
      let count: number | undefined;
      if (field === 'spend_count') { first = data?.spend_first_name; count = data?.spend_count; }
      if (field === 'capex_count') { first = data?.capex_first_description; count = data?.capex_count; }
      if (field === 'contracts_count') { first = data?.contracts_first_name; count = data?.contracts_count; }
      const extra = count && count > 1 ? ` +${count - 1}` : '';
      const title = first || '';
      return (
        <Link
          href={buildAppHref(data as AppRow, tab)}
          onClick={(event) => handleInternalNavigate(event, buildAppHref(data as AppRow, tab))}
          sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
          underline="none"
          color="inherit"
        >
          {((first || '') + (extra || '')) || EMPTY_CELL}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, handleInternalNavigate]);

  const StructureSummaryCell = useCallback((kind: 'suites' | 'components') => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const data = params.data as AppRow | undefined;
      const count = kind === 'suites' ? (data?.suites_count || 0) : (data?.components_count || 0);
      const first = kind === 'suites' ? (data?.first_suite_name || null) : (data?.first_component_name || null);
      const extra = count && count > 1 ? ` +${count - 1}` : '';
      const title = first || '';
      const href = kind === 'suites' ? buildSuiteHref(data) : buildAppHref(data as AppRow, 'relations');
      return (
        <Link
          href={href}
          onClick={(event) => handleInternalNavigate(event, href)}
          sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
          underline="none"
          color="inherit"
        >
          {((first || '') + (extra || '')) || EMPTY_CELL}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, buildSuiteHref, handleInternalNavigate]);

  // The name, and for an application included in a suite a quiet second line naming that suite, cut
  // with an ellipsis in a narrow column (the full line is on hover). The category has its own column.
  const NameWithSuiteCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const data = params.data as AppRow | undefined;
      const name = params.valueFormatted ?? params.value;
      const suitesCount = data?.suites_count || 0;
      const firstSuite = data?.first_suite_name || null;
      const showSuite = !!firstSuite && suitesCount > 0 && !suitesColVisible;
      const extra = suitesCount > 1 ? ` +${suitesCount - 1}` : '';
      const includedIn = showSuite ? `${t('pages.applications.includedIn')} ${firstSuite}${extra}` : '';
      return (
        <Box
          component="span"
          sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', minWidth: 0 }}
        >
          <Link
            href={buildAppHref(data as AppRow, 'overview')}
            onClick={(event) => handleInternalNavigate(event, buildAppHref(data as AppRow, 'overview'))}
            sx={{
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              lineHeight: '18px',
              cursor: 'pointer',
              ...wholeCellLinkSx,
            }}
            underline="none"
            color="inherit"
          >
            {name}
          </Link>
          {includedIn && (
            <Box
              component="span"
              title={includedIn}
              sx={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                lineHeight: '14px',
                color: 'kanap.text.tertiary',
              }}
            >
              <Box
                component="a"
                href={buildSuiteHref(data)}
                sx={{
                  color: 'inherit',
                  textDecoration: 'none',
                  cursor: 'pointer',
                  '&:hover': { textDecoration: 'underline' },
                  ...aboveCellLinkSx,
                }}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleInternalNavigate(e, buildSuiteHref(data));
                }}
              >
                {includedIn}
              </Box>
            </Box>
          )}
        </Box>
      );
    };
    return Cell;
  }, [buildAppHref, buildSuiteHref, handleInternalNavigate, suitesColVisible, t]);

  const EnvironmentCell = useMemo(() => {
    const mode = theme.palette.mode;
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const instances = (params.data?.instances || []) as AppInstanceSummary[];
      // An obsolete deployment stays listed, greyed; a retired or not yet active one is left out.
      const activeEnvs = ENV_SUMMARY.map((env) => {
        const match = instances.find((inst) => inst.environment === env.value);
        const obsolete = match?.lifecycle === 'deprecated';
        if (!isInstanceActive(match) && !obsolete) return null;
        return { env, match: match as AppInstanceSummary, obsolete };
      }).filter(Boolean) as Array<{ env: typeof ENV_SUMMARY[number]; match: AppInstanceSummary; obsolete: boolean }>;
      if (activeEnvs.length === 0) {
        return (
          <Box component="span" sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
            <Typography component="span" variant="body2" color="text.secondary">
              {t('pages.applications.noActiveEnvironments')}
            </Typography>
          </Box>
        );
      }
      return (
        <Box
          component="span"
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            alignItems: 'center',
            height: '100%',
          }}
        >
          {activeEnvs.map(({ env, match, obsolete }) => {
            const lifecycleText = match.lifecycle ? ` · ${lifecycleLabel(match.lifecycle)}` : '';
            const tooltip = `${t(`pages.applications.environments.${env.value}.name`)}${match.base_url ? ` · ${match.base_url}` : ''}${lifecycleText}`;
            return (
              <Tooltip key={`${params.data?.id}-${env.value}`} title={tooltip}>
                <Box
                  component="a"
                  href={buildAppHref(params.data as AppRow, 'instances')}
                  onClick={(event: React.MouseEvent) => {
                    handleInternalNavigate(event as any, buildAppHref(params.data as AppRow, 'instances'));
                  }}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    color: 'text.primary',
                    lineHeight: 1,
                    textDecoration: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <StatusDot
                    color={obsolete ? 'transparent' : getEnvDotColor(env.value, mode)}
                    sx={obsolete ? { border: '1px solid', borderColor: getDotColor('default', mode), boxSizing: 'border-box' } : undefined}
                  />
                  {/* On a span: the grid styles every link in a cell (`color: inherit`, no decoration). An obsolete
                      deployment is struck through with a hollow dot, so it never reads as the grey sandbox. */}
                  <Box
                    component="span"
                    sx={obsolete ? { color: 'kanap.text.tertiary', textDecoration: 'line-through' } : undefined}
                  >
                    {t(`pages.applications.environments.${env.value}.short`)}
                  </Box>
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      );
    };
    return Cell;
  }, [buildAppHref, handleInternalNavigate, isInstanceActive, lifecycleLabel, t, theme.palette.mode]);

  const SuitesSummaryCell = useMemo(() => StructureSummaryCell('suites'), [StructureSummaryCell]);
  const ComponentsSummaryCell = useMemo(() => StructureSummaryCell('components'), [StructureSummaryCell]);
  const RelationsSummaryCell = useMemo(() => RelationSummaryCell('relations'), [RelationSummaryCell]);

  const currentYear = new Date().getFullYear();
  const columns: EnhancedColDef<AppRow>[] = useMemo(() => [
    {
      // The business reference (APP-n), as the assets list shows AST-n. Sorted by its number on the server.
      field: 'sequential_id',
      headerName: '#',
      width: 90,
      valueGetter: (p) => p.data?.sequential_id || '',
      cellStyle: {
        fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
        fontSize: '12px',
        color: 'var(--kanap-text-secondary)',
        fontVariantNumeric: 'tabular-nums',
      } as CellStyle,
    },
    {
      headerName: t('common.name'), field: 'name', minWidth: 200,
      cellRenderer: NameWithSuiteCell,
    },
    // Hidden while the vulnerability feed is off: the counts are null then.
    ...(vulnerabilityFeed
      ? [{
        headerName: t('pages.technologies.columns.vulnerabilitiesShort'),
        field: VULNERABILITIES_FIELD as keyof AppRow,
        width: 140,
        headerTooltip: t('pages.technologies.columns.vulnerabilities'),
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: async () => vulnerabilityFilterOptions(t), searchable: false },
        cellRenderer: VulnerabilitiesCell,
      }]
      : []),
    {
      headerName: t('pages.applications.columns.category'),
      field: 'category',
      width: 180,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('category', { labelFormatter: categoryLabel }),
        searchable: false,
      },
      valueFormatter: (p: any) => categoryLabel(p.value),
      cellRenderer: ClickToOverview,
    },
    {
      headerName: t('pages.interfaces.columns.environments'),
      colId: 'environments',
      width: 250,
      sortable: false,
      // One link per pill: the rest of the cell keeps the default cursor the row rule overrides.
      cellStyle: { cursor: 'default' },
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('environments', { labelFormatter: environmentLabel }),
        searchable: false,
      },
      cellRenderer: EnvironmentCell,
    },
    // Suites is available in chooser but hidden by default
    { headerName: t('pages.applications.columns.suites'), field: 'suites_count', width: 200, defaultHidden: true, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: SuitesSummaryCell },
    {
      headerName: t('common.lifecycle'),
      field: 'lifecycle',
      width: 120,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('lifecycle', { labelFormatter: lifecycleLabel }),
        searchable: false,
        treatAllAsUnfiltered: false,
      },
      valueFormatter: (p: any) => lifecycleLabel(p.value),
      cellRenderer: ClickToOverview,
    },
    {
      headerName: classificationText("Business criticality"),
      field: 'criticality',
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('criticality', { labelFormatter: criticalityLabel }),
        sortComparator: catalogRankComparator(classificationCatalog?.businessCriticalityLevels),
        searchable: false,
      },
      valueFormatter: (p: any) => criticalityLabel(p.value),
      cellRenderer: ClickToCompliance,
    },
    { headerName: classificationText("Cyber criticality"), field: 'cyber_criticality', filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: getAppFilterValues('cyber_criticality', { labelFormatter: (v: any) => catalogLabel('cyber', v) }), sortComparator: catalogRankComparator(classificationCatalog?.cyberCriticalityLevels) }, width: 160, defaultHidden: true, valueFormatter: (p: any) => catalogLabel('cyber', p.value), cellRenderer: ClickToCompliance },
    { headerName: classificationText("Recovery wave"), field: 'recovery_wave', filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: getAppFilterValues('recovery_wave', { labelFormatter: (v: any) => catalogLabel('wave', v) }), sortComparator: catalogRankComparator(classificationCatalog?.recoveryWaves, 'order') }, width: 240, defaultHidden: true, valueFormatter: (p: any) => catalogLabel('wave', p.value), cellRenderer: ClickToCompliance },
    { headerName: 'RTO', field: 'rto_minutes', width: 110, defaultHidden: true, filter: 'agNumberColumnFilter', valueFormatter: (p: any) => formatDuration(p.value, ''), cellRenderer: ClickToCompliance },
    { headerName: 'RPO', field: 'rpo_minutes', width: 110, defaultHidden: true, filter: 'agNumberColumnFilter', valueFormatter: (p: any) => formatDuration(p.value, ''), cellRenderer: ClickToCompliance },
    { headerName: classificationText("Classification review"), field: 'classification_review_state', filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: getAppFilterValues('classification_review_state', { labelFormatter: (value: string) => ({ incomplete: classificationText('To complete'), stale: classificationText('Review needed'), reviewed: classificationText('Reviewed') }[value] || value) }) }, width: 170, defaultHidden: true, valueFormatter: (p: any) => ({ incomplete: classificationText("To complete"), stale: classificationText("Review needed"), reviewed: classificationText("Reviewed") }[String(p.value)] || classificationText("To complete")), cellRenderer: ClickToCompliance },
    { headerName: classificationText("Classification reviewed"), field: 'classification_reviewed_at', filter: 'agDateColumnFilter', width: 180, defaultHidden: true, valueFormatter: (p: any) => p.value ? new Date(p.value).toLocaleDateString(locale) : '', cellRenderer: ClickToCompliance },
    { headerName: t('pages.applications.columns.publisher'), field: 'editor', width: 160, cellRenderer: ClickToOverview },
    {
      headerName: t('pages.applications.columns.derivedUsers', { year: currentYear }),
      headerTooltip: t('pages.applications.columns.derivedUsersHelp', { year: currentYear }),
      field: 'derived_total_users',
      width: 190,
      filter: 'agNumberColumnFilter',
      cellRenderer: ClickToOwnership,
    },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 160, filter: 'agDateColumnFilter', valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale), cellRenderer: ClickToOverview },

    // Additional chooser columns (hidden by default)
    { headerName: t('pages.applications.columns.supplier'), field: 'supplier_name', width: 240, defaultHidden: true, sortable: true, filter: 'agTextColumnFilter', cellRenderer: ClickToOverview },
    { headerName: t('pages.applications.columns.businessOwners'), field: 'owners_business', width: 220, defaultHidden: true, sortable: false, filter: 'agTextColumnFilter', cellRenderer: OwnersCell },
    { headerName: t('pages.applications.columns.itOwners'), field: 'owners_it', width: 200, defaultHidden: true, sortable: false, filter: 'agTextColumnFilter', cellRenderer: OwnersCell },

    {
      headerName: t('pages.assets.columns.hosting'),
      field: 'hosting_types',
      width: 180,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('hosting_types', { labelFormatter: (v) => labelFor('hostingType', v) || String(v || '') }),
        searchable: false,
      },
      valueFormatter: (p: any) => (p.value || []).map((v: string) => labelFor('hostingType', v) || v).join(', '),
      cellRenderer: ClickToTechnical,
    },
    {
      headerName: t('pages.applications.columns.externalFacing'),
      field: 'external_facing',
      width: 150,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('external_facing', { coerceBoolean: true, labelFormatter: (v) => (v ? t('enums.yesNo.yes') : t('enums.yesNo.no')) }),
        searchable: false,
      },
      valueFormatter: (p: any) => formatYesNo(!!p.value),
      cellRenderer: ClickToTechnical,
    },
    {
      headerName: t('pages.applications.columns.ssoEnabled'),
      field: 'sso_enabled',
      width: 140,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('sso_enabled', { coerceBoolean: true, labelFormatter: (v) => (v ? t('enums.yesNo.yes') : t('enums.yesNo.no')) }),
        searchable: false,
      },
      valueFormatter: (p: any) => formatYesNo(!!p.value),
      cellRenderer: ClickToTechnical,
    },
    {
      headerName: t('pages.applications.columns.mfaEnabled'),
      field: 'mfa_supported',
      width: 140,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('mfa_supported', { coerceBoolean: true, labelFormatter: (v) => (v ? t('enums.yesNo.yes') : t('enums.yesNo.no')) }),
        searchable: false,
      },
      valueFormatter: (p: any) => formatYesNo(!!p.value),
      cellRenderer: ClickToTechnical,
    },
    {
      headerName: t('pages.applications.columns.dataIntegrationEtl'),
      field: 'etl_enabled',
      width: 190,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        values: [
          { value: 'true', label: t('enums.yesNo.yes') },
          { value: 'false', label: t('enums.yesNo.no') },
        ],
        searchable: false,
      },
      valueFormatter: (p: any) => formatYesNo(!!p.value),
      cellRenderer: ClickToTechnical,
    },

    { headerName: t('pages.applications.columns.opexItems'), field: 'spend_count', width: 180, defaultHidden: true, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: RelationsSummaryCell },
    { headerName: t('pages.applications.columns.capexItems'), field: 'capex_count', width: 180, defaultHidden: true, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: RelationsSummaryCell },
    { headerName: t('pages.applications.columns.contracts'), field: 'contracts_count', width: 180, defaultHidden: true, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: RelationsSummaryCell },

    // Structure: Components column remains optional
    { headerName: t('pages.applications.columns.components'), field: 'components_count', width: 200, defaultHidden: true, sortable: true, filter: 'agNumberColumnFilter', cellRenderer: ComponentsSummaryCell },

    {
      headerName: t('pages.applications.columns.dataClass'),
      field: 'data_class',
      width: 140,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('data_class', { labelFormatter: dataClassLabel }),
        sortComparator: catalogRankComparator(classificationCatalog?.dataClasses),
        searchable: false,
      },
      valueFormatter: (p: any) => dataClassLabel(p.value),
      cellRenderer: ClickToCompliance,
    },
    {
      headerName: t('pages.interfaces.columns.containsPii'),
      field: 'contains_pii',
      width: 140,
      defaultHidden: true,
      sortable: false,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAppFilterValues('contains_pii', { coerceBoolean: true, labelFormatter: (v) => (v ? t('enums.yesNo.yes') : t('enums.yesNo.no')) }),
        searchable: false,
      },
      valueFormatter: (p: any) => formatYesNo(!!p.value),
      cellRenderer: ClickToCompliance,
    },
    { headerName: t('pages.applications.columns.dataResidency'), field: 'data_residency', width: 200, defaultHidden: true, sortable: false, filter: 'agTextColumnFilter', cellRenderer: ResidencyCell },
  ], [
    ClickToCompliance,
    ClickToOverview,
    ClickToOwnership,
    ClickToTechnical,
    ComponentsSummaryCell,
    EnvironmentCell,
    NameWithSuiteCell,
    OwnersCell,
    RelationsSummaryCell,
    ResidencyCell,
    SuitesSummaryCell,
    categoryLabel,
    catalogLabel,
    classificationCatalog,
    criticalityLabel,
    currentYear,
    dataClassLabel,
    environmentLabel,
    formatYesNo,
    getAppFilterValues,
    labelFor,
    lifecycleLabel,
    locale,
    t,
    vulnerabilityFeed,
  ]);

  const initialState = useMemo(() => {
    if (!initialFilterModel) return undefined;
    return {
      filter: {
        filterModel: initialFilterModel,
      },
    };
  }, [initialFilterModel]);
  const appliedLateDefaultFilterRef = useRef(false);
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api) return;
    if (urlFilterState.model) return;
    if (!defaultFilterModel) return;
    if (appliedLateDefaultFilterRef.current) return;

    // The default arrives after the grid: add it unless the user already chose other filters
    // (the address filters alone do not count as a choice).
    const currentFilterModel = (api as any).getFilterModel?.() || {};
    const keys = Object.keys(currentFilterModel);
    const addressOnly = keys.every((key) => !!searchFilters && key in searchFilters);
    if (addressOnly && !keys.some((key) => key in defaultFilterModel)) {
      (api as any).setFilterModel?.({ ...defaultFilterModel, ...currentFilterModel });
      (api as any).onFilterChanged?.();
    }
    appliedLateDefaultFilterRef.current = true;
  }, [defaultFilterModel, urlFilterState.model, searchFilters]);

  const canCreate = hasLevel('applications', 'manager');
  const canAdmin = hasLevel('applications', 'admin');

  const handleCopy = useCallback(async () => {
    try {
      if (selectedRows.length !== 1) return;
      const source = selectedRows[0];
      const [res, suitesRes, spendRes, capexRes, contractsRes, supportContactsRes] = await Promise.all([
        api.get(`/applications/${source.id}`),
        api.get(`/applications/${source.id}/suites`).catch(() => ({ data: { items: [] } } as any)),
        api.get(`/applications/${source.id}/spend-items`).catch(() => ({ data: { items: [] } } as any)),
        api.get(`/applications/${source.id}/capex-items`).catch(() => ({ data: { items: [] } } as any)),
        api.get(`/applications/${source.id}/contracts`).catch(() => ({ data: { items: [] } } as any)),
        api.get(`/applications/${source.id}/support-contacts`).catch(() => ({ data: [] } as any)),
      ]);
      const a = res.data || {};
      // The suffix follows the screen language; the server numbers a name that is already taken.
      const tail = ` ${t('pages.applications.copySuffix')}`;
      const head = String(a.name || '').slice(0, Math.max(0, APPLICATION_NAME_MAX - tail.length)).trimEnd();
      const created = await api.post(`/applications/${source.id}/copy`, { name: `${head}${tail}` });
      const newId = created?.data?.id as string | undefined;
      if (newId) {
        // Prepare relation payloads
        const ownersRaw = ((a?.owners as any[]) || []).filter(Boolean) as Array<{ user_id: string; owner_type: 'business' | 'it' }>;
        const ownersPayload = ownersRaw
          .filter((o) => typeof o.user_id === 'string' && o.user_id.trim() !== '')
          .map((o) => ({ user_id: o.user_id, owner_type: o.owner_type } as const));
        const companies = ((a?.companies as any[]) || []).map((c: any) => c.company_id).filter((id: any) => typeof id === 'string');
        const departments = ((a?.departments as any[]) || []).map((d: any) => d.department_id).filter((id: any) => typeof id === 'string');
        const suites = (((suitesRes?.data?.items) as any[]) || []).map((s: any) => s.id).filter((id: any) => typeof id === 'string');
        const spend = (((spendRes?.data?.items) as any[]) || []).map((s: any) => s.id).filter((id: any) => typeof id === 'string');
        const capex = (((capexRes?.data?.items) as any[]) || []).map((c: any) => c.id).filter((id: any) => typeof id === 'string');
        const contracts = (((contractsRes?.data?.items) as any[]) || []).map((c: any) => c.id).filter((id: any) => typeof id === 'string');
        const links = ((a?.links as any[]) || []).map((l: any) => ({ description: l.description ?? null, url: String(l.url || '').trim() })).filter((l: any) => !!l.url);
        const residency = ((a?.data_residency as any[]) || []).map((r: any) => String(r.country_iso || '').toUpperCase()).filter((iso: string) => !!iso && iso.length === 2);
        const supportContacts = ((supportContactsRes?.data as any[]) || [])
          .filter((c: any) => typeof c.contact_id === 'string')
          .map((c: any) => ({ contact_id: c.contact_id, role: c.role ?? null }));

        // Apply bulk relations
        let linksError: unknown = null;
        try {
          await Promise.all([
            ownersPayload.length ? api.post(`/applications/${newId}/owners/bulk-replace`, { owners: ownersPayload }) : Promise.resolve(),
            companies.length ? api.post(`/applications/${newId}/companies/bulk-replace`, { company_ids: companies }) : Promise.resolve(),
            departments.length ? api.post(`/applications/${newId}/departments/bulk-replace`, { department_ids: departments }) : Promise.resolve(),
            suites.length ? api.post(`/applications/${newId}/suites/bulk-replace`, { suite_ids: suites }) : Promise.resolve(),
            spend.length ? api.post(`/applications/${newId}/spend-items/bulk-replace`, { spend_item_ids: spend }) : Promise.resolve(),
            capex.length ? api.post(`/applications/${newId}/capex-items/bulk-replace`, { capex_item_ids: capex }) : Promise.resolve(),
            contracts.length ? api.post(`/applications/${newId}/contracts/bulk-replace`, { contract_ids: contracts }) : Promise.resolve(),
            residency.length ? api.post(`/applications/${newId}/data-residency/bulk-replace`, { countries: residency }) : Promise.resolve(),
            supportContacts.length ? api.post(`/applications/${newId}/support-contacts/bulk-replace`, { contacts: supportContacts }) : Promise.resolve(),
          ]);
        } catch (err) { linksError = err; }
        // Recreate URLs (no bulk endpoint)
        try {
          for (const l of links) { await api.post(`/applications/${newId}/links`, l); }
        } catch (err) { linksError ??= err; }
        if (linksError) {
          // The copy exists: stay on the list, say what is missing.
          setNotice(`${t('pages.applications.copyLinksFailed')} ${getApiErrorMessage(linksError, t, '')}`.trim());
          setRefreshKey((k) => k + 1);
          return;
        }

        const sp = buildWorkspaceSearch();
        navigate(`/it/applications/${newId}/overview?${sp.toString()}`);
      }
    } catch (e) {
      setNotice(getApiErrorMessage(e, t, t('pages.applications.copyFailed')));
    }
  }, [selectedRows, navigate, buildWorkspaceSearch, t]);

  // The export holds what the list shows: its filters, quick search and scope (not the columns it asked for).
  const openExport = useCallback(() => {
    const request = listRequestRef.current;
    const { include: _include, ...params } = (request?.params ?? {}) as Record<string, unknown>;
    let summary = '';
    if (request) {
      const filtered = !!params.q || !!params.ownerUserId || !!params.ownerTeamId
        || (typeof params.filters === 'string' && params.filters !== '{}' && params.filters !== '');
      summary = filtered
        ? t('pages.applications.exportScope', { count: request.total })
        : t('pages.applications.exportScopeAll', { count: request.total });
    }
    setExportScope({ params, summary });
    setExportOpen(true);
  }, [t]);
  const openNewApplication = () => {
    const sp = buildWorkspaceSearch();
    navigate(`/it/applications/new/overview?${sp.toString()}`);
  };
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={openNewApplication}>
          {t('pages.applications.newAppService')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('pages.assets.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={openExport}>{t('common:export.button')}</Button>}
      {canCreate && (
        <Button variant="action" onClick={() => void handleCopy()} disabled={selectedRows.length !== 1}>{t('pages.applications.copyItem')}</Button>
      )}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/applications/bulk"
          getItemId={(row) => row.id}
          // The reference tells apart applications with the same name.
          getItemName={(row) => (row.sequential_id ? `${row.sequential_id} ${row.name}` : row.name)}
          // Asked on click: applications with interfaces are kept, the others go with their deployments (counted) and links.
          checkDelete={async (ids) => {
            const { refused, removes } = await applicationDeleteCheck(ids);
            const count = ids.length - refused.length;
            return {
              refused,
              warning: removes.length > 0
                ? t('pages.applications.delete.warningCounted', { count, removed: removedWithLinks(removes, t('pages.applications.delete.links', { count }), t, locale) })
                : t('pages.applications.delete.warningLinks', { count }),
            };
          }}
          // Without an answered check: what goes, the delete still refusing applications with interfaces.
          warning={t('pages.applications.delete.warning', { count: selectedRows.length })}
          itemLabels={{
            toDelete: (count) => t('pages.applications.delete.toDelete', { count }),
            kept: (count) => t('pages.applications.delete.kept', { count }),
            deleted: (count) => t('pages.applications.delete.deleted', { count }),
            title: (count) => t('pages.applications.delete.title', { count }),
            titleCountsDeleted: true,
            keptDone: (count) => t('pages.applications.delete.keptDone', { count }),
            // The kept list already names the application: the reason does not repeat it.
            keptReason: ({ usages, count }) => t('pages.applications.delete.keptReason', { usages, count }),
          }}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.applications.title')} actions={actions} />
      {notice && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>
      )}
      {/* Waits for filters saved as a context (a reload, a link in a new tab). */}
      {/* A filter on the Vulnerabilities column also waits for the column: the grid drops a filter on a column it does not have. */}
      {urlFilterState.ready && !(searchFilters?.[VULNERABILITIES_FIELD] && featuresLoading) && (
        <ServerDataGrid<AppRow>
          columns={columns}
          endpoint={'/applications'}
          showRowCount
          queryKey={'applications'}
          defaultSort={{ field: 'name', direction: 'ASC' }}
          // A link's filter on a hidden column (a supplier's "Show all") shows that column, next to the name.
          showFilteredColumns
          filteredColumnsAfter="name"
          initialState={initialState}
          defaultFilterModel={defaultFilterModel}
          extraParams={extraParams}
          requiredColumns={['name']}
          onGridApiReady={(api) => {
            gridApiRef.current = api;
            try {
              const state = (api as any).getColumnState?.() || [];
              const visible = new Set<string>(state.filter((s: any) => !s.hide).map((s: any) => String(s.colId || '')));
              setIncludeFlags(includeFlagsFor(visible));
              setSuitesColVisible(visible.has('suites_count'));
            } catch {}
          }}
          enableColumnChooser
          columnPreferencesKey="it-apps-services"
          refreshKey={refreshKey}
          enableSearch
          enableRowSelection={canCreate || canAdmin}
          onSelectionChanged={setSelectedRows}
          onListRequestChange={(request) => { listRequestRef.current = request; }}
          onQueryStateChange={(state) => {
            lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
          }}
          emptyState={(
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" data-testid="applications-empty">
              <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('pages.applications.empty')}</Typography>
              {canCreate && (
                <Button variant="contained" size="small" onClick={openNewApplication}>
                  {t('pages.applications.newAppService')}
                </Button>
              )}
            </Stack>
          )}
          onColumnStateChange={(state) => {
            try {
              // Compute include flags based on visible columns
              const visible = new Set<string>(
                (state || [])
                  .filter((s: any) => !s.hide)
                  .map((s: any) => String(s.colId || ''))
              );
              const next = includeFlagsFor(visible);
              setIncludeFlags((prev) => (prev === next ? prev : next));
              setSuitesColVisible(visible.has('suites_count'));
            } catch {}
          }}
          toolbarExtras={appScopeToolbar}
        />
      )}
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/applications"
        title={t('pages.applications.exportTitle')}
        params={exportScope.params}
        scopeSummary={exportScope.summary}
        presets={[{ name: 'enrichment', label: t('pages.assets.dataEnrichment') }]}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/applications"
        title={t('pages.applications.importTitle')}
        note={t('pages.applications.importNote')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}

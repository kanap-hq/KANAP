import { classificationText } from '../../utils/applicationClassification';
import React, { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Box, Button, Stack, Chip, Tooltip, Typography, RadioGroup, FormControlLabel, Radio, Link, useTheme } from '@mui/material';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { ICellRendererParams } from 'ag-grid-community';
import { useNavigate, useLocation } from 'react-router-dom';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import { useQuery } from '@tanstack/react-query';
import ForbiddenPage from '../ForbiddenPage';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import { COUNTRY_OPTIONS } from '../../constants/isoOptions';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { useGridScopePreference } from '../../hooks/useGridScopePreference';
import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import { formatDuration } from './components/DurationEditor';

import { useTranslation } from 'react-i18next';
const ENV_SUMMARY = [
  { value: 'prod', labelKey: 'enums.environment.production', short: 'Prod' },
  { value: 'pre_prod', labelKey: 'enums.environment.preProd', short: 'Pre' },
  { value: 'qa', labelKey: 'enums.environment.qa', short: 'QA' },
  { value: 'test', labelKey: 'enums.environment.test', short: 'Test' },
  { value: 'dev', labelKey: 'enums.environment.dev', short: 'Dev' },
  { value: 'sandbox', labelKey: 'enums.environment.sandbox', short: 'Sb' },
] as const;

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
  components_count?: number;
  first_component_name?: string | null;
  instances?: AppInstanceSummary[];
};

/** Orders set-filter values like the catalog: most severe first (waves in restoration order); unknown codes and blanks last. */
export function catalogRankComparator(levels: Array<{ code: string; rank?: number; order?: number }> | undefined, kind: 'rank' | 'order' = 'rank') {
  const position = new Map((levels || []).map((level) => [level.code, kind === 'order' ? Number(level.order) : -Number(level.rank)]));
  return (a: { value: string | null }, b: { value: string | null }) => {
    const left = a.value == null ? Number.POSITIVE_INFINITY : position.get(String(a.value)) ?? Number.MAX_SAFE_INTEGER;
    const right = b.value == null ? Number.POSITIVE_INFINITY : position.get(String(b.value)) ?? Number.MAX_SAFE_INTEGER;
    return left === right ? String(a.value ?? '').localeCompare(String(b.value ?? '')) : left - right;
  };
}

export default function ApplicationsPage() {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel, profile } = useAuth();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<AppRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const { labelFor, byField } = useItOpsEnumOptions();
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const [includeFlags, setIncludeFlags] = useState<string>('');

  // Read filters from URL to restore state when returning from workspace
  const urlFilters = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const filtersParam = params.get('filters');
    if (filtersParam) {
      try {
        return JSON.parse(filtersParam);
      } catch {
        return null;
      }
    }
    return null;
  }, [location.search]);
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

  // Use URL filters if present, otherwise use default if available
  const initialFilterModel = useMemo(() => {
    if (urlFilters && typeof urlFilters === 'object') return urlFilters;
    return defaultFilterModel || undefined;
  }, [urlFilters, defaultFilterModel]);
  const [suitesColVisible, setSuitesColVisible] = useState<boolean>(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'name:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
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
    return String(v || classificationText('Not set'));
  }, [classificationCatalog?.businessCriticalityLevels, t]);
  const catalogLabel = useCallback((axis: 'cyber' | 'wave', value?: string | null) => {
    if (!value) return classificationText("Not set");
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
    switch (String(v || '')) {
      case 'prod': return 'Prod';
      case 'pre_prod': return 'Pre-prod';
      case 'qa': return 'QA';
      case 'test': return 'Test';
      case 'dev': return 'Dev';
      case 'sandbox': return 'Sandbox';
      default: return String(v || '');
    }
  }, []);
  const dataClassLabel = useCallback((v?: string) => {
    return classificationCatalog?.dataClasses.find((item) => item.code === v)?.label || v || classificationText('Not set');
  }, [classificationCatalog?.dataClasses]);

  const getAppFilterValues = useCallback((
    field: string,
    opts?: { labelFormatter?: (value: any) => string; emptyLabel?: string; coerceBoolean?: boolean },
  ) => {
    const emptyLabel = opts?.emptyLabel ?? t('pages.assets.filters.blank');
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
      const res = await api.get(`/applications/filter-values`, { params });
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

  const countryNameByCode = useMemo(
    () => new Map(COUNTRY_OPTIONS.map((c) => [c.code.toUpperCase(), c.name])),
    [],
  );
  const formatYesNo = useCallback((b?: boolean) => (b ? t('enums.yesNo.yes') : t('enums.yesNo.no')), []);

  if (!hasLevel('applications', 'reader')) {
    return <ForbiddenPage />;
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
          sx={{ cursor: 'pointer' }}
          underline="none"
          color="inherit"
        >
          {`${first}${extra}`}
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
      const fullNames = arr.map((c) => countryNameByCode.get(String(c || '').toUpperCase()) || String(c || ''));
      return (
        <Link
          href={buildAppHref(params.data as AppRow, 'compliance')}
          onClick={(event) => handleInternalNavigate(event, buildAppHref(params.data as AppRow, 'compliance'))}
          sx={{ cursor: 'pointer' }}
          underline="none"
          color="inherit"
        >
          {firstTwo.join(', ')}{extra}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, countryNameByCode, handleInternalNavigate]);

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
          sx={{ cursor: 'pointer' }}
          underline="none"
          color="inherit"
        >
          {(first || '') + (extra || '')}
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
      return (
        <Link
          href={buildAppHref(data as AppRow, 'relations')}
          onClick={(event) => handleInternalNavigate(event, buildAppHref(data as AppRow, 'relations'))}
          sx={{ cursor: 'pointer' }}
          underline="none"
          color="inherit"
        >
          {(first || '') + (extra || '')}
        </Link>
      );
    };
    return Cell;
  }, [buildAppHref, handleInternalNavigate]);

  const NameWithSuiteCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const data = params.data as AppRow | undefined;
      const name = params.valueFormatted ?? params.value;
      const suitesCount = data?.suites_count || 0;
      const firstSuite = data?.first_suite_name || null;
      const extra = suitesCount > 1 ? ` +${suitesCount - 1}` : '';
      return (
        <Stack component="span" direction="row" spacing={1} alignItems="center">
          <Box component="span">
            <Link
              href={buildAppHref(data as AppRow, 'overview')}
              onClick={(event) => handleInternalNavigate(event, buildAppHref(data as AppRow, 'overview'))}
              sx={{ cursor: 'pointer', display: 'block' }}
              underline="none"
              color="inherit"
            >
              {name}
            </Link>
            <Typography variant="caption" color="text.secondary" component="span">
              {categoryLabel(data?.category)}
            </Typography>
          </Box>
          {(firstSuite && suitesCount > 0 && !suitesColVisible) && (
            <Box
              component="a"
              href={buildAppHref(data as AppRow, 'relations')}
              sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: 'action.hover', color: 'text.secondary', cursor: 'pointer', fontSize: '0.75rem' }}
              onClick={(e) => {
                e.stopPropagation();
                handleInternalNavigate(e, buildAppHref(data as AppRow, 'relations'));
              }}
            >
              {t('pages.applications.includedIn')} {firstSuite}{extra}
            </Box>
          )}
        </Stack>
      );
    };
    return Cell;
  }, [buildAppHref, categoryLabel, handleInternalNavigate, suitesColVisible, t]);

  const EnvironmentCell = useMemo(() => {
    const mode = theme.palette.mode;
    const Cell: React.FC<ICellRendererParams<AppRow, any>> = (params) => {
      const instances = (params.data?.instances || []) as AppInstanceSummary[];
      const activeEnvs = ENV_SUMMARY.map((env) => {
        const match = instances.find((inst) => inst.environment === env.value);
        if (!isInstanceActive(match)) return null;
        return { env, match: match as AppInstanceSummary };
      }).filter(Boolean) as Array<{ env: typeof ENV_SUMMARY[number]; match: AppInstanceSummary }>;
      if (activeEnvs.length === 0) {
        return (
          <Typography variant="body2" color="text.secondary">
            {t('pages.applications.noActiveEnvironments')}
          </Typography>
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
          {activeEnvs.map(({ env, match }) => {
            const lifecycleText = match.lifecycle ? ` · ${lifecycleLabel(match.lifecycle)}` : '';
            const tooltip = `${t(env.labelKey)}${match.base_url ? ` · ${match.base_url}` : ''}${lifecycleText}`;
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
                    '&:hover': { textDecoration: 'none' },
                  }}
                >
                  <StatusDot color={getEnvDotColor(env.value, mode)} />
                  {env.short}
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

  const columns: EnhancedColDef<AppRow>[] = useMemo(() => [
    {
      headerName: t('common.name'), field: 'name', minWidth: 200,
      cellRenderer: NameWithSuiteCell,
    },
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
    { headerName: classificationText("Recovery wave"), field: 'recovery_wave', filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: getAppFilterValues('recovery_wave', { labelFormatter: (v: any) => catalogLabel('wave', v) }), sortComparator: catalogRankComparator(classificationCatalog?.recoveryWaves, 'order') }, width: 160, defaultHidden: true, valueFormatter: (p: any) => catalogLabel('wave', p.value), cellRenderer: ClickToCompliance },
    { headerName: 'RTO', field: 'rto_minutes', width: 110, defaultHidden: true, filter: 'agNumberColumnFilter', valueFormatter: (p: any) => formatDuration(p.value, ''), cellRenderer: ClickToCompliance },
    { headerName: 'RPO', field: 'rpo_minutes', width: 110, defaultHidden: true, filter: 'agNumberColumnFilter', valueFormatter: (p: any) => formatDuration(p.value, ''), cellRenderer: ClickToCompliance },
    { headerName: classificationText("Classification review"), field: 'classification_review_state', filter: CheckboxSetFilter, floatingFilterComponent: CheckboxSetFloatingFilter, filterParams: { getValues: getAppFilterValues('classification_review_state', { labelFormatter: (value: string) => ({ incomplete: classificationText('To complete'), stale: classificationText('Review needed'), reviewed: classificationText('Reviewed') }[value] || value) }) }, width: 170, defaultHidden: true, valueFormatter: (p: any) => ({ incomplete: classificationText("To complete"), stale: classificationText("Review needed"), reviewed: classificationText("Reviewed") }[String(p.value)] || classificationText("To complete")), cellRenderer: ClickToCompliance },
    { headerName: classificationText("Classification reviewed"), field: 'classification_reviewed_at', filter: 'agDateColumnFilter', width: 180, defaultHidden: true, valueFormatter: (p: any) => p.value ? new Date(p.value).toLocaleDateString() : classificationText('Not set'), cellRenderer: ClickToCompliance },
    { headerName: t('pages.applications.columns.publisher'), field: 'editor', width: 160, cellRenderer: ClickToOverview },
    { headerName: t('pages.applications.columns.derivedUsers'), field: 'derived_total_users', width: 170, cellRenderer: ClickToOwnership },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 160, cellRenderer: ClickToOverview },

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
        getValues: getAppFilterValues('data_class', { labelFormatter: dataClassLabel, emptyLabel: '(Blank)' }),
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
    dataClassLabel,
    environmentLabel,
    formatYesNo,
    getAppFilterValues,
    labelFor,
    lifecycleLabel,
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
    if (urlFilters && typeof urlFilters === 'object') return;
    if (!defaultFilterModel) return;
    if (appliedLateDefaultFilterRef.current) return;

    const currentFilterModel = (api as any).getFilterModel?.() || {};
    if (!Object.keys(currentFilterModel).length) {
      (api as any).setFilterModel?.(defaultFilterModel);
      (api as any).onFilterChanged?.();
    }
    appliedLateDefaultFilterRef.current = true;
  }, [defaultFilterModel, urlFilters]);

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
      const created = await api.post(`/applications/${source.id}/copy`, { name: `${a.name || ''} (copy)` });
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
        } catch {}
        // Recreate URLs (no bulk endpoint)
        try {
          for (const l of links) { await api.post(`/applications/${newId}/links`, l); }
        } catch {}

        const sp = buildWorkspaceSearch();
        navigate(`/it/applications/${newId}/overview?${sp.toString()}`);
      }
    } catch (e) {
      // Silently ignore; could add toast in future
    }
  }, [selectedRows, navigate, buildWorkspaceSearch]);
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="contained"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/it/applications/new/overview?${sp.toString()}`);
          }}
        >
          {t('pages.applications.newAppService')}
        </Button>
      )}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('pages.assets.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('pages.assets.exportCsv')}</Button>}
      {canCreate && (
        <Button onClick={() => void handleCopy()} disabled={selectedRows.length !== 1}>{t('pages.applications.copyItem')}</Button>
      )}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/applications/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.applications.title')} actions={actions} />
      <ServerDataGrid<AppRow>
        columns={columns}
        endpoint={'/applications'}
        showRowCount
        queryKey={'applications'}
        defaultSort={{ field: 'name', direction: 'ASC' }}
        initialState={initialState}
        extraParams={extraParams}
        requiredColumns={['name']}
        onGridApiReady={(api) => {
          gridApiRef.current = api;
          try {
            const state = (api as any).getColumnState?.() || [];
            const visible = new Set<string>(state.filter((s: any) => !s.hide).map((s: any) => String(s.colId || '')));
            const needsSupplier = visible.has('supplier_name');
            const needsOwners = visible.has('owners_business') || visible.has('owners_it');
            const needsResidency = visible.has('data_residency');
            const needsHosting = visible.has('hosting_types');
            const needsCounts = visible.has('spend_count') || visible.has('capex_count') || visible.has('contracts_count');
            const needsStructure = visible.has('suites_count') || visible.has('components_count');
            const needsInstances = visible.has('environments');
            const flags: string[] = [];
            if (needsSupplier) flags.push('supplier');
            if (needsOwners) flags.push('owners');
            if (needsResidency) flags.push('residency');
            if (needsHosting) flags.push('hosting');
            if (needsCounts) flags.push('counts');
            if (needsStructure) flags.push('structure');
            if (needsInstances) flags.push('instances');
            setIncludeFlags(flags.join(','));
            setSuitesColVisible(visible.has('suites_count'));
          } catch {}
        }}
        enableColumnChooser
        columnPreferencesKey="it-apps-services"
        refreshKey={refreshKey}
        enableSearch
        enableRowSelection={canCreate || canAdmin}
        onSelectionChanged={setSelectedRows}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
        onColumnStateChange={(state) => {
          try {
            // Compute include flags based on visible columns
            const visible = new Set<string>(
              (state || [])
                .filter((s: any) => !s.hide)
                .map((s: any) => String(s.colId || ''))
            );
            const needsSupplier = visible.has('supplier_name');
            const needsOwners = visible.has('owners_business') || visible.has('owners_it');
            const needsResidency = visible.has('data_residency');
            const needsHosting = visible.has('hosting_types');
            const needsCounts = visible.has('spend_count') || visible.has('capex_count') || visible.has('contracts_count');
            const needsStructure = visible.has('suites_count') || visible.has('components_count');
            const needsInstances = visible.has('environments');
            const flags: string[] = [];
            if (needsSupplier) flags.push('supplier');
            if (needsOwners) flags.push('owners');
            if (needsResidency) flags.push('residency');
            if (needsHosting) flags.push('hosting');
            if (needsCounts) flags.push('counts');
            if (needsStructure) flags.push('structure');
            if (needsInstances) flags.push('instances');
            const next = flags.join(',');
            setIncludeFlags((prev) => (prev === next ? prev : next));
            setSuitesColVisible(visible.has('suites_count'));
          } catch {}
        }}
        toolbarExtras={appScopeToolbar}
      />
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/applications"
        title={t('pages.applications.exportTitle')}
        presets={[{ name: 'enrichment', label: t('pages.assets.dataEnrichment') }]}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/applications"
        title={t('pages.applications.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}

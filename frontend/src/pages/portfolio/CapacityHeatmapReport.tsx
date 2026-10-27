import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ButtonBase,
  Collapse,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Checkbox,
  ListItemText,
  Autocomplete,
} from '@mui/material';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef, CellStyle } from 'ag-grid-community';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import ReportLayout, {
  ReportFilter,
  reportFilterMenuProps,
  reportFilterSelectSx,
  reportGridHeight,
  useFillViewportHeight,
} from '../../components/reports/ReportLayout';
import { drawerMenuItemSx, textTabSx, textTabsSx } from '../../theme/formSx';
import api from '../../api';
import ContributorDrilldownDialog from './components/ContributorDrilldownDialog';
import { useTranslation } from 'react-i18next';
import { formatPercentPoints } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';

type CapacityColorBand = 'green' | 'yellow' | 'orange' | 'red' | 'violet' | 'na';

type ContributorCapacityRow = {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string | null;
  remainingDays: number;
  capacityDaysPerMonth: number | null;
  capacitySource: 'historical' | 'theoretical' | null;
  monthsOfWork: number | null;
  colorBand: CapacityColorBand;
  hasContributorProfile: boolean;
};

type TeamCapacityRow = {
  teamId: string;
  teamName: string;
  memberCount: number;
  remainingDays: number;
  capacityDaysPerMonth: number | null;
  monthsOfWork: number | null;
  colorBand: CapacityColorBand;
};

type UnassignedProjectRow = {
  projectId: string;
  projectName: string;
  status: string;
  estimatedEffort: number;
  remainingEffort: number;
  unallocatedPct: number;
  unallocatedDays: number;
};

type CapacityHeatmapResponse = {
  contributors: ContributorCapacityRow[];
  teams: TeamCapacityRow[];
  unassignedSummary: { totalProjects: number; totalUnallocatedDays: number };
  unassignedProjects: UnassignedProjectRow[];
  filters: { teamIds: string[]; statuses: string[]; capacityMode: string; groupBy: string };
};

type TeamOption = { id: string; name: string };

const NO_TEAM_ID = 'no-team';
const STATUS_VALUES = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold', 'done', 'cancelled'];

const DEFAULT_STATUSES = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'];

const HEATMAP_COLORS: Record<CapacityColorBand, string> = {
  green: '#C8E6C9',
  yellow: '#FFF9C4',
  orange: '#FFE0B2',
  red: '#FFCDD2',
  violet: '#E1BEE7',
  na: '#E0E0E0',
};

// The bands are pale fills in both themes (and in the PNG export, which is always light), so the
// figure on top keeps a dark ink instead of following the theme's text colour.
const HEATMAP_TEXT_COLOR = '#111827';

const HEATMAP_LEGEND_BANDS: CapacityColorBand[] = ['green', 'yellow', 'orange', 'red', 'violet', 'na'];

/** Charter card: 8px radius, 1px border, no shadow at rest, 16px padding. */
const cardSx = {
  bgcolor: 'kanap.bg.primary',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  p: 2,
  transition: 'box-shadow 160ms ease, transform 160ms ease',
} as const;

/** Same surface, used for the two content sections of the report. */
const sectionSurfaceSx = cardSx;

const exportElementAsPng = async (node: HTMLElement, fileName: string) => {
  const width = node.scrollWidth;
  const height = node.scrollHeight;
  if (!width || !height) return;

  let cssText = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        cssText += rule.cssText;
      }
    } catch {
      // Ignore cross-origin stylesheets
    }
  }

  const serializer = new XMLSerializer();
  const cloned = node.cloneNode(true) as HTMLElement;
  cloned.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  if (cloned.classList.contains('ag-theme-quartz-dark')) {
    cloned.classList.remove('ag-theme-quartz-dark');
    cloned.classList.add('ag-theme-quartz');
  }
  cloned.querySelectorAll('.ag-theme-quartz-dark').forEach((gridNode) => {
    gridNode.classList.remove('ag-theme-quartz-dark');
    gridNode.classList.add('ag-theme-quartz');
  });
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>${cssText}</style>
      <foreignObject width="100%" height="100%">${serializer.serializeToString(cloned)}</foreignObject>
    </svg>
  `;

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const link = document.createElement('a');
    link.download = `${fileName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  img.src = url;
};

export default function CapacityHeatmapReport() {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const [capacityMode, setCapacityMode] = useState<'historical' | 'theoretical'>('historical');
  const [groupBy, setGroupBy] = useState<'contributor' | 'team'>('contributor');
  const [statuses, setStatuses] = useState<string[]>(DEFAULT_STATUSES);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [drilldownContributor, setDrilldownContributor] = useState<{ id: string; name: string } | null>(null);

  // The legend, the profileless note and the page gutter live under the grid.
  const { ref: gridRef, height: fillHeight } = useFillViewportHeight(320, 120);

  const unassignedGridRef = useRef<any>(null);
  const heatmapExportRef = useRef<HTMLDivElement | null>(null);
  const initialTeamsSet = useRef(false);

  const { data: teamsData, isLoading: isLoadingTeams } = useQuery<TeamOption[]>({
    queryKey: ['portfolio-teams'],
    queryFn: async () => {
      const res = await api.get('/portfolio/teams');
      return (res.data || []) as TeamOption[];
    },
  });

  const statusOptions = useMemo(
    () => STATUS_VALUES.map((value) => ({ value, label: t(`statuses.project.${value}`) })),
    [t],
  );

  const statusLabelMap = useMemo(() => statusOptions.reduce((acc, curr) => {
    acc[curr.value] = curr.label;
    return acc;
  }, {} as Record<string, string>), [statusOptions]);

  const teamOptions = useMemo<TeamOption[]>(() => {
    const teams = (teamsData || []).map((t) => ({ id: t.id, name: t.name }));
    return [...teams, { id: NO_TEAM_ID, name: t('reports.capacityHeatmap.values.noTeam') }];
  }, [t, teamsData]);

  useEffect(() => {
    if (initialTeamsSet.current) return;
    if (isLoadingTeams) return;
    if (teamOptions.length === 0) return;
    setSelectedTeamIds(teamOptions.map((t) => t.id));
    initialTeamsSet.current = true;
  }, [teamOptions, isLoadingTeams]);

  const allTeamIds = teamOptions.map((t) => t.id);
  const selectedTeams = teamOptions.filter((t) => selectedTeamIds.includes(t.id));
  const teamParam = selectedTeamIds.length === 0 || selectedTeamIds.length === allTeamIds.length
    ? undefined
    : selectedTeamIds.join(',');

  const queryKey = ['portfolio-capacity-heatmap', teamParam, statuses, capacityMode, groupBy];
  const { data, isLoading, isFetching } = useQuery<CapacityHeatmapResponse>({
    queryKey,
    queryFn: async () => {
      const params: any = { capacityMode, groupBy };
      if (teamParam) params.teamIds = teamParam;
      if (statuses.length) params.statuses = statuses.join(',');
      const res = await api.get('/portfolio/reports/capacity-heatmap', { params });
      return res.data;
    },
    placeholderData: keepPreviousData,
  });

  const rows = groupBy === 'team' ? (data?.teams ?? []) : (data?.contributors ?? []);
  const unassigned = data?.unassignedProjects ?? [];
  const unassignedSummary = data?.unassignedSummary ?? { totalProjects: 0, totalUnallocatedDays: 0 };

  const avgMonths = useMemo(() => {
    const values = (data?.contributors ?? []).map((c) => c.monthsOfWork).filter((v) => v != null) as number[];
    if (!values.length) return null;
    const total = values.reduce((s, v) => s + v, 0);
    return total / values.length;
  }, [data?.contributors]);

  const profiledContributorCount = useMemo(
    () => (data?.contributors ?? []).filter((c) => c.hasContributorProfile !== false).length,
    [data?.contributors],
  );
  const profileless = useMemo(() => {
    const list = (data?.contributors ?? []).filter((c) => c.hasContributorProfile === false);
    return { count: list.length, days: list.reduce((sum, c) => sum + c.remainingDays, 0) };
  }, [data?.contributors]);

  const heatmapCellStyle = useCallback((params: any): CellStyle => {
    const band: CapacityColorBand = params.data?.colorBand ?? 'na';
    return { backgroundColor: HEATMAP_COLORS[band], color: HEATMAP_TEXT_COLOR, fontWeight: 500 };
  }, []);

  const formatNumberLabel = useCallback((value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value)) return t('reports.capacityHeatmap.values.notAvailable');
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  }, [locale, t]);

  const formatPercentLabel = useCallback((value: number | null | undefined): string => {
    if (value == null || !Number.isFinite(value)) return t('reports.capacityHeatmap.values.notAvailable');
    return formatPercentPoints(value, locale, 1);
  }, [locale, t]);

  const formatSourceLabel = useCallback((value: ContributorCapacityRow['capacitySource']) => {
    if (value === 'historical') return t('reports.capacityHeatmap.values.historical');
    if (value === 'theoretical') return t('reports.capacityHeatmap.values.theoretical');
    return t('reports.capacityHeatmap.values.notAvailable');
  }, [t]);

  const contributorColumns = useMemo<ColDef[]>(() => ([
    { field: 'contributorName', headerName: t('reports.capacityHeatmap.columns.contributor'), flex: 1, minWidth: 200 },
    {
      field: 'teamName',
      headerName: t('reports.capacityHeatmap.columns.team'),
      width: 200,
      valueGetter: (p) => {
        if (p.data?.hasContributorProfile === false) return t('reports.capacityHeatmap.values.noContributorProfile');
        return p.data?.teamName || t('reports.capacityHeatmap.values.noTeam');
      },
    },
    {
      field: 'remainingDays',
      headerName: t('reports.capacityHeatmap.columns.remainingDays'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'capacityDaysPerMonth',
      headerName: t('reports.capacityHeatmap.columns.capacityPerMonth'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'capacitySource',
      headerName: t('reports.capacityHeatmap.columns.source'),
      width: 120,
      valueFormatter: (p) => formatSourceLabel(p.value),
    },
    {
      field: 'monthsOfWork',
      headerName: t('reports.capacityHeatmap.columns.monthsOfWork'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
      cellStyle: heatmapCellStyle,
    },
  ]), [formatNumberLabel, formatSourceLabel, heatmapCellStyle, t]);

  const teamColumns = useMemo<ColDef[]>(() => ([
    {
      field: 'teamName',
      headerName: t('reports.capacityHeatmap.columns.team'),
      flex: 1,
      minWidth: 200,
      // The people without a team come as one pseudo team: its name is the screen's words, as in the export.
      valueGetter: (p) => (p.data?.teamId === NO_TEAM_ID ? t('reports.capacityHeatmap.values.noTeam') : p.data?.teamName),
    },
    {
      field: 'memberCount',
      headerName: t('reports.capacityHeatmap.columns.members'),
      width: 120,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'remainingDays',
      headerName: t('reports.capacityHeatmap.columns.remainingDays'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'capacityDaysPerMonth',
      headerName: t('reports.capacityHeatmap.columns.capacityPerMonth'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'monthsOfWork',
      headerName: t('reports.capacityHeatmap.columns.monthsOfWork'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
      cellStyle: heatmapCellStyle,
    },
  ]), [formatNumberLabel, heatmapCellStyle, t]);

  const unassignedColumns = useMemo<ColDef[]>(() => ([
    { field: 'projectName', headerName: t('reports.capacityHeatmap.columns.project'), flex: 1, minWidth: 220 },
    {
      field: 'status',
      headerName: t('reports.capacityHeatmap.columns.status'),
      width: 140,
      valueFormatter: (p) => statusLabelMap[p.value] || p.value,
    },
    {
      field: 'estimatedEffort',
      headerName: t('reports.capacityHeatmap.columns.estimatedEffort'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'remainingEffort',
      headerName: t('reports.capacityHeatmap.columns.remaining'),
      width: 130,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
    {
      field: 'unallocatedPct',
      headerName: t('reports.capacityHeatmap.columns.unallocatedPercent'),
      width: 140,
      type: 'rightAligned',
      valueFormatter: (p) => formatPercentLabel(p.value),
    },
    {
      field: 'unallocatedDays',
      headerName: t('reports.capacityHeatmap.columns.unallocatedDays'),
      width: 150,
      type: 'rightAligned',
      valueFormatter: (p) => formatNumberLabel(p.value),
    },
  ]), [formatNumberLabel, formatPercentLabel, statusLabelMap, t]);

  const handleExportPng = () => {
    if (!heatmapExportRef.current) return;
    exportElementAsPng(heatmapExportRef.current, `capacity-heatmap-${groupBy}`);
  };

  return (
    <ReportLayout
      title={t('reports.capacityHeatmap.title')}
      subtitle={t('reports.capacityHeatmap.subtitle')}
      filters={(
        <>
          <ReportFilter label={t('reports.capacityHeatmap.filters.teams')} width={240}>
            <Autocomplete
            multiple
            size="small"
            disableCloseOnSelect
            options={teamOptions}
            value={selectedTeams}
            onChange={(_, next) => {
              const ids = next.map((t) => t.id);
              if (ids.length === 0 && allTeamIds.length > 0) {
                setSelectedTeamIds(allTeamIds);
                return;
              }
              setSelectedTeamIds(ids);
            }}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderOption={(props, option, { selected }) => {
              // React wants the key passed on its own, not spread with the other props.
              const { key, ...optionProps } = props;
              return (
                <li key={key} {...optionProps}>
                  <Checkbox size="small" checked={selected} sx={{ mr: 1 }} />
                  <ListItemText primary={option.name} primaryTypographyProps={{ fontSize: 13 }} />
                </li>
              );
            }}
            renderTags={() => []}
            renderInput={(params) => {
              const count = selectedTeamIds.length;
              const label = count === 0 || count === allTeamIds.length
                ? t('reports.capacityHeatmap.filters.allTeams')
                : t('reports.capacityHeatmap.filters.teamsSelected', { count });
              return (
                <TextField
                  {...params}
                  placeholder={label}
                  sx={{ '& input': { fontSize: 13 } }}
                />
              );
            }}
            sx={{ width: '100%' }}
            />
          </ReportFilter>
          <ReportFilter label={t('reports.capacityHeatmap.filters.status')} width={240}>
            <TextField
              select
              size="small"
              value={statuses}
              SelectProps={{
                multiple: true,
                MenuProps: reportFilterMenuProps,
                renderValue: (sel: any) => (sel as string[]).map((s) => statusLabelMap[s] || s).join(', '),
              }}
              onChange={(e) => {
                const value = e.target.value as unknown as string[];
                const arr = Array.isArray(value) ? value : [value];
                if (arr.length === 0) setStatuses(DEFAULT_STATUSES);
                else setStatuses(arr);
              }}
              sx={reportFilterSelectSx}
            >
              {statusOptions.map((s) => (
                <MenuItem key={s.value} value={s.value} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={statuses.includes(s.value)} />
                  <ListItemText primary={s.label} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          {/* Charter: compact text tabs, never a ToggleButtonGroup (uppercase, heavy boxes). */}
          <Tabs
            value={capacityMode}
            onChange={(_, v) => { if (v) setCapacityMode(v); }}
            sx={{ ...textTabsSx, alignSelf: 'flex-end', mb: '6px' }}
          >
            <Tab value="historical" label={t('reports.capacityHeatmap.filters.historical')} sx={textTabSx(capacityMode === 'historical')} />
            <Tab value="theoretical" label={t('reports.capacityHeatmap.filters.theoretical')} sx={textTabSx(capacityMode === 'theoretical')} />
          </Tabs>
          <Tabs
            value={groupBy}
            onChange={(_, v) => { if (v) setGroupBy(v); }}
            sx={{ ...textTabsSx, alignSelf: 'flex-end', mb: '6px' }}
          >
            <Tab value="contributor" label={t('reports.capacityHeatmap.filters.contributors')} sx={textTabSx(groupBy === 'contributor')} />
            <Tab value="team" label={t('reports.capacityHeatmap.filters.teamsGroup')} sx={textTabSx(groupBy === 'team')} />
          </Tabs>
        </>
      )}
      tableExport={{
        url: '/portfolio/reports/capacity-heatmap/export',
        params: { capacityMode, groupBy, teamIds: teamParam, statuses: statuses.join(',') },
        fileBase: `capacity-heatmap-${groupBy}`,
      }}
      onExportChartPng={handleExportPng}
    >
      <Box className="capacity-heatmap-print">
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <SummaryCard
              label={t('reports.capacityHeatmap.summary.totalContributors')}
              value={formatNumberLabel(profiledContributorCount)}
              helper={groupBy === 'team' ? t('reports.capacityHeatmap.summary.totalContributorsHelper', { count: (data?.teams ?? []).length }) : undefined}
            />
            <SummaryCard
              label={t('reports.capacityHeatmap.summary.avgMonthsOfWork')}
              value={avgMonths != null ? formatNumberLabel(avgMonths) : t('reports.capacityHeatmap.values.notAvailable')}
              helper={t('reports.capacityHeatmap.summary.avgMonthsOfWorkHelper')}
            />
            <SummaryCard
              label={t('reports.capacityHeatmap.summary.unassignedWork')}
              value={t('reports.capacityHeatmap.summary.unassignedWorkValue', { value: formatNumberLabel(unassignedSummary.totalUnallocatedDays) })}
              helper={t('reports.capacityHeatmap.summary.unassignedWorkHelper', { count: unassignedSummary.totalProjects })}
              onClick={() => setUnassignedOpen((v) => !v)}
            />
          </Stack>

          <Box sx={sectionSurfaceSx}>
            <Typography sx={{ mb: 1, fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
              {groupBy === 'team' ? t('reports.capacityHeatmap.sections.teamCapacity') : t('reports.capacityHeatmap.sections.contributorCapacity')}
            </Typography>
            <Box ref={heatmapExportRef} sx={{ width: '100%' }}>
              {/* The grid fills what is left of the viewport; the legend and footnotes below
                  are reserved by `useFillViewportHeight`'s bottom padding. */}
              <ReportGrid
                wrapperRef={gridRef}
                wrapperSx={{ height: reportGridHeight(fillHeight, rows.length) }}
                rowData={rows}
                columnDefs={groupBy === 'team' ? teamColumns : contributorColumns}
                defaultColDef={{ sortable: true, resizable: true }}
                onRowClicked={(e) => {
                  if (groupBy !== 'contributor') return;
                  const id = e.data?.contributorId;
                  if (!id) return;
                  setDrilldownContributor({ id, name: e.data?.contributorName || t('reports.capacityHeatmap.values.contributorFallback') });
                }}
              />
            </Box>
            <Stack direction="row" flexWrap="wrap" sx={{ mt: 1, columnGap: 2, rowGap: 0.5 }}>
              {HEATMAP_LEGEND_BANDS.map((band) => (
                <Stack key={band} direction="row" alignItems="center" spacing={0.75}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: HEATMAP_COLORS[band] }} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {t(`reports.capacityHeatmap.legend.${band}`)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {groupBy === 'contributor' && profileless.count > 0 && (
              <Typography sx={{ mt: 1, fontSize: 12, color: 'text.secondary' }}>
                {t('reports.capacityHeatmap.states.profilelessLoad', {
                  count: profileless.count,
                  days: formatNumberLabel(profileless.days),
                })}
              </Typography>
            )}
            {(isLoading || isFetching) && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('reports.capacityHeatmap.states.loading')}
              </Typography>
            )}
            {!isLoading && rows.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t('reports.capacityHeatmap.states.empty')}
              </Typography>
            )}
          </Box>

          <Box sx={sectionSurfaceSx}>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>{t('reports.capacityHeatmap.sections.unassignedWork')}</Typography>
              <ButtonBase onClick={() => setUnassignedOpen((v) => !v)} sx={{ px: 1, py: 0.5, borderRadius: '5px' }}>
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary' }}>
                  {unassignedOpen ? t('reports.capacityHeatmap.actions.hideDetails') : t('reports.capacityHeatmap.actions.showDetails')}
                </Typography>
              </ButtonBase>
            </Stack>
            <Collapse in={unassignedOpen}>
              <Box sx={{ mt: 2 }}>
                <ReportGrid
                  wrapperSx={{ height: 300 }}
                  rowData={unassigned}
                  columnDefs={unassignedColumns}
                  defaultColDef={{ sortable: true, resizable: true }}
                  onGridReady={(e) => { unassignedGridRef.current = e.api; }}
                />
                {!isLoading && unassigned.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('reports.capacityHeatmap.states.noUnassignedWork')}
                  </Typography>
                )}
              </Box>
            </Collapse>
          </Box>
        </Stack>
      </Box>

      <ContributorDrilldownDialog
        open={Boolean(drilldownContributor)}
        contributorId={drilldownContributor?.id ?? null}
        contributorName={drilldownContributor?.name ?? null}
        statuses={statuses}
        onClose={() => setDrilldownContributor(null)}
      />
    </ReportLayout>
  );
}

function SummaryCard({
  label,
  value,
  helper,
  onClick,
}: {
  label: string;
  value: string;
  helper?: string;
  onClick?: () => void;
}) {
  const content = (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-start' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{label}</Typography>
      <Typography sx={{ fontSize: 18, fontWeight: 500, color: 'kanap.text.primary' }}>{value}</Typography>
      {helper && (
        <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>{helper}</Typography>
      )}
    </Stack>
  );
  return (
    <Box sx={{ ...cardSx, flex: 1, minWidth: 200, p: 0 }}>
      {onClick ? (
        <ButtonBase
          onClick={onClick}
          sx={{ width: '100%', textAlign: 'left', p: 2, alignItems: 'flex-start', borderRadius: '8px' }}
        >
          {content}
        </ButtonBase>
      ) : (
        <Box sx={{ p: 2 }}>
          {content}
        </Box>
      )}
    </Box>
  );
}

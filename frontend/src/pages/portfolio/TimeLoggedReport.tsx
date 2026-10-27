import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Box, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow, Tabs, Typography, useTheme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import ChartCard, { ChartCardHandle } from '../../components/reports/ChartCard';
import { useReportTheme } from '../../components/reports/reportPrint';
import ReportLayout from '../../components/reports/ReportLayout';
import {
  idsFromParams,
  idsParam,
  ProjectFilter,
  TeamFilter,
  useReportFilterValues,
} from '../../components/reports/ProjectTeamFilters';
import { useLocale } from '../../i18n/useLocale';
import { textTabSx, textTabsSx } from '../../theme/formSx';

/* ------------------------------------------------------------------ */
/*  Contract                                                          */
/* ------------------------------------------------------------------ */

/** `totalDays`: the two added, one decimal, computed by the server for the screen and the export alike. */
export type TimeLoggedCell = { month: string; projectDays: number; otherDays: number; totalDays: number };
export type TimeLoggedMember = {
  userId: string | null;
  name: string;
  contributorRef: string | null;
  cells: TimeLoggedCell[];
};
export type TimeLoggedTeam = {
  teamId: string | null;
  teamName: string | null;
  members: TimeLoggedMember[];
  cells: TimeLoggedCell[];
};
export type TimeLoggedReportResponse = {
  months: string[];
  totals: {
    projectDays: number;
    otherDays: number;
    totalDays: number;
    contributorsWithoutEntries: number;
    contributorsTotal: number;
  };
  series: TimeLoggedCell[];
  teams: TimeLoggedTeam[];
};

export const TIME_LOGGED_PERIODS = [6, 12];
export const TIME_LOGGED_MONTHS_STORAGE_KEY = 'kanap.portfolioReports.timeLogged.months';
export const TIME_LOGGED_COLLAPSED_STORAGE_KEY = 'kanap.portfolioReports.timeLogged.collapsed';

/**
 * Series colours, slots 1 and 2 of the data-viz palette stepped per mode, the pair the flow
 * report validated: project time first, the rest second, in both the chart and its legend.
 */
const SERIES_COLORS = {
  light: { project: '#2a78d6', other: '#eb6834' },
  dark: { project: '#3987e5', other: '#d95926' },
} as const;

/* ------------------------------------------------------------------ */
/*  Storage                                                           */
/* ------------------------------------------------------------------ */

const readMonths = (): number => {
  try {
    const stored = Number(window.localStorage.getItem(TIME_LOGGED_MONTHS_STORAGE_KEY));
    if (TIME_LOGGED_PERIODS.includes(stored)) return stored;
  } catch {
    // A browser that refuses storage still gets the default horizon.
  }
  return 6;
};

const storeMonths = (months: number) => {
  try {
    window.localStorage.setItem(TIME_LOGGED_MONTHS_STORAGE_KEY, String(months));
  } catch {
    // Remembering the horizon is a convenience, never a requirement.
  }
};

const readCollapsed = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TIME_LOGGED_COLLAPSED_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
};

const storeCollapsed = (keys: string[]) => {
  try {
    window.localStorage.setItem(TIME_LOGGED_COLLAPSED_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Folded groups are a reading convenience; losing them is harmless.
  }
};

const viewerTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** The key a group is remembered under; the people without a team have no id of their own. */
const teamKey = (team: TimeLoggedTeam) => team.teamId ?? 'no-team';

/* ------------------------------------------------------------------ */
/*  Charter surfaces                                                  */
/* ------------------------------------------------------------------ */

const SECTION_SX = {
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.primary',
  p: 2,
} as const;

const TILE_SX = {
  flex: 1,
  minWidth: 150,
  bgcolor: 'kanap.bg.drawer',
  border: '1px solid',
  borderColor: 'kanap.border.soft',
  borderRadius: '8px',
  px: 2,
  py: 1.25,
} as const;

const cellSx = {
  fontSize: 13,
  fontWeight: 400,
  color: 'kanap.text.primary',
  borderBottom: '1px solid',
  borderColor: 'kanap.border.soft',
  py: 0.5,
} as const;

const headCellSx = {
  fontSize: 11,
  fontWeight: 500,
  color: 'kanap.text.secondary',
  borderBottom: '1px solid',
  borderColor: 'kanap.border.default',
  py: 0.5,
  whiteSpace: 'nowrap',
} as const;

const linkSx = {
  textDecoration: 'none',
  color: 'inherit',
  '&:hover': { textDecoration: 'underline' },
} as const;

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

function StatTile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <Box sx={TILE_SX}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{label}</Typography>
      <Stack direction="row" alignItems="baseline" spacing={0.75}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'kanap.text.primary', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        {caption ? (
          <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>{caption}</Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

/**
 * Where the logged time goes, month after month: project time or the rest, team by team and
 * person by person. It reads a workload, never a ranking: teams keep their configured order,
 * people their alphabetical one, and no figure is ever sorted or compared per person.
 */
export default function TimeLoggedReport() {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const theme = useReportTheme();
  const { hasLevel } = useAuth();
  const dark = theme.palette.mode === 'dark';
  const colors = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;
  const canOpenContributor = hasLevel('portfolio_settings', 'reader');
  const chartRef = useRef<ChartCardHandle | null>(null);

  const [months, setMonths] = useState<number>(readMonths);
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  // Projects and teams can come from a link; unlike the horizon they are never remembered.
  const [searchParams] = useSearchParams();
  const [projectIds, setProjectIds] = useState<string[]>(() => idsFromParams(searchParams, 'projectIds'));
  const [teamIds, setTeamIds] = useState<string[]>(() => idsFromParams(searchParams, 'teamIds'));
  const { data: projectTeamValues } = useReportFilterValues();
  const projectParam = idsParam(projectIds);
  const teamParam = idsParam(teamIds);

  const { data, isError } = useQuery<TimeLoggedReportResponse>({
    queryKey: ['portfolio-time-logged-report', months, projectParam ?? '', teamParam ?? ''],
    queryFn: async () =>
      (
        await api.get<TimeLoggedReportResponse>('/portfolio/reports/time-logged', {
          params: {
            months,
            tz: viewerTimeZone(),
            ...(projectParam ? { projectIds: projectParam } : {}),
            ...(teamParam ? { teamIds: teamParam } : {}),
          },
        })
      ).data,
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
  });

  const changeMonths = (next: number) => {
    setMonths(next);
    storeMonths(next);
  };

  const toggleTeam = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      storeCollapsed(next);
      return next;
    });
  }, []);

  const number = useMemo(
    () => new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }),
    [locale],
  );
  const days = useCallback((value: number) => t('reports.timeLogged.days', { value: number.format(value) }), [number, t]);

  /** A month column label: the short month, plus the year on the first column and on January. */
  const monthLabel = useCallback(
    (month: string, index: number) => {
      const date = new Date(`${month}-01T00:00:00`);
      const short = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
      return index === 0 || month.endsWith('-01') ? `${short} ${month.slice(0, 4)}` : short;
    },
    [locale],
  );

  /* ---------------------------------------------------------------- */
  /*  Chart                                                           */
  /* ---------------------------------------------------------------- */

  const chartOptions = useMemo(() => {
    if (!data) return null;
    const projectName = t('reports.timeLogged.chart.project');
    const otherName = t('reports.timeLogged.chart.other');
    const rows = data.series.map((cell, index) => ({
      label: monthLabel(cell.month, index),
      projectDays: cell.projectDays,
      otherDays: cell.otherDays,
      totalDays: cell.totalDays,
    }));
    const tooltip = {
      renderer: (params: any) => {
        const row = params.datum;
        return {
          title: row.label,
          content: [
            `${projectName}: ${days(row.projectDays)}`,
            `${otherName}: ${days(row.otherDays)}`,
            `${t('reports.timeLogged.tiles.total')}: ${days(row.totalDays)}`,
          ].join('<br/>'),
        };
      },
    };
    // A 2px gap in the surface colour between the two segments of a month.
    const bar = (yKey: 'projectDays' | 'otherDays', name: string, fill: string) => ({
      type: 'bar' as const,
      xKey: 'label',
      yKey,
      yName: name,
      stacked: true,
      fill,
      stroke: theme.palette.background.paper,
      strokeWidth: 2,
      cornerRadius: 4,
      tooltip,
    });
    return {
      theme: dark ? 'ag-default-dark' : 'ag-default',
      background: { fill: 'transparent' },
      data: rows,
      series: [bar('projectDays', projectName, colors.project), bar('otherDays', otherName, colors.other)],
      axes: [
        {
          type: 'category',
          position: 'bottom',
          paddingInner: 0.35,
          label: { color: theme.palette.kanap.text.tertiary, fontSize: 11 },
          line: { stroke: theme.palette.kanap.border.soft },
          gridLine: { enabled: false },
        },
        {
          type: 'number',
          position: 'left',
          label: { color: theme.palette.kanap.text.tertiary, fontSize: 11 },
          line: { enabled: false },
          gridLine: { style: [{ stroke: theme.palette.kanap.border.soft, lineDash: [] }] },
        },
      ],
      legend: {
        enabled: true,
        position: 'bottom' as const,
        item: { label: { color: theme.palette.kanap.text.secondary, fontSize: 11 } },
      },
      padding: { top: 8, right: 12, bottom: 4, left: 16 },
      animation: { enabled: false },
    };
  }, [colors, dark, data, days, monthLabel, t, theme]);

  /* ---------------------------------------------------------------- */
  /*  Exports                                                         */
  /* ---------------------------------------------------------------- */

  const today = new Date().toISOString().slice(0, 10);

  const exportPng = useCallback(() => chartRef.current?.download(`time-logged-${today}`), [today]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  const totals = data?.totals;
  const share =
    totals && totals.totalDays > 0
      ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
          totals.projectDays / (totals.projectDays + totals.otherDays),
        )
      : '–';

  const renderCells = (cells: TimeLoggedCell[], strong: boolean) =>
    cells.map((cell) => {
      const total = cell.totalDays;
      return (
        <TableCell key={cell.month} align="right" sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {total > 0 ? (
            <>
              <Typography component="div" sx={{ fontSize: 13, fontWeight: strong ? 500 : 400, color: 'kanap.text.primary' }}>
                {days(total)}
              </Typography>
              <Typography component="div" sx={{ fontSize: 11, fontWeight: 400, color: 'kanap.text.tertiary' }}>
                {`${number.format(cell.projectDays)} / ${number.format(cell.otherDays)}`}
              </Typography>
            </>
          ) : null}
        </TableCell>
      );
    });

  return (
    <ReportLayout
      title={t('reports.timeLogged.title')}
      subtitle={t('reports.timeLogged.subtitle')}
      tableExport={data ? {
        url: '/portfolio/reports/time-logged/export',
        params: { months, tz: viewerTimeZone(), projectIds: projectParam, teamIds: teamParam },
        fileBase: 'time-logged',
      } : undefined}
      onExportChartPng={data ? exportPng : undefined}
      filters={(
        <>
          {/* Charter: compact text tabs, never a ToggleButtonGroup. */}
          <Tabs
            value={months}
            onChange={(_, value) => { if (value) changeMonths(Number(value)); }}
            aria-label={t('reports.timeLogged.horizon')}
            sx={{ ...textTabsSx, alignSelf: 'flex-end', mb: '6px' }}
          >
            {TIME_LOGGED_PERIODS.map((option) => (
              <Tab
                key={option}
                value={option}
                label={t('reports.timeLogged.monthOption', { count: option })}
                sx={textTabSx(months === option)}
              />
            ))}
          </Tabs>
          <ProjectFilter options={projectTeamValues?.projects ?? []} value={projectIds} onChange={setProjectIds} />
          <TeamFilter options={projectTeamValues?.teams ?? []} value={teamIds} onChange={setTeamIds} />
        </>
      )}
    >
      {isError && <Alert severity="error">{t('reports.timeLogged.loadFailed')}</Alert>}

      {data && totals && chartOptions && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <StatTile label={t('reports.timeLogged.tiles.projectDays')} value={number.format(totals.projectDays)} />
            <StatTile label={t('reports.timeLogged.tiles.otherDays')} value={number.format(totals.otherDays)} />
            <StatTile label={t('reports.timeLogged.tiles.total')} value={number.format(totals.totalDays)} />
            <StatTile label={t('reports.timeLogged.tiles.projectShare')} value={share} />
            <StatTile
              label={t('reports.timeLogged.tiles.withoutEntries', { count: totals.contributorsWithoutEntries })}
              value={String(totals.contributorsWithoutEntries)}
              caption={t('reports.timeLogged.tiles.ofContributors', { count: totals.contributorsTotal })}
            />
          </Stack>

          <ChartCard ref={chartRef} title={t('reports.timeLogged.chart.title')} options={chartOptions} height={300} />

          <Box sx={SECTION_SX}>
            <Typography component="h2" sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
              {t('reports.timeLogged.table.title')}
            </Typography>
            <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary', mb: 1 }}>
              {t('reports.timeLogged.table.hint')}
            </Typography>
            {data.teams.length === 0 ? (
              <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
                {t('reports.timeLogged.empty')}
              </Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headCellSx}>{t('reports.timeLogged.table.team')}</TableCell>
                      {data.months.map((month, index) => (
                        <TableCell key={month} align="right" sx={headCellSx}>
                          {monthLabel(month, index)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.teams.map((team) => {
                      const key = teamKey(team);
                      const isCollapsed = collapsed.includes(key);
                      return (
                        <React.Fragment key={key}>
                          <TableRow data-testid="time-logged-team-row">
                            <TableCell sx={cellSx}>
                              <Box
                                component="button"
                                type="button"
                                aria-expanded={!isCollapsed}
                                onClick={() => toggleTeam(key)}
                                sx={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 0.5,
                                  p: 0,
                                  border: 0,
                                  bgcolor: 'transparent',
                                  color: 'kanap.text.primary',
                                  font: 'inherit',
                                  fontWeight: 500,
                                  cursor: 'pointer',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                <ExpandMoreIcon
                                  sx={{
                                    fontSize: 18,
                                    color: 'kanap.text.secondary',
                                    transform: isCollapsed ? 'rotate(-90deg)' : 'none',
                                    transition: 'transform 160ms ease',
                                  }}
                                />
                                {team.teamName ?? t('reports.timeLogged.noTeam')}
                              </Box>
                            </TableCell>
                            {renderCells(team.cells, true)}
                          </TableRow>
                          {isCollapsed
                            ? null
                            : team.members.map((member) => (
                                <TableRow
                                  key={member.userId ?? 'unknown-user'}
                                  data-testid="time-logged-member-row"
                                  sx={{ '&:hover': { bgcolor: 'kanap.bg.hover' } }}
                                >
                                  <TableCell sx={{ ...cellSx, pl: 4 }}>
                                    <Stack direction="row" spacing={1} alignItems="baseline" sx={{ whiteSpace: 'nowrap' }}>
                                      <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.primary' }}>
                                        {member.userId ? member.name : t('reports.timeLogged.unknownUser')}
                                      </Typography>
                                      {member.contributorRef && canOpenContributor ? (
                                        <Typography
                                          component={RouterLink}
                                          to={`/portfolio/contributors/${member.contributorRef}`}
                                          sx={{
                                            ...linkSx,
                                            fontFamily: MONO,
                                            fontSize: 11,
                                            fontWeight: 400,
                                            color: 'kanap.text.tertiary',
                                            fontVariantNumeric: 'tabular-nums',
                                          }}
                                        >
                                          {member.contributorRef}
                                        </Typography>
                                      ) : null}
                                    </Stack>
                                  </TableCell>
                                  {renderCells(member.cells, false)}
                                </TableRow>
                              ))}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Box>
        </>
      )}
    </ReportLayout>
  );
}

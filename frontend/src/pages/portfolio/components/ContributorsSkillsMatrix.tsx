import React from 'react';
import { Box, Chip, MenuItem, Select, Tooltip, type Theme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { useLocalStorageState } from '../../../hooks/useLocalStorageState';
import { screenLanguage } from '../../../components/csv/readings';
import { downloadXlsxWorkbook, type XlsxCell } from '../../../lib/simpleXlsx';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../../theme/formSx';
import {
  AUTONOMOUS_LEVEL,
  buildSkillsMatrix,
  contributorSummary,
  orientSkillsMatrix,
  type SkillsMatrixAxis,
  type SkillsMatrixOrientation,
} from '../skillsMatrix';
import type { SkillOption, SkillProficiency } from './ContributorSkillsTab';

export type MatrixContributor = {
  id: string;
  item_number: number;
  user_display_name: string;
  user_email: string;
  skills: SkillProficiency[];
  team_id?: string | null;
};

type Props = {
  contributors: MatrixContributor[];
  teams: Array<{ id: string; name: string }>;
  skills: SkillOption[];
  /** Same team filter as the list view: 'all', a team id, or 'unassigned'. */
  filterTeamId: string;
  /** Hands the export to the page so the action can sit in the page header.
   *  Called with null while there is nothing on screen to export. */
  onActionChange?: (action: { label: string; run: () => void } | null) => void;
};

/** Which side of the grid carries the contributors. Catalogues are usually far
 *  longer than the team, so people go across the top by default. */
type Orientation = SkillsMatrixOrientation;

const ORIENTATION_STORAGE_KEY = 'kanap.contributors.matrix.columns';
const SHOW_UNUSED_STORAGE_KEY = 'kanap.contributors.matrix.showUnused';
const CATEGORY_STORAGE_KEY = 'kanap.contributors.matrix.hiddenCategories';

const COLUMN_WIDTH = 30;
const BAND_ROW_HEIGHT = 24;
const COLUMN_HEADER_HEIGHT = 124;
const HEAD_COLUMN_WIDTH = 230;
const SUMMARY_COLUMN_WIDTH = 96;

/** How a per-entry summary is coloured: a gap shouts, a count states, a ratio whispers. */
type SummaryTone = 'gap' | 'count' | 'ratio';

type AxisEntry = {
  id: string;
  label: string;
  /** Set when the entry has a workspace to open. */
  onOpen?: () => void;
  summaryText: string;
  summaryTone: SummaryTone;
  summaryTooltip: string;
  /** Leading cells this entry contributes when it forms the export's rows. */
  exportCells: XlsxCell[];
};

type Axis = {
  kind: 'contributor' | 'skill';
  /** Name of the axis itself, shown above or beside the entry labels. */
  label: string;
  /** Name of the line carrying every entry's summary. */
  summaryLabel: string;
  summaryTooltip: string;
  groups: Array<{ key: string; label: string; entries: AxisEntry[] }>;
  entries: AxisEntry[];
  exportHeaders: string[];
};

const monoSx = {
  fontFamily: MONO_FONT_FAMILY,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
} as const;

const cellSx = {
  ...monoSx,
  textAlign: 'center' as const,
  width: COLUMN_WIDTH,
  minWidth: COLUMN_WIDTH,
  px: 0,
};

/**
 * Read-only grid crossing contributors with skills, one digit 1-4 per cell.
 * Either side can hold the columns; contributors do by default because a skill
 * catalogue is normally the longer of the two. Whichever side holds the rows
 * gets its summaries in a trailing column, the other in the footer line. The
 * skill summary counts who can carry that skill alone, which is the "where are
 * we thin" reading. Editing stays in the contributor workspace. What the grid
 * holds comes from `skillsMatrix.ts`, which the API's export runs too.
 */
export default function ContributorsSkillsMatrix({ contributors, teams, skills, filterTeamId, onActionChange }: Props) {
  const { t, i18n } = useTranslation(['portfolio']);
  const navigate = useNavigate();
  const language = screenLanguage(i18n.resolvedLanguage || i18n.language);
  const [orientation, setOrientation] = useLocalStorageState<Orientation>(ORIENTATION_STORAGE_KEY, 'contributors');
  // Off by default: a catalogue is mostly skills nobody has declared yet, and
  // those columns bury the ones that carry real work.
  const [showUnused, setShowUnused] = useLocalStorageState<boolean>(SHOW_UNUSED_STORAGE_KEY, false);
  const [hiddenCategories, setHiddenCategories] = useLocalStorageState<string[]>(CATEGORY_STORAGE_KEY, []);

  const levelLabels = React.useMemo<Record<number, string>>(() => ({
    1: t('workspace.contributor.proficiency.1'),
    2: t('workspace.contributor.proficiency.2'),
    3: t('workspace.contributor.proficiency.3'),
    4: t('workspace.contributor.proficiency.4'),
  }), [t]);

  // Names ordered in the screen language, as the export orders them (`new Intl.Collator(language)` on the server).
  const compare = React.useMemo(() => new Intl.Collator(language).compare, [language]);

  const matrix = React.useMemo(() => buildSkillsMatrix({
    contributors,
    teams,
    skills,
    teamId: filterTeamId,
    showUnused,
    hiddenCategories,
    words: { unassigned: t('contributors.filters.unassigned'), unknownTeam: t('contributors.teams.unknown') },
    compare,
  }), [compare, contributors, filterTeamId, hiddenCategories, showUnused, skills, t, teams]);

  const { categories } = matrix;

  const contributorAxis = React.useMemo<Axis>(() => {
    const groups = matrix.contributorAxis.groups.map((group) => ({
      key: group.key,
      label: group.label,
      entries: group.entries.map<AxisEntry>((entry) => {
        const { declared, autonomous } = entry.counts;
        const reference = formatItemRef('contributor', entry.itemNumber);
        return {
          id: entry.id,
          label: entry.label,
          onOpen: () => navigate(`${buildItemPath('contributor', reference)}/skills`),
          summaryText: contributorSummary(entry.counts),
          summaryTone: 'ratio',
          summaryTooltip: t('contributors.matrix.summaryTooltip', { autonomous, total: declared }),
          exportCells: [entry.label, reference, entry.teamLabel],
        };
      }),
    }));
    return {
      kind: 'contributor',
      label: t('contributors.matrix.contributorColumn'),
      summaryLabel: t('contributors.matrix.summaryColumn'),
      summaryTooltip: t('contributors.matrix.summaryHeaderTooltip'),
      groups,
      entries: groups.flatMap((group) => group.entries),
      exportHeaders: [
        t('contributors.matrix.export.contributor'),
        t('contributors.matrix.export.reference'),
        t('contributors.matrix.export.team'),
      ],
    };
  }, [matrix, navigate, t]);

  const skillAxis = React.useMemo<Axis>(() => {
    const groups = matrix.skillAxis.groups.map((group) => ({
      key: group.key,
      label: group.label,
      entries: group.entries.map<AxisEntry>((entry) => {
        const { declared, autonomous } = entry.counts;
        return {
          id: entry.id,
          label: entry.label,
          summaryText: String(autonomous),
          summaryTone: autonomous === 0 ? 'gap' : 'count',
          summaryTooltip: t('contributors.matrix.coverageTooltip', { skill: entry.label, autonomous, declared }),
          exportCells: [entry.category, entry.label],
        };
      }),
    }));
    return {
      kind: 'skill',
      label: t('contributors.matrix.skillColumn'),
      summaryLabel: t('contributors.matrix.coverageRow'),
      summaryTooltip: t('contributors.matrix.coverageHeaderTooltip'),
      groups,
      entries: groups.flatMap((group) => group.entries),
      exportHeaders: [t('contributors.matrix.export.category'), t('contributors.matrix.export.skill')],
    };
  }, [matrix, t]);

  const oriented = React.useMemo(() => orientSkillsMatrix(matrix, orientation), [matrix, orientation]);
  const axisOf = (axis: SkillsMatrixAxis) => (axis.kind === 'contributor' ? contributorAxis : skillAxis);
  const columnAxis = axisOf(oriented.columns);
  const rowAxis = axisOf(oriented.rows);
  const levelAt = oriented.levelAt;

  const cellTooltip = React.useCallback((rowEntry: AxisEntry, columnEntry: AxisEntry, level: number) => {
    const contributor = rowAxis.kind === 'contributor' ? rowEntry.label : columnEntry.label;
    const skill = rowAxis.kind === 'contributor' ? columnEntry.label : rowEntry.label;
    return t('contributors.matrix.cellTooltip', { contributor, skill, level: levelLabels[level] });
  }, [levelLabels, rowAxis.kind, t]);

  const summaryColor = (tone: SummaryTone) => (theme: Theme) => {
    if (tone === 'gap') return theme.palette.kanap.orange;
    if (tone === 'count') return theme.palette.kanap.text.primary;
    return theme.palette.kanap.text.tertiary;
  };

  const toggleCategory = (category: string) => {
    setHiddenCategories((prev) => (
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category]
    ));
  };

  const exportXlsx = React.useCallback(() => {
    const pad = Array<XlsxCell>(rowAxis.exportHeaders.length - 1).fill('');
    const header = [
      ...rowAxis.exportHeaders,
      ...columnAxis.entries.map((entry) => entry.label),
      rowAxis.summaryLabel,
    ];
    const rows = rowAxis.entries.map((rowEntry) => [
      ...rowEntry.exportCells,
      ...columnAxis.entries.map((columnEntry) => levelAt(rowEntry.id, columnEntry.id) ?? null),
      rowEntry.summaryText,
    ]);
    const footer = [
      columnAxis.summaryLabel,
      ...pad,
      ...columnAxis.entries.map((entry) => entry.summaryText),
      '',
    ];
    downloadXlsxWorkbook(`skills-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { name: t('contributors.matrix.sheetName'), rows: [header, ...rows, footer] },
    ]);
  }, [columnAxis, levelAt, rowAxis, t]);

  const emptyMessage = matrix.empty ? t(`contributors.matrix.${matrix.empty}`) : null;

  React.useEffect(() => {
    onActionChange?.(emptyMessage ? null : { label: t('contributors.matrix.export.action'), run: exportXlsx });
  }, [emptyMessage, exportXlsx, onActionChange, t]);

  React.useEffect(() => () => onActionChange?.(null), [onActionChange]);

  return (
    // The block is as wide as the grid needs, so the controls keep hugging its
    // right edge instead of stranding Export at the far side of the page.
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', width: 'fit-content', maxWidth: '100%' }}>
      <Box
        role="group"
        aria-label={t('contributors.matrix.filtersLabel')}
        sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', width: '100%' }}
      >
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', mr: '8px' }}>
          <Box component="span" sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
            {t('contributors.matrix.orientation.label')}
          </Box>
          <Select
            variant="standard"
            value={orientation}
            onChange={(event) => setOrientation(event.target.value as Orientation)}
            SelectDisplayProps={{ 'aria-label': t('contributors.matrix.orientation.label') }}
            sx={[drawerSelectSx, inlineControlSx, { width: 'auto', flexShrink: 0 }]}
            MenuProps={compactSelectMenuProps}
          >
            <MenuItem value="contributors" sx={drawerMenuItemSx}>{t('contributors.matrix.orientation.contributors')}</MenuItem>
            <MenuItem value="skills" sx={drawerMenuItemSx}>{t('contributors.matrix.orientation.skills')}</MenuItem>
          </Select>
        </Box>

        {categories.length > 1 && categories.map((category) => {
          const active = !hiddenCategories.includes(category);
          return (
            <Chip
              key={category}
              clickable
              size="small"
              label={category}
              aria-pressed={active}
              color={active ? 'primary' : 'default'}
              variant={active ? 'filled' : 'outlined'}
              onClick={() => toggleCategory(category)}
            />
          );
        })}
        <Box sx={{ flex: 1, minWidth: '8px' }} />
        <Chip
          clickable
          size="small"
          label={t('contributors.matrix.showUnused')}
          aria-pressed={showUnused}
          color={showUnused ? 'primary' : 'default'}
          variant={showUnused ? 'filled' : 'outlined'}
          onClick={() => setShowUnused(!showUnused)}
        />
      </Box>

      {emptyMessage ? (
        <Box sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>{emptyMessage}</Box>
      ) : (
        <Box
          sx={(theme) => ({
            overflow: 'auto',
            width: 'fit-content',
            maxWidth: '100%',
            maxHeight: 'calc(100vh - 250px)',
            border: `1px solid ${theme.palette.kanap.border.default}`,
            borderRadius: '8px',
            bgcolor: theme.palette.kanap.bg.primary,
          })}
        >
          <Box
            component="table"
            sx={(theme) => ({
              borderCollapse: 'separate',
              borderSpacing: 0,
              width: 'max-content',
              '& th, & td': { whiteSpace: 'nowrap', borderBottom: `1px solid ${theme.palette.kanap.border.soft}` },
              '& thead th': {
                position: 'sticky',
                zIndex: 2,
                bgcolor: theme.palette.kanap.bg.page,
                fontWeight: 500,
                fontSize: 12,
                color: theme.palette.kanap.text.tertiary,
              },
              '& thead tr:first-of-type th': { top: 0 },
              '& thead tr:last-of-type th': {
                top: BAND_ROW_HEIGHT,
                borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
              },
              '& thead th:first-of-type': { left: 0, zIndex: 4 },
              '& tbody th': {
                position: 'sticky',
                left: 0,
                zIndex: 1,
                bgcolor: theme.palette.kanap.bg.primary,
                textAlign: 'left',
                fontWeight: 400,
              },
              '& tbody tr.entry:hover td, & tbody tr.entry:focus-visible td': {
                bgcolor: theme.palette.kanap.bg.hover,
              },
              // The head column is frozen, so its highlight has to stay opaque:
              // the hover token is translucent and would let the scrolling
              // columns show through. Compositing it over the surface colour
              // gives the same tint without the bleed-through.
              '& tbody tr.entry:hover th, & tbody tr.entry:focus-visible th': {
                backgroundColor: theme.palette.kanap.bg.primary,
                backgroundImage: `linear-gradient(${theme.palette.kanap.bg.hover}, ${theme.palette.kanap.bg.hover})`,
              },
              '& tbody tr.entry': { outline: 'none' },
              '& tbody tr.openable': { cursor: 'pointer' },
              '& tbody tr.openable:focus-visible th': {
                boxShadow: `inset 2px 0 0 ${theme.palette.primary.main}`,
              },
              '& tfoot th, & tfoot td': {
                position: 'sticky',
                bottom: 0,
                zIndex: 2,
                bgcolor: theme.palette.kanap.bg.page,
                borderTop: `1px solid ${theme.palette.kanap.border.default}`,
                borderBottom: 0,
              },
              '& tfoot th': { left: 0, zIndex: 3, textAlign: 'left', fontWeight: 500 },
            })}
          >
            <thead>
              <tr>
                <Box component="th" sx={{ height: BAND_ROW_HEIGHT, minWidth: HEAD_COLUMN_WIDTH, px: '12px' }} />
                {columnAxis.groups.map((group) => (
                  <Tooltip key={group.key} title={group.label} placement="top" enterDelay={400}>
                    <Box
                      component="th"
                      colSpan={group.entries.length}
                      sx={(theme) => ({
                        height: BAND_ROW_HEIGHT,
                        textAlign: 'left',
                        px: '6px',
                        maxWidth: group.entries.length * COLUMN_WIDTH,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        borderLeft: `1px solid ${theme.palette.kanap.border.default}`,
                      })}
                    >
                      {group.label}
                    </Box>
                  </Tooltip>
                ))}
                <Box component="th" sx={{ height: BAND_ROW_HEIGHT, minWidth: SUMMARY_COLUMN_WIDTH }} />
              </tr>
              <tr>
                <Box component="th" scope="col" sx={{ px: '12px', verticalAlign: 'bottom', pb: '8px', textAlign: 'left' }}>
                  {rowAxis.label}
                </Box>
                {columnAxis.groups.map((group) => group.entries.map((entry, index) => (
                  <Tooltip key={entry.id} title={entry.label} placement="top" enterDelay={400}>
                    <Box
                      component="th"
                      scope="col"
                      sx={(theme) => ({
                        ...cellSx,
                        height: COLUMN_HEADER_HEIGHT,
                        verticalAlign: 'bottom',
                        pb: '8px',
                        fontFamily: 'inherit',
                        borderLeft: index === 0 ? `1px solid ${theme.palette.kanap.border.default}` : undefined,
                      })}
                    >
                      <Box
                        component={entry.onOpen ? 'button' : 'span'}
                        type={entry.onOpen ? 'button' : undefined}
                        onClick={entry.onOpen}
                        sx={(theme) => ({
                          display: 'inline-block',
                          writingMode: 'vertical-rl',
                          transform: 'rotate(180deg)',
                          maxHeight: COLUMN_HEADER_HEIGHT - 16,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          lineHeight: 1.2,
                          font: 'inherit',
                          fontWeight: 400,
                          color: 'inherit',
                          ...(entry.onOpen ? {
                            p: 0,
                            border: 0,
                            background: 'none',
                            cursor: 'pointer',
                            '&:hover': { color: theme.palette.kanap.text.primary },
                            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: '1px' },
                          } : {}),
                        })}
                      >
                        {entry.label}
                      </Box>
                    </Box>
                  </Tooltip>
                )))}
                <Tooltip title={rowAxis.summaryTooltip} placement="top" enterDelay={400}>
                  <Box
                    component="th"
                    scope="col"
                    sx={{
                      px: '12px',
                      minWidth: SUMMARY_COLUMN_WIDTH,
                      maxWidth: SUMMARY_COLUMN_WIDTH,
                      verticalAlign: 'bottom',
                      pb: '8px',
                      textAlign: 'right',
                      '&&': { whiteSpace: 'normal' },
                      lineHeight: 1.3,
                    }}
                  >
                    {rowAxis.summaryLabel}
                  </Box>
                </Tooltip>
              </tr>
            </thead>
            <tbody>
              {rowAxis.groups.map((group) => (
                <React.Fragment key={group.key}>
                  <tr>
                    <Box
                      component="td"
                      colSpan={columnAxis.entries.length + 2}
                      sx={(theme) => ({ p: 0, bgcolor: theme.palette.kanap.bg.page })}
                    >
                      {/* The cell spans the whole table; the label sticks so the group stays readable while scrolling sideways. */}
                      <Box
                        component="span"
                        sx={(theme) => ({
                          position: 'sticky',
                          left: 0,
                          display: 'inline-block',
                          px: '12px',
                          py: '6px',
                          fontSize: 12,
                          fontWeight: 500,
                          color: theme.palette.kanap.text.tertiary,
                        })}
                      >
                        {group.label}
                      </Box>
                    </Box>
                  </tr>
                  {group.entries.map((rowEntry) => (
                    <tr
                      key={rowEntry.id}
                      className={rowEntry.onOpen ? 'entry openable' : 'entry'}
                      aria-label={rowEntry.label}
                      tabIndex={rowEntry.onOpen ? 0 : undefined}
                      onClick={rowEntry.onOpen}
                      onKeyDown={rowEntry.onOpen && ((event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          rowEntry.onOpen?.();
                        }
                      })}
                    >
                      <Box
                        component="th"
                        scope="row"
                        sx={(theme) => ({
                          px: '12px',
                          height: 30,
                          fontSize: 13,
                          color: theme.palette.kanap.text.primary,
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        })}
                      >
                        {rowEntry.label}
                      </Box>
                      {columnAxis.groups.map((group2) => group2.entries.map((columnEntry, index) => {
                        const level = levelAt(rowEntry.id, columnEntry.id);
                        const cell = (
                          <Box
                            component="td"
                            sx={(theme) => ({
                              ...cellSx,
                              color: level && level >= AUTONOMOUS_LEVEL
                                ? theme.palette.kanap.text.primary
                                : theme.palette.kanap.text.tertiary,
                              borderLeft: index === 0 ? `1px solid ${theme.palette.kanap.border.default}` : undefined,
                            })}
                          >
                            {level ?? ''}
                          </Box>
                        );
                        if (!level) return <React.Fragment key={columnEntry.id}>{cell}</React.Fragment>;
                        return (
                          <Tooltip
                            key={columnEntry.id}
                            title={cellTooltip(rowEntry, columnEntry, level)}
                            placement="top"
                            enterDelay={400}
                          >
                            {cell}
                          </Tooltip>
                        );
                      }))}
                      <Tooltip title={rowEntry.summaryTooltip} placement="top" enterDelay={400}>
                        <Box
                          component="td"
                          data-thin={rowEntry.summaryTone === 'gap' ? 'true' : undefined}
                          sx={(theme) => ({
                            ...monoSx,
                            minWidth: SUMMARY_COLUMN_WIDTH,
                            px: '12px',
                            textAlign: 'right',
                            fontWeight: rowEntry.summaryTone === 'ratio' ? 400 : 500,
                            color: summaryColor(rowEntry.summaryTone)(theme),
                          })}
                        >
                          {rowEntry.summaryText}
                        </Box>
                      </Tooltip>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <Box component="th" scope="row" sx={{ px: '12px', height: 30, fontSize: 12 }}>
                  {columnAxis.summaryLabel}
                </Box>
                {columnAxis.groups.map((group) => group.entries.map((entry, index) => (
                  <Tooltip key={entry.id} title={entry.summaryTooltip} placement="top" enterDelay={400}>
                    <Box
                      component="td"
                      data-thin={entry.summaryTone === 'gap' ? 'true' : undefined}
                      sx={(theme) => ({
                        ...cellSx,
                        fontWeight: entry.summaryTone === 'ratio' ? 400 : 500,
                        color: summaryColor(entry.summaryTone)(theme),
                        borderLeft: index === 0 ? `1px solid ${theme.palette.kanap.border.default}` : undefined,
                      })}
                    >
                      {entry.summaryText}
                    </Box>
                  </Tooltip>
                )))}
                <Box component="td" sx={{ minWidth: SUMMARY_COLUMN_WIDTH }} />
              </tr>
            </tfoot>
          </Box>
        </Box>
      )}
    </Box>
  );
}

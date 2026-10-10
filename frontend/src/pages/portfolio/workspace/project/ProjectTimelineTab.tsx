import React from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  ListItemText,
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
} from '@mui/material';
import { tableCellTextFieldSx } from '../../../../theme/formSx';
import type { SxProps, Theme } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import EventIcon from '@mui/icons-material/Event';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import LinkIcon from '@mui/icons-material/Link';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import api from '../../../../api';
import { KanapDialog, StatusDot } from '../../../../components/design';
import { useTheme } from '@mui/material/styles';
import DateEUField from '../../../../components/fields/DateEUField';
import DateCalendarPopover from '../../../../components/fields/DateCalendarPopover';
import { getApiErrorMessage } from '../../../../utils/apiErrorMessage';
import { useLocale } from '../../../../i18n/useLocale';
import {
  getMilestoneStatusLabel,
  getPhaseStatusLabel,
  getTaskStatusLabel,
  getTaskStatusOptions,
} from '../../../../utils/portfolioI18n';
import { getDotColor, TASK_STATUS_COLORS } from '../../../../utils/statusColors';
import { computePhaseAnomalies, type PhaseAnomaly } from '../../../../utils/phaseAnomalies';
import { formatItemRef } from '../../../../utils/item-ref';
import { ProjectTimeline } from '../../components/ProjectTimeline';
import { useDoneRequiresTime } from '../../../tasks/hooks/useDoneRequiresTime';

type ProjectTimelineTabProps = {
  canManage: boolean;
  form: any;
  projectId: string;
  onError: (message: string) => void;
  onNavigateToTask: (path: string) => void;
  onRefetch: () => Promise<unknown>;
  onSetForm: React.Dispatch<React.SetStateAction<any>>;
  onUpdate: (patch: any) => void;
};

type SortablePhaseRowProps = {
  canManage: boolean;
  milestones: any[];
  onError: (message: string) => void;
  onNavigateToTask: (path: string) => void;
  onRefetch: () => Promise<unknown>;
  onSetForm: React.Dispatch<React.SetStateAction<any>>;
  phase: any;
  projectId: string;
  index: number;
  tasks: any[];
  expanded: boolean;
  onToggleExpand: () => void;
  onTaskUpdate: (taskId: string, patch: Record<string, any>) => void;
  anomalies: PhaseAnomaly[];
  onLinkExistingTask: () => void;
};

const PHASE_TABLE_COLUMN_COUNT = 8;

// Expanded task rows: Name | Assignee | Start | End | Status.
// Left offset (index 56 + chevron 64) and right reserve (milestone 80 + actions 50)
// indent these columns under the phase-table content.
const TASK_SUBROW_GRID = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 140px 140px 140px 130px',
  alignItems: 'center',
  columnGap: 2,
} as const;

function getDateVariance(planned: string | null, baseline: string | null): number | null {
  if (!planned || !baseline) return null;
  const [plannedYear, plannedMonth, plannedDay] = getDatePart(planned).split('-').map(Number);
  const [baselineYear, baselineMonth, baselineDay] = getDatePart(baseline).split('-').map(Number);
  if (!plannedYear || !plannedMonth || !plannedDay || !baselineYear || !baselineMonth || !baselineDay) return null;
  const plannedTime = Date.UTC(plannedYear, plannedMonth - 1, plannedDay);
  const baselineTime = Date.UTC(baselineYear, baselineMonth - 1, baselineDay);
  return Math.round((plannedTime - baselineTime) / (1000 * 60 * 60 * 24));
}

function getDatePart(value: string | null | undefined): string {
  if (!value) return '';
  return value.includes('T') ? value.split('T')[0] : value;
}

function formatShortDate(value: string | null | undefined, locale: string): string {
  const datePart = getDatePart(value);
  if (!datePart) return '–';
  const [yearText, monthText, dayText] = datePart.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) return '–';

  const date = new Date(year, month - 1, day);
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const dayPart = parts.find((part) => part.type === 'day')?.value;
  const monthPart = parts.find((part) => part.type === 'month')?.value;
  const yearPart = parts.find((part) => part.type === 'year')?.value;

  return [dayPart, monthPart, yearPart].filter(Boolean).join(' ') || '–';
}

function formatCompactVariance(diff: number | null): { days: number; tone: 'late' | 'early' } | null {
  if (diff == null || diff === 0) return null;
  return {
    days: Math.abs(diff),
    tone: diff > 0 ? 'late' : 'early',
  };
}

function getPhaseStatusColorName(status: string): string {
  if (status === 'completed') return 'success';
  if (status === 'in_progress') return 'info';
  if (status === 'pending') return 'warning';
  return 'default';
}

function PhaseStatusValue({ status }: { status: string }) {
  const { t } = useTranslation(['portfolio']);
  const theme = useTheme();

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
      <StatusDot size={7} color={getDotColor(getPhaseStatusColorName(status), theme.palette.mode)} />
      <Box component="span" sx={(theme) => ({ fontSize: 13, fontWeight: 400, color: theme.palette.kanap.text.primary })}>
        {getPhaseStatusLabel(t, status)}
      </Box>
    </Box>
  );
}

function TaskStatusValue({ status }: { status: string }) {
  const { t } = useTranslation(['portfolio']);
  const colorName = TASK_STATUS_COLORS[status] || 'default';
  const theme = useTheme();

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: '7px', minWidth: 0 }}>
      <StatusDot size={7} color={getDotColor(colorName, theme.palette.mode)} />
      <Box component="span" sx={(theme) => ({ fontSize: 13, fontWeight: 400, color: theme.palette.kanap.text.primary })}>
        {getTaskStatusLabel(t, status)}
      </Box>
    </Box>
  );
}

const ANOMALY_MESSAGE_KEYS: Record<PhaseAnomaly['code'], { key: string; fallback: string }> = {
  phase_completed_with_open_tasks: {
    key: 'workspace.project.timeline.anomalies.completedWithOpenTasks',
    fallback: 'Phase marked complete but some tasks are still open.',
  },
  phase_end_before_task_end: {
    key: 'workspace.project.timeline.anomalies.endBeforeTaskEnd',
    fallback: 'A linked task is due after the phase end date.',
  },
  phase_overdue: {
    key: 'workspace.project.timeline.anomalies.overdue',
    fallback: 'The phase end date has passed but it is not complete.',
  },
};

function PhaseAnomalyIndicator({ anomalies }: { anomalies: PhaseAnomaly[] }) {
  const { t } = useTranslation(['portfolio']);
  if (!anomalies.length) return null;

  const hasError = anomalies.some((anomaly) => anomaly.severity === 'error');
  const Icon = hasError ? ErrorOutlineIcon : WarningAmberIcon;
  const colorKey = hasError ? 'error.main' : 'warning.main';

  return (
    <Tooltip
      title={(
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {anomalies.map((anomaly) => (
            <span key={anomaly.code}>
              {t(ANOMALY_MESSAGE_KEYS[anomaly.code].key, { defaultValue: ANOMALY_MESSAGE_KEYS[anomaly.code].fallback })}
            </span>
          ))}
        </Box>
      )}
    >
      <Icon sx={{ fontSize: 18, color: colorKey, flexShrink: 0 }} />
    </Tooltip>
  );
}

function AssigneeName({ name }: { name: string | null }) {
  if (!name) {
    return (
      <Box component="span" sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary })}>—</Box>
    );
  }
  return (
    <Tooltip title={name}>
      <Box
        component="span"
        sx={(theme) => ({
          minWidth: 0,
          fontSize: 13,
          color: theme.palette.kanap.text.primary,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        })}
      >
        {name}
      </Box>
    </Tooltip>
  );
}

function CompactPhaseDateField({
  disabled,
  locale,
  onChangeYmd,
  valueYmd,
}: {
  disabled?: boolean;
  locale: string;
  onChangeYmd: (next: string) => void;
  valueYmd?: string | null;
}) {
  const { t } = useTranslation(['common']);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [calendarAnchor, setCalendarAnchor] = React.useState<HTMLElement | null>(null);
  const [focused, setFocused] = React.useState(false);
  const normalizedYmd = getDatePart(valueYmd);

  // The calendar hangs from the field's input box.
  const openPicker = () => {
    if (disabled) return;
    setCalendarAnchor(rootRef.current?.querySelector<HTMLElement>('.MuiInputBase-root') ?? null);
  };

  return (
    <Box
      ref={rootRef}
      className="kanap-phase-date-field"
      sx={{
        position: 'relative',
        '&:hover .kanap-phase-calendar-button': {
          opacity: disabled ? 0 : 1,
        },
      }}
    >
      <TextField
        value={formatShortDate(valueYmd, locale)}
        disabled={disabled}
        fullWidth
        onClick={openPicker}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openPicker();
          }
        }}
        inputProps={{ readOnly: true }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                className="kanap-phase-calendar-button"
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  openPicker();
                }}
                aria-label={t('common:labels.openCalendar')}
                tabIndex={-1}
                disabled={disabled}
                sx={{
                  opacity: focused && !disabled ? 1 : 0,
                  transition: 'opacity 0.15s',
                  p: '2px',
                }}
              >
                <EventIcon sx={{ fontSize: 15 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
        sx={[tableCellTextFieldSx, (theme) => ({
          '& .MuiInputBase-root': {
            color: theme.palette.kanap.text.primary,
            fontFamily: theme.typography.fontFamily,
            fontSize: 13,
            fontWeight: 400,
            cursor: disabled ? 'default' : 'pointer',
          },
          '& .MuiInputBase-input': {
            p: '0 !important',
            height: 20,
            fontFamily: theme.typography.fontFamily,
            fontSize: 13,
            fontWeight: 400,
            cursor: disabled ? 'default' : 'pointer',
          },
          '& .MuiInputAdornment-root': {
            m: 0,
          },
        })]}
      />
      <DateCalendarPopover
        anchorEl={calendarAnchor}
        open={!!calendarAnchor}
        valueYmd={normalizedYmd}
        onSelect={onChangeYmd}
        onClose={() => setCalendarAnchor(null)}
        allowClear
      />
    </Box>
  );
}

const sectionSx: SxProps<Theme> = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
};

const sectionHeadSx: SxProps<Theme> = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
};

const sectionTitleSx: SxProps<Theme> = (theme) => ({
  fontSize: 14,
  fontWeight: 500,
  lineHeight: 1.4,
  color: theme.palette.kanap.text.primary,
});

const linkTealButtonSx: SxProps<Theme> = (theme) => ({
  minWidth: 0,
  height: 'auto',
  p: 0,
  color: theme.palette.kanap.teal,
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.4,
  '&:hover': {
    bgcolor: 'transparent',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
});

const phaseTableSx: SxProps<Theme> = (theme) => ({
  '& .MuiTableCell-head': {
    fontSize: 12,
    fontWeight: 500,
    color: theme.palette.kanap.text.tertiary,
    textAlign: 'left',
    p: '5px 8px',
    borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
  },
  '& .MuiTableCell-body': {
    fontSize: 13,
    fontWeight: 400,
    color: theme.palette.kanap.text.primary,
    p: '6px 8px',
    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
    verticalAlign: 'middle',
  },
  // Expanded per-phase task row owns its own padding via the inner box.
  '& .kanap-phase-tasks-row .MuiTableCell-body': {
    p: 0,
  },
  '& .kanap-phase-row:hover .MuiTableCell-body': {
    bgcolor: theme.palette.action.hover,
  },
  '& .kanap-phase-row:focus-within .phase-row-actions, & .kanap-phase-row:hover .phase-row-actions': {
    opacity: 1,
  },
  '& .phase-row-actions': {
    opacity: 0,
    transition: 'opacity 0.15s',
  },
  '& .kanap-phase-index': {
    fontSize: 12,
    fontWeight: 400,
    color: theme.palette.kanap.text.tertiary,
  },
  '& .kanap-phase-index svg': {
    color: theme.palette.kanap.text.tertiary,
    fontSize: 15,
  },
  '& .MuiInputBase-input': {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: 400,
    color: theme.palette.kanap.text.primary,
  },
  '& .MuiInputBase-input.Mui-disabled, & .MuiInputBase-root.Mui-disabled .MuiSelect-select': {
    WebkitTextFillColor: theme.palette.kanap.text.primary,
    color: theme.palette.kanap.text.primary,
  },
  '& .MuiInput-root:before, & .MuiInput-root:hover:not(.Mui-disabled):before, & .MuiInput-root:after': {
    borderBottom: 0,
  },
  '& .MuiSelect-select': {
    display: 'flex',
    alignItems: 'center',
    // Reserve room on the right so the value text never slides under the caret.
    padding: '0 22px 0 0 !important',
    minHeight: '20px !important',
    overflow: 'hidden',
  },
  '& .MuiSelect-icon': {
    color: theme.palette.kanap.text.tertiary,
    fontSize: 18,
  },
});

// Milestone table: naked inputs (no underline) + dense cells, matching the design charter.
const milestoneTableSx: SxProps<Theme> = (theme) => ({
  '& .MuiTableCell-head': {
    fontSize: 12,
    fontWeight: 500,
    color: theme.palette.kanap.text.tertiary,
    textAlign: 'left',
    p: '5px 8px',
    borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
  },
  '& .MuiTableCell-body': {
    fontSize: 13,
    fontWeight: 400,
    color: theme.palette.kanap.text.primary,
    p: '6px 8px',
    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
    verticalAlign: 'middle',
  },
  '& .MuiInputBase-input': {
    fontFamily: theme.typography.fontFamily,
    fontSize: 13,
    fontWeight: 400,
    color: theme.palette.kanap.text.primary,
  },
  '& .MuiInputBase-input.Mui-disabled, & .MuiInputBase-root.Mui-disabled .MuiSelect-select': {
    WebkitTextFillColor: theme.palette.kanap.text.primary,
    color: theme.palette.kanap.text.primary,
  },
  '& .MuiInput-root:before, & .MuiInput-root:hover:not(.Mui-disabled):before, & .MuiInput-root:after': {
    borderBottom: 0,
  },
  '& .MuiSelect-select': {
    display: 'flex',
    alignItems: 'center',
    p: '0 !important',
    minHeight: '20px !important',
  },
  '& .MuiSelect-icon': {
    color: theme.palette.kanap.text.tertiary,
    fontSize: 18,
  },
});

const timelineTableSx: SxProps<Theme> = (theme) => ({
  width: '100%',
  borderCollapse: 'collapse',
  '& .MuiTableCell-head': {
    fontSize: 12,
    fontWeight: 500,
    color: theme.palette.kanap.text.tertiary,
    textAlign: 'left',
    p: '6px 12px 6px 0',
    borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
  },
  '& .MuiTableCell-body': {
    fontSize: 13,
    p: '8px 12px 8px 0',
    borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
    verticalAlign: 'baseline',
  },
  '& .kanap-tl-label': {
    fontSize: 12,
    fontWeight: 500,
    color: theme.palette.kanap.text.tertiary,
    cursor: 'help',
    borderBottom: `1px dotted ${theme.palette.kanap.text.tertiary}`,
  },
  '& .kanap-tl-sublabel': {
    fontSize: 11,
    fontWeight: 400,
    color: theme.palette.kanap.text.tertiary,
    ml: '6px',
  },
  '& .kanap-tl-value': {
    color: theme.palette.kanap.text.primary,
  },
  '& .kanap-tl-variance': {
    whiteSpace: 'nowrap',
  },
  '& .kanap-tl-sep': {
    color: theme.palette.kanap.text.tertiary,
    mx: '6px',
  },
  '& .kanap-bl-late': {
    color: theme.palette.kanap.danger,
    fontSize: 12,
  },
  '& .kanap-bl-early': {
    color: getDotColor('success', theme.palette.mode),
    fontSize: 12,
  },
});

function SortablePhaseRow({
  canManage,
  milestones,
  onError,
  onNavigateToTask,
  onRefetch,
  onSetForm,
  phase,
  projectId,
  index,
  tasks,
  expanded,
  onToggleExpand,
  onTaskUpdate,
  anomalies,
  onLinkExistingTask,
}: SortablePhaseRowProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const locale = useLocale();
  const [addMenuAnchor, setAddMenuAnchor] = React.useState<null | HTMLElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: phase.id, disabled: !canManage });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    backgroundColor: isDragging ? 'rgba(25, 118, 210, 0.08)' : undefined,
  };

  const taskCount = tasks.length;

  return (
    <>
      <TableRow ref={setNodeRef} style={style} className="kanap-phase-row">
        <TableCell className="kanap-phase-index" sx={{ width: 56, px: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {canManage && (
              <Box
                component="span"
                className="kanap-phase-drag-handle"
                sx={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none' }}
                {...attributes}
                {...listeners}
              >
                <DragIndicatorIcon />
              </Box>
            )}
            <span>{index + 1}</span>
          </Box>
        </TableCell>
        <TableCell className="kanap-phase-expand" sx={{ width: 64, px: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
            <IconButton
              size="small"
              aria-label={expanded
                ? t('workspace.project.timeline.actions.collapsePhase', { defaultValue: 'Hide tasks' })
                : t('workspace.project.timeline.actions.expandPhase', { defaultValue: 'Show tasks' })}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
              sx={{ p: '2px' }}
            >
              {expanded ? <KeyboardArrowDownIcon sx={{ fontSize: 18 }} /> : <KeyboardArrowRightIcon sx={{ fontSize: 18 }} />}
            </IconButton>
            {taskCount > 0 && (
              <Box
                component="span"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpand();
                }}
                title={t('workspace.project.timeline.actions.expandPhase', { defaultValue: 'Show tasks' })}
                sx={(theme) => ({
                  minWidth: 18,
                  height: 18,
                  px: '5px',
                  borderRadius: '9px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 500,
                  lineHeight: 1,
                  color: theme.palette.kanap.text.secondary,
                  bgcolor: theme.palette.kanap.bg.hover,
                })}
              >
                {taskCount}
              </Box>
            )}
          </Box>
        </TableCell>
      <TableCell>
        <TextField
          size="small"
          value={phase.name}
          fullWidth
          disabled={!canManage}
          onChange={(event) => {
            const nextName = event.target.value;
            onSetForm((prev: any) => ({
              ...prev,
              phases: (prev?.phases || []).map((current: any) =>
                current.id === phase.id ? { ...current, name: nextName } : current
              ),
            }));
          }}
          onBlur={async () => {
            try {
              await api.patch(`/portfolio/projects/${projectId}/phases/${phase.id}`, { name: phase.name });
              await onRefetch();
            } catch (error: any) {
              onError(
                getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
              );
            }
          }}
        />
      </TableCell>
      <TableCell>
        <CompactPhaseDateField
          valueYmd={phase.planned_start || ''}
          locale={locale}
          disabled={!canManage}
          onChangeYmd={async (value) => {
            onSetForm((prev: any) => ({
              ...prev,
              phases: (prev?.phases || []).map((current: any) =>
                current.id === phase.id ? { ...current, planned_start: value } : current
              ),
            }));
            try {
              await api.patch(`/portfolio/projects/${projectId}/phases/${phase.id}`, { planned_start: value || null });
              await onRefetch();
            } catch (error: any) {
              onError(
                getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
              );
            }
          }}
        />
      </TableCell>
      <TableCell>
        <CompactPhaseDateField
          valueYmd={phase.planned_end || ''}
          locale={locale}
          disabled={!canManage}
          onChangeYmd={async (value) => {
            onSetForm((prev: any) => ({
              ...prev,
              phases: (prev?.phases || []).map((current: any) =>
                current.id === phase.id ? { ...current, planned_end: value } : current
              ),
            }));
            try {
              await api.patch(`/portfolio/projects/${projectId}/phases/${phase.id}`, { planned_end: value || null });
              await onRefetch();
            } catch (error: any) {
              onError(
                getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
              );
            }
          }}
        />
      </TableCell>
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Select
            size="small"
            value={phase.status || 'pending'}
            fullWidth
            disabled={!canManage}
            renderValue={(value) => <PhaseStatusValue status={String(value)} />}
            onChange={async (event) => {
              const nextStatus = event.target.value;
              onSetForm((prev: any) => ({
                ...prev,
                phases: (prev?.phases || []).map((current: any) =>
                  current.id === phase.id ? { ...current, status: nextStatus } : current
                ),
              }));
              try {
                await api.patch(`/portfolio/projects/${projectId}/phases/${phase.id}`, { status: nextStatus });
                await onRefetch();
              } catch (error: any) {
                onError(
                  getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
                );
              }
            }}
            sx={[tableCellTextFieldSx, { flex: 1, minWidth: 0 }]}
          >
            <MenuItem value="pending"><PhaseStatusValue status="pending" /></MenuItem>
            <MenuItem value="in_progress"><PhaseStatusValue status="in_progress" /></MenuItem>
            <MenuItem value="completed"><PhaseStatusValue status="completed" /></MenuItem>
          </Select>
          <PhaseAnomalyIndicator anomalies={anomalies} />
        </Box>
      </TableCell>
      <TableCell sx={{ textAlign: 'center' }}>
        <Checkbox
          size="small"
          checked={!!milestones.find((milestone: any) => milestone.phase_id === phase.id)}
          disabled={!canManage}
          onChange={async (event) => {
            try {
              await api.post(`/portfolio/projects/${projectId}/phases/${phase.id}/toggle-milestone`, {
                enabled: event.target.checked,
                milestone_name: t('workspace.project.timeline.defaults.phaseComplete', { phase: phase.name }),
              });
              await onRefetch();
            } catch (error: any) {
              onError(
                getApiErrorMessage(error, t, t('workspace.project.timeline.messages.toggleMilestoneFailed')),
              );
            }
          }}
        />
      </TableCell>
      <TableCell>
        <Stack className="phase-row-actions" direction="row" spacing={0}>
          <IconButton
            size="small"
            disabled={!canManage}
            title={t('workspace.project.timeline.actions.addTaskToPhase')}
            onClick={(event) => setAddMenuAnchor(event.currentTarget)}
          >
            <AddIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={addMenuAnchor}
            open={Boolean(addMenuAnchor)}
            onClose={() => setAddMenuAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem
              onClick={() => {
                setAddMenuAnchor(null);
                onNavigateToTask(`/portfolio/tasks/new/overview?projectId=${projectId}&phaseId=${phase.id}`);
              }}
            >
              <ListItemIcon><NoteAddIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('workspace.project.timeline.actions.newTaskInPhase', { defaultValue: 'New task' })}</ListItemText>
            </MenuItem>
            <MenuItem
              onClick={() => {
                setAddMenuAnchor(null);
                onLinkExistingTask();
              }}
            >
              <ListItemIcon><LinkIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('workspace.project.timeline.actions.linkExistingTask', { defaultValue: 'Link existing task' })}</ListItemText>
            </MenuItem>
          </Menu>
          <IconButton
            size="small"
            disabled={!canManage}
            title={t('workspace.project.timeline.actions.deletePhase')}
            onClick={async () => {
              try {
                await api.delete(`/portfolio/projects/${projectId}/phases/${phase.id}`);
                await onRefetch();
              } catch (error: any) {
                onError(
                  getApiErrorMessage(error, t, t('workspace.project.timeline.messages.deletePhaseFailed')),
                );
              }
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
          </Stack>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="kanap-phase-tasks-row">
          <TableCell colSpan={PHASE_TABLE_COLUMN_COUNT} sx={{ p: 0 }}>
            <Box sx={(theme) => ({ pl: '120px', pr: '130px', py: 1, bgcolor: theme.palette.kanap.bg.hover })}>
              {taskCount === 0 ? (
                <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary, m: 0 })}>
                  {t('workspace.project.timeline.states.noPhaseTasks', { defaultValue: 'No tasks in this phase.' })}
                </Typography>
              ) : (
                <Box>
                  <Box
                    sx={(theme) => ({
                      ...TASK_SUBROW_GRID,
                      pb: '4px',
                      mb: '2px',
                      borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
                      fontSize: 12,
                      fontWeight: 500,
                      color: theme.palette.kanap.text.tertiary,
                    })}
                  >
                    <span />
                    <span>{t('workspace.project.timeline.fields.assignee', { defaultValue: 'Assignee' })}</span>
                    <span>{t('workspace.project.timeline.fields.start')}</span>
                    <span>{t('workspace.project.timeline.fields.end')}</span>
                    <span>{t('workspace.project.fields.status')}</span>
                  </Box>
                  {tasks.map((task: any) => (
                    <Box
                      key={task.id}
                      sx={(theme) => ({
                        ...TASK_SUBROW_GRID,
                        py: '5px',
                        borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
                        '&:last-of-type': { borderBottom: 0 },
                      })}
                    >
                      <Box
                        component="a"
                        href={`/portfolio/tasks/${task.item_number ? formatItemRef('task', task.item_number) : task.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        sx={(theme) => ({
                          minWidth: 0,
                          fontSize: 13,
                          color: theme.palette.kanap.text.primary,
                          cursor: 'pointer',
                          textDecoration: 'none',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          '&:hover': { textDecoration: 'underline' },
                        })}
                      >
                        {task.title}
                      </Box>
                      <AssigneeName name={task.assignee_name || null} />
                      <CompactPhaseDateField
                        valueYmd={task.start_date || ''}
                        locale={locale}
                        disabled={!canManage}
                        onChangeYmd={(value) => onTaskUpdate(task.id, { start_date: value || null })}
                      />
                      <CompactPhaseDateField
                        valueYmd={task.due_date || ''}
                        locale={locale}
                        disabled={!canManage}
                        onChangeYmd={(value) => onTaskUpdate(task.id, { due_date: value || null })}
                      />
                      <Select
                        size="small"
                        value={task.status || 'open'}
                        fullWidth
                        variant="standard"
                        disabled={!canManage}
                        renderValue={(value) => <TaskStatusValue status={String(value)} />}
                        onChange={(event) => onTaskUpdate(task.id, { status: String(event.target.value) })}
                        sx={[tableCellTextFieldSx, {
                          fontSize: 13,
                          '& .MuiSelect-select': { minHeight: '20px !important', display: 'flex', alignItems: 'center', overflow: 'hidden' },
                        }]}
                      >
                        {getTaskStatusOptions(t).map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            <TaskStatusValue status={option.value} />
                          </MenuItem>
                        ))}
                      </Select>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function ProjectTimelineTab({
  canManage,
  form,
  projectId,
  onError,
  onNavigateToTask,
  onRefetch,
  onSetForm,
}: ProjectTimelineTabProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const locale = useLocale();
  const [phaseTemplates, setPhaseTemplates] = React.useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState('');
  const [replaceConfirmOpen, setReplaceConfirmOpen] = React.useState(false);
  const [expandedPhases, setExpandedPhases] = React.useState<Set<string>>(() => new Set());
  const [linkDialogPhase, setLinkDialogPhase] = React.useState<any | null>(null);
  const [linkTaskValue, setLinkTaskValue] = React.useState<any | null>(null);

  React.useEffect(() => {
    api.get('/portfolio/phase-templates')
      .then((res) => {
        setPhaseTemplates(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {});
  }, []);

  const { data: projectTasks = [], refetch: refetchTasks } = useQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: async () => {
      const res = await api.get<any[]>(`/portfolio/projects/${projectId}/tasks`);
      return res.data;
    },
    enabled: !!projectId,
  });

  const doneGuard = useDoneRequiresTime();

  const tasksByPhase = React.useMemo(() => {
    const map = new Map<string, any[]>();
    (projectTasks || []).forEach((task: any) => {
      if (!task.phase_id) return;
      const list = map.get(task.phase_id) || [];
      list.push(task);
      map.set(task.phase_id, list);
    });
    return map;
  }, [projectTasks]);

  const sortedPhases = React.useMemo(
    () => [...(form?.phases || [])].sort((a: any, b: any) => a.sequence - b.sequence),
    [form?.phases],
  );

  const todayYmd = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

  const anomaliesByPhase = React.useMemo(() => {
    const map = new Map<string, PhaseAnomaly[]>();
    sortedPhases.forEach((phase: any) => {
      map.set(phase.id, computePhaseAnomalies(phase, tasksByPhase.get(phase.id) || [], todayYmd));
    });
    return map;
  }, [sortedPhases, tasksByPhase, todayYmd]);

  const phaseNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    (form?.phases || []).forEach((phase: any) => map.set(phase.id, phase.name));
    return map;
  }, [form?.phases]);

  const linkTaskOptions = React.useMemo(
    () => (projectTasks || []).filter((task: any) => task.phase_id !== linkDialogPhase?.id),
    [projectTasks, linkDialogPhase],
  );

  const allExpanded = sortedPhases.length > 0 && sortedPhases.every((phase: any) => expandedPhases.has(phase.id));

  const toggleExpandAll = React.useCallback(() => {
    setExpandedPhases((prev) => {
      const everyExpanded = sortedPhases.length > 0 && sortedPhases.every((phase: any) => prev.has(phase.id));
      return everyExpanded ? new Set<string>() : new Set<string>(sortedPhases.map((phase: any) => phase.id));
    });
  }, [sortedPhases]);

  const toggleExpandPhase = React.useCallback((phaseId: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  }, []);

  const applyTaskUpdate = React.useCallback(async (taskId: string, patch: Record<string, any>) => {
    try {
      await api.patch(`/portfolio/projects/${projectId}/tasks/${taskId}`, patch);
      await refetchTasks();
    } catch (error: any) {
      onError(
        getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updateTaskFailed', { defaultValue: 'Failed to update task.' })),
      );
    }
  }, [projectId, refetchTasks, onError, t]);

  // "Done" on a project task requires logged time: intercept and open the Log Time dialog.
  const handleTaskUpdate = React.useCallback((taskId: string, patch: Record<string, any>) => {
    void doneGuard.runWithGuard({
      taskId,
      projectId,
      isProjectTask: true,
      nextStatus: patch.status,
      apply: () => applyTaskUpdate(taskId, patch),
    });
  }, [doneGuard.runWithGuard, projectId, applyTaskUpdate]);

  const handleConfirmLinkTask = React.useCallback(async () => {
    if (!linkDialogPhase || !linkTaskValue) return;
    const targetPhaseId = linkDialogPhase.id;
    await handleTaskUpdate(linkTaskValue.id, { phase_id: targetPhaseId });
    setExpandedPhases((prev) => new Set(prev).add(targetPhaseId));
    setLinkDialogPhase(null);
    setLinkTaskValue(null);
  }, [linkDialogPhase, linkTaskValue, handleTaskUpdate]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handlePhaseDragEnd = React.useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const sortedPhases = [...(form?.phases || [])].sort((a: any, b: any) => a.sequence - b.sequence);
    const oldIndex = sortedPhases.findIndex((phase: any) => phase.id === active.id);
    const newIndex = sortedPhases.findIndex((phase: any) => phase.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedPhases, oldIndex, newIndex).map((phase: any, index: number) => ({
      ...phase,
      sequence: index,
    }));
    onSetForm((prev: any) => ({ ...prev, phases: reordered }));

    try {
      await api.post(`/portfolio/projects/${projectId}/phases/reorder`, {
        phase_ids: reordered.map((phase: any) => phase.id),
      });
    } catch (error: any) {
      await onRefetch();
      onError(
        getApiErrorMessage(error, t, t('workspace.project.timeline.messages.reorderPhasesFailed')),
      );
    }
  }, [form?.phases, onError, onRefetch, onSetForm, projectId, t]);

  const baselineStartVariance = getDateVariance(form?.planned_start, form?.baseline_start_date);
  const baselineEndVariance = getDateVariance(form?.planned_end, form?.baseline_end_date);
  const baselineStartDisplay = formatCompactVariance(baselineStartVariance);
  const baselineEndDisplay = formatCompactVariance(baselineEndVariance);
  const hasBaseline = !!(form?.baseline_start_date || form?.baseline_end_date);

  return (
    <Stack spacing={3}>
      {(form?.phases?.length || 0) === 0 ? (
        <Box className="kanap-section" sx={sectionSx}>
          <Box className="kanap-section-head" sx={sectionHeadSx}>
            <Typography className="kanap-section-title" sx={sectionTitleSx}>
              {t('workspace.project.timeline.sections.phases')}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="center">
            <Select
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              displayEmpty
              size="small"
              sx={{ minWidth: 250 }}
            >
              <MenuItem value="" disabled>{t('workspace.project.timeline.states.selectTemplate')}</MenuItem>
              {phaseTemplates.map((template) => (
                <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>
              ))}
            </Select>
            <Button
              variant="contained"
              disabled={!selectedTemplateId || !canManage}
              onClick={async () => {
                if (!selectedTemplateId) return;
                try {
                  await api.post(`/portfolio/projects/${projectId}/apply-template`, { template_id: selectedTemplateId });
                  await onRefetch();
                  setSelectedTemplateId('');
                } catch (error: any) {
                  onError(
                    getApiErrorMessage(error, t, t('workspace.project.timeline.messages.applyTemplateFailed')),
                  );
                }
              }}
            >
              {t('workspace.project.timeline.actions.applyTemplate')}
            </Button>
          </Stack>
        </Box>
      ) : (
        <Box className="kanap-section" sx={sectionSx}>
          <Box className="kanap-section-head" sx={sectionHeadSx}>
            <Typography className="kanap-section-title" sx={sectionTitleSx}>
              {t('workspace.project.timeline.sections.phases')}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                startIcon={<AddIcon />}
                disabled={!canManage}
                onClick={async () => {
                  try {
                    await api.post(`/portfolio/projects/${projectId}/phases`, {
                      name: t('workspace.project.timeline.defaults.newPhase'),
                    });
                    await onRefetch();
                  } catch (error: any) {
                    onError(
                      getApiErrorMessage(error, t, t('workspace.project.timeline.messages.addPhaseFailed')),
                    );
                  }
                }}
              >
                {t('workspace.project.timeline.actions.addPhase')}
              </Button>
              <Button
                size="small"
                color="warning"
                disabled={!canManage}
                onClick={() => setReplaceConfirmOpen(true)}
              >
                {t('workspace.project.timeline.actions.replaceWithTemplate')}
              </Button>
            </Stack>
          </Box>
          <ProjectTimeline
            projectId={projectId}
            phases={(form?.phases || []).map((phase: any) => ({
              id: phase.id,
              name: phase.name,
              planned_start: phase.planned_start,
              planned_end: phase.planned_end,
              status: phase.status || 'pending',
              sequence: phase.sequence,
            }))}
            milestones={form?.milestones || []}
            onUpdate={onRefetch}
            canManage={canManage}
            tableView={(
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handlePhaseDragEnd}
              >
                <Table className="kanap-phases-table" size="small" sx={phaseTableSx}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 56 }}>#</TableCell>
                      <TableCell sx={{ width: 64, px: 0.5 }}>
                        <Tooltip
                          title={allExpanded
                            ? t('workspace.project.timeline.actions.collapseAll', { defaultValue: 'Collapse all' })
                            : t('workspace.project.timeline.actions.expandAll', { defaultValue: 'Expand all' })}
                        >
                          <IconButton
                            size="small"
                            aria-label={allExpanded
                              ? t('workspace.project.timeline.actions.collapseAll', { defaultValue: 'Collapse all' })
                              : t('workspace.project.timeline.actions.expandAll', { defaultValue: 'Expand all' })}
                            onClick={toggleExpandAll}
                            sx={{ p: '2px' }}
                          >
                            {allExpanded ? <UnfoldLessIcon sx={{ fontSize: 18 }} /> : <UnfoldMoreIcon sx={{ fontSize: 18 }} />}
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{t('workspace.project.timeline.fields.name')}</TableCell>
                      <TableCell sx={{ width: 140 }}>{t('workspace.project.timeline.fields.start')}</TableCell>
                      <TableCell sx={{ width: 140 }}>{t('workspace.project.timeline.fields.end')}</TableCell>
                      <TableCell sx={{ width: 130 }}>{t('workspace.project.fields.status')}</TableCell>
                      <TableCell sx={{ width: 80, textAlign: 'center' }}>
                        {t('workspace.project.timeline.fields.milestone')}
                      </TableCell>
                      <TableCell sx={{ width: 50 }} />
                    </TableRow>
                  </TableHead>
                  <SortableContext
                    items={sortedPhases.map((phase: any) => phase.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <TableBody>
                      {sortedPhases.map((phase: any, index: number) => (
                        <SortablePhaseRow
                          key={phase.id}
                          canManage={canManage}
                          milestones={form?.milestones || []}
                          onError={onError}
                          onNavigateToTask={onNavigateToTask}
                          onRefetch={onRefetch}
                          onSetForm={onSetForm}
                          phase={phase}
                          projectId={projectId}
                          index={index}
                          tasks={tasksByPhase.get(phase.id) || []}
                          expanded={expandedPhases.has(phase.id)}
                          onToggleExpand={() => toggleExpandPhase(phase.id)}
                          onTaskUpdate={handleTaskUpdate}
                          anomalies={anomaliesByPhase.get(phase.id) || []}
                          onLinkExistingTask={() => { setLinkTaskValue(null); setLinkDialogPhase(phase); }}
                        />
                      ))}
                    </TableBody>
                  </SortableContext>
                </Table>
              </DndContext>
            )}
          />
        </Box>
      )}

      <Divider />
      <Box className="kanap-section" sx={sectionSx}>
        <Box className="kanap-section-head" sx={sectionHeadSx}>
          <Typography className="kanap-section-title" sx={sectionTitleSx}>
            {t('workspace.project.timeline.sections.milestones')}
          </Typography>
          <Button
            className="kanap-link-teal"
            sx={linkTealButtonSx}
            disabled={!canManage}
            onClick={async () => {
              try {
                await api.post(`/portfolio/projects/${projectId}/milestones`, {
                  name: t('workspace.project.timeline.defaults.newMilestone'),
                });
                await onRefetch();
              } catch (error: any) {
                onError(
                  getApiErrorMessage(error, t, t('workspace.project.timeline.messages.addMilestoneFailed')),
                );
              }
            }}
          >
            {`+ ${t('workspace.project.timeline.actions.addMilestone')}`}
          </Button>
        </Box>
        {(form?.milestones?.length || 0) === 0 ? (
          <Typography className="kanap-empty-state" sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary, m: 0 })}>
            {t('workspace.project.timeline.states.noMilestones')}
          </Typography>
        ) : (
          <Table size="small" sx={milestoneTableSx}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: '32%' }}>{t('workspace.project.timeline.fields.name')}</TableCell>
                <TableCell sx={{ width: '26%' }}>{t('workspace.project.fields.phase')}</TableCell>
                <TableCell sx={{ width: 168 }}>{t('workspace.project.timeline.fields.targetDate')}</TableCell>
                <TableCell sx={{ width: 130 }}>{t('workspace.project.fields.status')}</TableCell>
                <TableCell sx={{ width: 50 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {(form?.milestones || []).map((milestone: any) => {
                const linkedPhase = (form?.phases || []).find((phase: any) => phase.id === milestone.phase_id);
                return (
                  <TableRow key={milestone.id}>
                    <TableCell>
                      <TextField
                        size="small"
                        variant="standard"
                        value={milestone.name}
                        fullWidth
                        disabled={!canManage}
                        sx={tableCellTextFieldSx}
                        onChange={(event) => {
                          const nextName = event.target.value;
                          onSetForm((prev: any) => ({
                            ...prev,
                            milestones: (prev?.milestones || []).map((current: any) =>
                              current.id === milestone.id ? { ...current, name: nextName } : current
                            ),
                          }));
                        }}
                        onBlur={async () => {
                          try {
                            await api.patch(`/portfolio/projects/${projectId}/milestones/${milestone.id}`, { name: milestone.name });
                            await onRefetch();
                          } catch (error: any) {
                            onError(
                              getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updateMilestoneFailed')),
                            );
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color={linkedPhase ? 'text.primary' : 'text.secondary'}>
                        {linkedPhase ? linkedPhase.name : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <DateEUField
                        valueYmd={milestone.target_date || ''}
                        label=""
                        sx={{ minWidth: 150 }}
                        textFieldSx={[tableCellTextFieldSx, {
                          '& .MuiInputBase-input': { minWidth: 78 },
                          '& .MuiInputAdornment-root': { ml: 0 },
                          '& .MuiButtonBase-root': { p: '2px' },
                          '& .MuiButtonBase-root .MuiSvgIcon-root': { fontSize: 16 },
                        }]}
                        disabled={!canManage || !!linkedPhase}
                        onChangeYmd={async (value) => {
                          onSetForm((prev: any) => ({
                            ...prev,
                            milestones: (prev?.milestones || []).map((current: any) =>
                              current.id === milestone.id ? { ...current, target_date: value } : current
                            ),
                          }));
                          try {
                            await api.patch(`/portfolio/projects/${projectId}/milestones/${milestone.id}`, { target_date: value || null });
                            await onRefetch();
                          } catch (error: any) {
                            onError(
                              getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updateMilestoneFailed')),
                            );
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        variant="standard"
                        value={milestone.status || 'pending'}
                        fullWidth
                        disabled={!canManage}
                        sx={tableCellTextFieldSx}
                        onChange={async (event) => {
                          const nextStatus = event.target.value;
                          onSetForm((prev: any) => ({
                            ...prev,
                            milestones: (prev?.milestones || []).map((current: any) =>
                              current.id === milestone.id ? { ...current, status: nextStatus } : current
                            ),
                          }));
                          try {
                            await api.patch(`/portfolio/projects/${projectId}/milestones/${milestone.id}`, { status: nextStatus });
                            await onRefetch();
                          } catch (error: any) {
                            onError(
                              getApiErrorMessage(error, t, t('workspace.project.timeline.messages.updateMilestoneFailed')),
                            );
                          }
                        }}
                      >
                        <MenuItem value="pending">{getMilestoneStatusLabel(t, 'pending')}</MenuItem>
                        <MenuItem value="achieved">{getMilestoneStatusLabel(t, 'achieved')}</MenuItem>
                        <MenuItem value="missed">{getMilestoneStatusLabel(t, 'missed')}</MenuItem>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        disabled={!canManage || !!linkedPhase}
                        title={linkedPhase ? t('workspace.project.timeline.messages.unlinkPhaseMilestoneFirst') : undefined}
                        onClick={async () => {
                          try {
                            await api.delete(`/portfolio/projects/${projectId}/milestones/${milestone.id}`);
                            await onRefetch();
                          } catch (error: any) {
                            onError(
                              getApiErrorMessage(error, t, t('workspace.project.timeline.messages.deleteMilestoneFailed')),
                            );
                          }
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Box>

      <Divider />
      <Box className="kanap-section" sx={sectionSx}>
        <Box className="kanap-section-head" sx={sectionHeadSx}>
          <Typography className="kanap-section-title" sx={sectionTitleSx}>
            {t('workspace.project.timeline.summary.title')}
          </Typography>
        </Box>

        <Table className="kanap-timeline-table" size="small" sx={timelineTableSx}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 100 }} />
              <TableCell>{t('workspace.project.timeline.fields.start')}</TableCell>
              <TableCell>{t('workspace.project.timeline.fields.end')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>
                <Tooltip title={t('workspace.project.timeline.summary.actualTooltip')}>
                  <Box component="span" className="kanap-tl-label">{t('workspace.project.timeline.summary.actual')}</Box>
                </Tooltip>
              </TableCell>
              <TableCell className="kanap-tl-value">
                {formatShortDate(form?.actual_start, locale)}
              </TableCell>
              <TableCell className="kanap-tl-value">
                {formatShortDate(form?.actual_end, locale)}
              </TableCell>
              <TableCell />
            </TableRow>
            <TableRow>
              <TableCell>
                <Tooltip title={t('workspace.project.timeline.summary.plannedTooltip')}>
                  <Box component="span" className="kanap-tl-label">{t('workspace.project.timeline.summary.planned')}</Box>
                </Tooltip>
              </TableCell>
              <TableCell className="kanap-tl-value">
                {formatShortDate(form?.planned_start, locale)}
              </TableCell>
              <TableCell className="kanap-tl-value">
                {formatShortDate(form?.planned_end, locale)}
              </TableCell>
              <TableCell />
            </TableRow>
            {hasBaseline && (
              <TableRow>
                <TableCell>
                  <Tooltip title={t('workspace.project.timeline.summary.baselineTooltip')}>
                    <Box component="span" className="kanap-tl-label">
                      {t('workspace.project.timeline.summary.baseline')}
                      <Box component="span" className="kanap-tl-sublabel">
                        {t('workspace.project.timeline.summary.baselineAt')}
                      </Box>
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell className="kanap-tl-value">
                  {formatShortDate(form?.baseline_start_date, locale)}
                </TableCell>
                <TableCell className="kanap-tl-value">
                  {formatShortDate(form?.baseline_end_date, locale)}
                </TableCell>
                <TableCell className="kanap-tl-variance">
                  {baselineStartDisplay && (
                    <Box
                      component="span"
                      className={baselineStartDisplay.tone === 'late' ? 'kanap-bl-late' : 'kanap-bl-early'}
                    >
                      {t(
                        baselineStartDisplay.tone === 'late'
                          ? 'workspace.project.timeline.summary.varianceLate'
                          : 'workspace.project.timeline.summary.varianceEarly',
                        { days: baselineStartDisplay.days },
                      )}
                    </Box>
                  )}
                  {baselineStartDisplay && baselineEndDisplay && (
                    <Box component="span" className="kanap-tl-sep">·</Box>
                  )}
                  {baselineEndDisplay && (
                    <Box
                      component="span"
                      className={baselineEndDisplay.tone === 'late' ? 'kanap-bl-late' : 'kanap-bl-early'}
                    >
                      {t(
                        baselineEndDisplay.tone === 'late'
                          ? 'workspace.project.timeline.summary.varianceLate'
                          : 'workspace.project.timeline.summary.varianceEarly',
                        { days: baselineEndDisplay.days },
                      )}
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>

      <KanapDialog
        open={replaceConfirmOpen}
        title={t('workspace.project.timeline.dialogs.replaceAll.title')}
        onClose={() => setReplaceConfirmOpen(false)}
        saveLabel={t('workspace.project.timeline.actions.replaceAll')}
        saveVariant="action-danger"
        saveDisabled={!selectedTemplateId}
        cancelLabel={t('common:buttons.cancel')}
        onSave={async () => {
          if (!selectedTemplateId) return;
          try {
            await api.post(`/portfolio/projects/${projectId}/apply-template`, {
              template_id: selectedTemplateId,
              replace: true,
            });
            await onRefetch();
            setSelectedTemplateId('');
            setReplaceConfirmOpen(false);
          } catch (error: any) {
            onError(
              getApiErrorMessage(error, t, t('workspace.project.timeline.messages.applyTemplateFailed')),
            );
          }
        }}
      >
        <Typography sx={{ fontSize: 13.5, color: 'kanap.text.primary', mb: 2 }}>
          {t('workspace.project.timeline.dialogs.replaceAll.description')}
        </Typography>
        <Select
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          displayEmpty
          fullWidth
          size="small"
        >
          <MenuItem value="" disabled>{t('workspace.project.timeline.states.selectTemplate')}</MenuItem>
          {phaseTemplates.map((template) => (
            <MenuItem key={template.id} value={template.id}>{template.name}</MenuItem>
          ))}
        </Select>
      </KanapDialog>

      <Dialog
        open={Boolean(linkDialogPhase)}
        onClose={() => setLinkDialogPhase(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          {t('workspace.project.timeline.dialogs.linkTask.title', { defaultValue: 'Link an existing task' })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {t('workspace.project.timeline.dialogs.linkTask.description', {
              phase: linkDialogPhase?.name || '',
              defaultValue: 'Attach an existing project task to phase "{{phase}}".',
            })}
          </DialogContentText>
          <Autocomplete
            options={linkTaskOptions}
            value={linkTaskValue}
            onChange={(_, value) => setLinkTaskValue(value)}
            getOptionLabel={(option) => option?.title || ''}
            isOptionEqualToValue={(option, value) => option.id === value?.id}
            renderOption={(props, option) => {
              const { key, ...optionProps } = props as any;
              return (
              <Box
                component="li"
                key={key ?? option.id}
                {...optionProps}
                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', gap: '2px' }}
              >
                <Box sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.primary })}>{option.title}</Box>
                <Box sx={(theme) => ({ fontSize: 11, color: theme.palette.kanap.text.tertiary })}>
                  {option.phase_id
                    ? t('workspace.project.timeline.dialogs.linkTask.currentPhase', {
                      phase: phaseNameById.get(option.phase_id) || '—',
                      defaultValue: 'Phase: {{phase}}',
                    })
                    : t('workspace.project.timeline.dialogs.linkTask.noPhase', { defaultValue: 'No phase' })}
                </Box>
              </Box>
              );
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                autoFocus
                placeholder={t('workspace.project.timeline.dialogs.linkTask.placeholder', { defaultValue: 'Search tasks' })}
              />
            )}
            noOptionsText={t('workspace.project.timeline.dialogs.linkTask.empty', { defaultValue: 'No tasks available' })}
          />
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={() => setLinkDialogPhase(null)}>
            {t('common:buttons.cancel')}
          </Button>
          <Button
            variant="action-primary"
            disabled={!linkTaskValue}
            onClick={handleConfirmLinkTask}
          >
            {t('workspace.project.timeline.actions.link', { defaultValue: 'Link' })}
          </Button>
        </DialogActions>
      </Dialog>

      {doneGuard.dialog}
    </Stack>
  );
}

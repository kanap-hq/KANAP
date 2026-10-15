import React from 'react';
import {
  Box,
  Menu,
  MenuItem,
  Popover,
  Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { taskDetailTokens, taskDetailTypography, metaItemClickableSx, metaLabelSx, STATUS_DOT_COLORS, PRIORITY_DOT_COLORS, getScoreColor } from '../theme/taskDetailTokens';
import type { PriorityLevel } from '../theme/taskDetailTokens';
import type { TaskStatus } from '../task.constants';
import { TASK_STATUS_OPTIONS } from '../task.constants';
import { getTaskStatusLabel, getPriorityLabel } from '../../../utils/portfolioI18n';
import DateEUField from '../../../components/fields/DateEUField';
import { formatShortDate } from '../../../lib/dateFormat';
import { useLocale } from '../../../i18n/useLocale';
import MetadataUserPicker from '../../../components/workspace/MetadataUserPicker';
import { StatusDot } from '../../../components/design';

interface TaskMetadataBarProps {
  status: TaskStatus;
  priorityLevel: PriorityLevel;
  priorityScore: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  readOnly?: boolean;
  isProjectTask?: boolean;
  onPatch: (patch: Record<string, any>) => void;
  projectId?: string | null;
  projectName?: string | null;
  onNavigateToProject?: (projectId: string) => void;
}


/* ================================================================== */
/*  StatusChip                                                        */
/* ================================================================== */

function StatusChip({ status, readOnly, onPatch }: { status: TaskStatus; readOnly?: boolean; onPatch: (p: Record<string, any>) => void }) {
  const { t } = useTranslation('portfolio');
  const theme = useTheme();
  const mode = theme.palette.mode;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const color = STATUS_DOT_COLORS[status]?.[mode] ?? STATUS_DOT_COLORS.open[mode];

  return (
    <>
      <Box
        sx={{ ...metaItemClickableSx, color: theme.palette.kanap.text.primary, ...(readOnly && { cursor: 'default' }) }}
        onClick={readOnly ? undefined : (e) => setAnchor(e.currentTarget)}
      >
        <StatusDot color={color} size={8} />
        <span>{getTaskStatusLabel(t, status)}</span>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {TASK_STATUS_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={opt.value === status}
            onClick={() => { onPatch({ status: opt.value }); setAnchor(null); }}
            sx={{ gap: '8px', fontSize: 13 }}
          >
            <StatusDot color={STATUS_DOT_COLORS[opt.value]?.[mode]} size={8} />
            {getTaskStatusLabel(t, opt.value)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/* ================================================================== */
/*  PriorityChip                                                      */
/* ================================================================== */

const PRIORITY_OPTIONS: PriorityLevel[] = ['blocker', 'high', 'normal', 'low', 'optional'];

function PriorityChip({ priority, readOnly, onPatch }: { priority: PriorityLevel; readOnly?: boolean; onPatch: (p: Record<string, any>) => void }) {
  const { t } = useTranslation('portfolio');
  const theme = useTheme();
  const mode = theme.palette.mode;
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  return (
    <>
      <Box
        sx={{ ...metaItemClickableSx, color: theme.palette.kanap.text.primary, ...(readOnly && { cursor: 'default' }) }}
        onClick={readOnly ? undefined : (e) => setAnchor(e.currentTarget)}
      >
        <Box component="span" sx={{ ...metaLabelSx, color: theme.palette.kanap.text.tertiary }}>
          {t('workspace.task.priority.taskPriority')}
        </Box>
        <span>{getPriorityLabel(t, priority)}</span>
      </Box>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {PRIORITY_OPTIONS.map((p) => (
          <MenuItem
            key={p}
            selected={p === priority}
            onClick={() => { onPatch({ priority_level: p }); setAnchor(null); }}
            sx={{ gap: '8px', fontSize: 13 }}
          >
            <StatusDot color={PRIORITY_DOT_COLORS[p]?.[mode]} size={8} />
            {getPriorityLabel(t, p)}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/* ================================================================== */
/*  ScoreChip                                                         */
/* ================================================================== */

function ScoreChip({ score, isProjectTask }: { score: number; isProjectTask?: boolean }) {
  const { t } = useTranslation('portfolio');
  const theme = useTheme();
  const mode = theme.palette.mode;

  if (!isProjectTask || score == null) return null;

  const color = getScoreColor(score, mode);

  return (
    <Tooltip title={t('workspace.task.priority.projectPriorityTitle')} arrow>
      <Box sx={{ ...metaItemClickableSx, cursor: 'default', color: theme.palette.kanap.text.primary }}>
        <StatusDot color={color} size={8} />
        <Box component="span" sx={{ ...metaLabelSx, color: theme.palette.kanap.text.tertiary }}>
          {t('workspace.task.priority.projectPriority')}
        </Box>
        <Box component="span" sx={{ ...taskDetailTypography.scoreValue }}>
          {Math.round(score)}
        </Box>
      </Box>
    </Tooltip>
  );
}

/* ================================================================== */
/*  DueDateChip                                                       */
/* ================================================================== */

function toYmdOnly(value: string | null): string {
  if (!value) return '';
  if (value.includes('T')) return value.split('T')[0];
  return value;
}

function DueDateChip({ dueDate, readOnly, onPatch }: { dueDate: string | null; readOnly?: boolean; onPatch: (p: Record<string, any>) => void }) {
  const { t } = useTranslation('portfolio');
  const theme = useTheme();
  const locale = useLocale();
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  return (
    <>
      <Box
        sx={{ ...metaItemClickableSx, color: theme.palette.kanap.text.primary, ...(readOnly && { cursor: 'default' }) }}
        onClick={readOnly ? undefined : (e) => setAnchor(e.currentTarget)}
      >
        <Box component="span" sx={{ ...metaLabelSx, color: theme.palette.kanap.text.tertiary }}>
          {t('workspace.task.sidebar.fields.dueDate')}
        </Box>
        <span>{formatShortDate(dueDate, locale, { empty: 'Not set' })}</span>
      </Box>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 1.5, width: 220 } } }}
      >
        <DateEUField
          label={t('workspace.task.sidebar.fields.dueDate')}
          valueYmd={toYmdOnly(dueDate)}
          onChangeYmd={(v) => { onPatch({ due_date: v || null }); setAnchor(null); }}
          size="small"
        />
      </Popover>
    </>
  );
}

/* ================================================================== */
/*  TaskMetadataBar                                                   */
/* ================================================================== */

export default function TaskMetadataBar({
  status,
  priorityLevel,
  priorityScore,
  assigneeUserId,
  assigneeName,
  dueDate,
  readOnly,
  isProjectTask,
  onPatch,
  projectId,
  projectName,
  onNavigateToProject,
}: TaskMetadataBarProps) {
  const theme = useTheme();
  const { t } = useTranslation('portfolio');

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: taskDetailTokens.metadataBar.gap,
        flexWrap: 'wrap',
        fontSize: '12px',
      }}
    >
      <StatusChip status={status} readOnly={readOnly} onPatch={onPatch} />
      <ScoreChip score={priorityScore} isProjectTask={isProjectTask} />
      <PriorityChip priority={priorityLevel} readOnly={readOnly} onPatch={onPatch} />
      <MetadataUserPicker
        value={assigneeUserId}
        displayName={assigneeName}
        placeholder={t('workspace.task.sidebar.values.assigneeMissing')}
        searchPlaceholder={t('workspace.task.sidebar.fields.assignee')}
        disabled={readOnly}
        onChange={(nextUserId) => onPatch({ assignee_user_id: nextUserId })}
      />
      <DueDateChip dueDate={dueDate} readOnly={readOnly} onPatch={onPatch} />

      {/* Project chip — clickable link to project workspace */}
      {isProjectTask && projectId && projectName && onNavigateToProject && (
        <Box
          component="a"
          href={`/portfolio/projects/${projectId}`}
          onClick={(e: React.MouseEvent) => { e.preventDefault(); onNavigateToProject(projectId); }}
          title={projectName}
          sx={{
            ...metaItemClickableSx,
            textDecoration: 'none',
            color: theme.palette.kanap.text.primary,
            '&:hover .kanap-meta-project-name': {
              textDecoration: 'underline',
              textDecorationThickness: '1px',
              textUnderlineOffset: '2px',
            },
            '&:hover .kanap-meta-arrow': {
              color: theme.palette.kanap.text.secondary,
            },
          }}
        >
          <Box component="span" sx={{ ...metaLabelSx, color: theme.palette.kanap.text.tertiary }}>
            {t('context.project')}
          </Box>
          <Box
            component="span"
            className="kanap-meta-project-name"
            sx={{
              maxWidth: 150,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {projectName}
          </Box>
          <Box
            component="span"
            className="kanap-meta-arrow"
            sx={{
              color: theme.palette.kanap.text.tertiary,
              fontSize: '11px',
              ml: '2px',
              transition: 'color 0.15s',
            }}
          >
            ↗
          </Box>
        </Box>
      )}
    </Box>
  );
}

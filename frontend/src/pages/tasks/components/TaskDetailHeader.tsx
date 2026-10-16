import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { taskDetailTokens, taskDetailTypography } from '../theme/taskDetailTokens';
import type { TaskStatus } from '../task.constants';
import type { PriorityLevel } from '../theme/taskDetailTokens';
import TaskNavChip from './TaskNavChip';
import TaskMetadataBar from './TaskMetadataBar';
import SendLinkButton from '../../../components/workspace/SendLinkButton';
import type { TaskCrumb } from '../taskWorkspaceOrigin';

function isModifiedClick(event: React.MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

interface TaskDetailHeaderProps {
  // Task data
  taskId: string;
  itemNumber: number | null;
  title: string;
  status: TaskStatus;
  priorityLevel: PriorityLevel;
  priorityScore: number;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  isProjectTask: boolean;
  hasConvertedRequest: boolean;
  projectId?: string | null;
  projectName?: string | null;
  onNavigateToProject?: (projectId: string) => void;

  // Navigation
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;

  // Actions
  onClose: () => void;
  onConvertToRequest: () => void;
  onDelete: () => void;
  onTitleChange: (newTitle: string) => void;
  onTitleSave: (newTitle: string) => void;
  onMetadataPatch: (patch: Record<string, any>) => void;

  // State
  canManage: boolean;
  canDelete: boolean;
  canConvertToRequest: boolean;
  convertDisabledTitle?: string;

  // Breadcrumb
  crumbs: TaskCrumb[];
  onOriginClick: () => void;
  onParentClick: (href: string) => void;
}

/* ------------------------------------------------------------------ */
/*  EditableTitle                                                      */
/* ------------------------------------------------------------------ */

function EditableTitle({
  value,
  canEdit,
  onChange,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
}) {
  const { t } = useTranslation('portfolio');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  if (!canEdit) {
    return (
      <Typography component="span" sx={{ ...taskDetailTypography.title, display: 'inline' }}>
        {value || t('workspace.task.title.untitled')}
      </Typography>
    );
  }

  if (!editing) {
    return (
      <Typography
        component="span"
        onClick={() => { setDraft(value); setEditing(true); }}
        sx={{ ...taskDetailTypography.title, display: 'inline', cursor: 'text', '&:hover': { opacity: 0.8 } }}
      >
        {value || t('workspace.task.title.untitled')}
      </Typography>
    );
  }

  return (
    <Box
      component="input"
      value={draft}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        if (trimmed && trimmed !== value) { onChange(trimmed); onSave(trimmed); }
        setEditing(false);
      }}
      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const trimmed = draft.trim();
          if (trimmed && trimmed !== value) { onChange(trimmed); onSave(trimmed); }
          setEditing(false);
        }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
      autoFocus
      sx={(theme) => ({
        font: 'inherit',
        color: 'inherit',
        bgcolor: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        outline: 'none',
        p: 0,
        m: 0,
        width: '100%',
      })}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  TaskDetailHeader                                                   */
/* ------------------------------------------------------------------ */

export default function TaskDetailHeader({
  taskId,
  itemNumber,
  title,
  status,
  priorityLevel,
  priorityScore,
  assigneeUserId,
  assigneeName,
  dueDate,
  isProjectTask,
  hasConvertedRequest,
  projectId,
  projectName,
  onNavigateToProject,
  currentIndex,
  totalCount,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onConvertToRequest,
  onDelete,
  onTitleChange,
  onTitleSave,
  onMetadataPatch,
  canManage,
  canDelete,
  canConvertToRequest,
  convertDisabledTitle,
  crumbs,
  onOriginClick,
  onParentClick,
}: TaskDetailHeaderProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const originCrumb = crumbs.find((crumb) => crumb.key === 'origin');
  const parentCrumb = crumbs.find((crumb) => crumb.key === 'parent');

  return (
    <Box sx={{ flexShrink: 0 }}>
      {/* ---- Topbar ---- */}
      <Box
        component="header"
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          columnGap: '12px',
          py: taskDetailTokens.topbar.py,
          px: taskDetailTokens.topbar.px,
          borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        })}
      >
        <Box
          component="nav"
          aria-label={t('common:labels.breadcrumb')}
          sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.breadcrumb.gap, fontSize: '12px', minWidth: 0, overflow: 'hidden' }}
        >
          {originCrumb && (
            <Typography
              component="a"
              href={originCrumb.href}
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                if (isModifiedClick(e)) return;
                e.preventDefault();
                onOriginClick();
              }}
              sx={(theme) => ({
                color: theme.palette.kanap.text.secondary,
                textDecoration: 'none',
                cursor: 'pointer',
                fontSize: '12px',
                flexShrink: 0,
                maxWidth: parentCrumb ? '46%' : '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:hover': { color: theme.palette.kanap.text.primary },
              })}
            >
              ← {originCrumb.label}
            </Typography>
          )}
          {parentCrumb && (
            <>
              <Box component="span" sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, flexShrink: 0 })}>/</Box>
              <Typography
                component="a"
                href={parentCrumb.href}
                title={parentCrumb.label}
                onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  if (isModifiedClick(e)) return;
                  e.preventDefault();
                  onParentClick(parentCrumb.href);
                }}
                sx={(theme) => ({
                  color: theme.palette.primary.main,
                  textDecoration: 'none',
                  cursor: 'pointer',
                  fontSize: '12px',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  '&:hover': { textDecoration: 'underline', textUnderlineOffset: '2px' },
                })}
              >
                {parentCrumb.label}
              </Typography>
            </>
          )}
        </Box>
        <Box sx={{ justifySelf: 'center', display: 'flex', alignItems: 'center' }}>
          <TaskNavChip
            currentIndex={currentIndex + 1}
            totalCount={totalCount}
            onPrev={onPrev}
            onNext={onNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        </Box>
      </Box>

      {/* ---- TitleBlock ---- */}
      <Box sx={{ pt: taskDetailTokens.titleBlock.pt, px: taskDetailTokens.titleBlock.px, pb: taskDetailTokens.titleStack.metadataOnlyBottomGap }}>
        {/* Title row */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: taskDetailTokens.titleRow.gap }}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: taskDetailTokens.titleStack.gap }}>
            <Box component="h1" sx={{ ...taskDetailTypography.title, m: 0, minWidth: 0, display: 'flex', alignItems: 'baseline' }}>
              {itemNumber && (
                <Box
                  component="span"
                  onClick={() => navigator.clipboard.writeText(`T-${itemNumber}`)}
                  title={t('portfolio:workspace.task.actions.copyReference')}
                  sx={(theme) => ({
                    fontFamily: MONO_FONT_FAMILY,
                    ...taskDetailTypography.idPrefix,
                    color: theme.palette.kanap.text.secondary,
                    mr: '14px',
                    cursor: 'pointer',
                    flexShrink: 0,
                    '&:hover': { color: theme.palette.kanap.text.primary },
                  })}
                >
                  T-{itemNumber}
                </Box>
              )}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <EditableTitle value={title} canEdit={canManage} onChange={onTitleChange} onSave={onTitleSave} />
              </Box>
            </Box>

            {/* Metadata bar */}
            <TaskMetadataBar
              status={status}
              priorityLevel={priorityLevel}
              priorityScore={priorityScore}
              assigneeUserId={assigneeUserId}
              assigneeName={assigneeName}
              dueDate={dueDate}
              readOnly={!canManage}
              isProjectTask={isProjectTask}
              onPatch={onMetadataPatch}
              projectId={projectId}
              projectName={projectName}
              onNavigateToProject={onNavigateToProject}
            />
          </Box>

          {/* Actions bar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.actionPills.gap, flexShrink: 0, mt: '7px' }}>
            <SendLinkButton
              itemType="task"
              itemId={taskId}
              itemName={title || t('portfolio:workspace.task.title.untitled')}
              itemNumber={itemNumber}
            />

            <Button
              variant="action"
              onClick={onConvertToRequest}
              disabled={!canConvertToRequest || hasConvertedRequest}
              title={convertDisabledTitle}
            >
              {t('portfolio:actions.convertToRequest')}
            </Button>

            {canDelete && (
              <Button variant="action-danger" onClick={onDelete} startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}>
                {t('common:buttons.delete')}
              </Button>
            )}

            <IconButton
              onClick={onClose}
              size="small"
              aria-label={t('common:buttons.close')}
              sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, ml: '4px' })}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

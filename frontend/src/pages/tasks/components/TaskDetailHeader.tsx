import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { taskDetailTokens, taskDetailTypography } from '../theme/taskDetailTokens';
import type { TaskStatus } from '../task.constants';
import type { PriorityLevel } from '../theme/taskDetailTokens';
import TaskNavChip from './TaskNavChip';
import TaskMetadataBar from './TaskMetadataBar';
import SendLinkButton from '../../../components/workspace/SendLinkButton';
import type { TaskCrumb } from '../taskWorkspaceOrigin';
import DeleteIconButton from '../../../components/workspace/DeleteIconButton';
import WorkspaceTabs, { type WorkspaceTab } from '../../portfolio/workspace/WorkspaceTabs';
import EditableTitle from '../../../components/workspace/EditableTitle';
import { CreationPreview } from '../../../components/workspace/creation';

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
  priorityScore: number | null;
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

  // Tab row
  tabs: WorkspaceTab[];
  activeTab: string;
  onTabChange: (nextTab: string) => void;

  // Creation at the title (the new page, and the task while it is being created)
  /** Create and Cancel: shown in place of the record actions, the close button and the previous/next chip. */
  creationActions?: React.ReactNode;
  /** The new page: the title opens for typing, and the metadata bar is the draft's, dimmed. */
  titleToGive?: boolean;
  titleError?: string | null;
  titleFocusRequest?: number;
  onTitleDraftChange?: (draft: string) => void;
  /** Escape in the empty title of the new page. */
  onTitleCancel?: () => void;
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
  tabs,
  activeTab,
  onTabChange,
  creationActions,
  titleToGive = false,
  titleError,
  titleFocusRequest,
  onTitleDraftChange,
  onTitleCancel,
}: TaskDetailHeaderProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const originCrumb = crumbs.find((crumb) => crumb.key === 'origin');
  const parentCrumb = crumbs.find((crumb) => crumb.key === 'parent');
  const metadataBar = (
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
  );

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
          {!creationActions && (
            <TaskNavChip
              currentIndex={currentIndex + 1}
              totalCount={totalCount}
              onPrev={onPrev}
              onNext={onNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
            />
          )}
        </Box>
      </Box>

      {/* ---- TitleBlock ---- */}
      <Box sx={{ pt: taskDetailTokens.titleBlock.pt, px: taskDetailTokens.titleBlock.px, pb: taskDetailTokens.titleBlock.pb }}>
        {/* Title row */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: taskDetailTokens.titleRow.gap, mb: taskDetailTokens.titleStack.metadataToTabsGap }}>
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
                <EditableTitle
                  value={titleToGive ? '' : title}
                  fallback={titleToGive ? t('portfolio:workspace.task.title.placeholder') : t('portfolio:workspace.task.title.untitled')}
                  canEdit={canManage}
                  autoEdit={titleToGive}
                  emphasizeEmpty={titleToGive}
                  error={titleError}
                  focusRequest={titleFocusRequest}
                  onDraftChange={onTitleDraftChange}
                  onCancel={onTitleCancel}
                  onSave={(next) => {
                    if (!titleToGive) onTitleChange(next);
                    onTitleSave(next);
                  }}
                />
              </Box>
            </Box>

            {/* Metadata bar: the draft's on the new page, out of reach until the title creates the task */}
            {titleToGive ? <CreationPreview>{metadataBar}</CreationPreview> : metadataBar}
          </Box>

          {/* Actions bar */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: taskDetailTokens.actionPills.gap, flexShrink: 0, mt: '7px' }}>
            {creationActions ?? (
              <>
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
                  <DeleteIconButton onClick={onDelete} />
                )}

                <IconButton
                  onClick={onClose}
                  size="small"
                  aria-label={t('common:buttons.close')}
                  sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, ml: '4px' })}
                >
                  <CloseIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </>
            )}
          </Box>
        </Box>

        <WorkspaceTabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
      </Box>
    </Box>
  );
}

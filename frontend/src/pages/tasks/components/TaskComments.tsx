import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Avatar,
  Box,
  Button,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { MarkdownContent } from '../../../components/MarkdownContent';
import { useLocale } from '../../../i18n/useLocale';
import { useTenant } from '../../../tenant/TenantContext';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { buildInlineImageUrl, resolveInlineImageTenantSlug } from '../../../utils/inlineImageUrls';
import { formatRelativeTime, getTaskStatusLabel } from '../../../utils/portfolioI18n';
import { formatUserName, getUserInitials } from '../../../utils/userDisplay';
import UnifiedActivityForm from './UnifiedActivityForm';
import type { TaskStatus } from '../task.constants';

const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));

interface Activity {
  id: string;
  type: 'comment' | 'change' | 'decision';
  content: string | null;
  context: string | null;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  created_at: string;
  updated_at?: string | null;
  changed_fields?: Record<string, [unknown, unknown]>;
}

interface TaskCommentsProps {
  taskId: string;
  projectId?: string;
  readOnly?: boolean;
  currentStatus: TaskStatus;
  relatedObjectType?: string;
  totalTimeHours?: number;
  initialStatus?: TaskStatus | null;
  commentFocusNonce?: number;
}

export default function TaskComments({
  taskId,
  projectId,
  readOnly = false,
  currentStatus,
  relatedObjectType,
  totalTimeHours = 0,
  initialStatus = null,
  commentFocusNonce = 0,
}: TaskCommentsProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { hasLevel, profile } = useAuth();
  const { tenantSlug } = useTenant();
  const canComment = hasLevel('tasks', 'member');
  const inlineImageTenantSlug = resolveInlineImageTenantSlug(tenantSlug, window.location.hostname);

  const [error, setError] = React.useState<string | null>(null);

  // Editing state
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editContent, setEditContent] = React.useState('');
  const [editSubmitting, setEditSubmitting] = React.useState(false);

  // Upload image for rich text editor, returns the URL to embed
  const handleUploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('source_field', 'content');
    const res = await api.post<{ id: string }>(`/tasks/${taskId}/attachments`, formData);
    return buildInlineImageUrl(`/tasks/attachments/${inlineImageTenantSlug}/${res.data.id}/inline`);
  };

  const handleImportImageUrl = async (sourceUrl: string): Promise<string> => {
    const res = await api.post<{ id: string }>(`/tasks/${taskId}/attachments/inline/import`, {
      source_field: 'content',
      source_url: sourceUrl,
    });
    return buildInlineImageUrl(`/tasks/attachments/${inlineImageTenantSlug}/${res.data.id}/inline`);
  };

  const { data: activities = [], isLoading, refetch } = useQuery({
    queryKey: ['task-activities', taskId],
    queryFn: async () => {
      try {
        const endpoint = projectId
          ? `/portfolio/projects/${projectId}/tasks/${taskId}/activities`
          : `/tasks/${taskId}/activities`;
        const res = await api.get<Activity[]>(endpoint);
        return res.data;
      } catch {
        // Endpoint may not exist yet - return empty array
        return [];
      }
    },
    enabled: !!taskId,
  });

  const comments = activities.filter(a => a.type === 'comment');

  const handleStartEdit = (comment: Activity) => {
    setEditingId(comment.id);
    setEditContent(comment.content || '');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editContent.trim()) return;
    setEditSubmitting(true);
    setError(null);
    try {
      const endpoint = projectId
        ? `/portfolio/projects/${projectId}/tasks/${taskId}/activities/${editingId}`
        : `/tasks/${taskId}/activities/${editingId}`;
      await api.patch(endpoint, { content: editContent.trim() });
      setEditingId(null);
      setEditContent('');
      await refetch();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:activity.messages.updateCommentFailed'),
      ));
    } finally {
      setEditSubmitting(false);
    }
  };

  const canEditComment = (comment: Activity) => {
    return (
      comment.type === 'comment' &&
      profile?.id &&
      comment.author_id === profile.id &&
      canComment &&
      !readOnly
    );
  };

  const authorLabel = (activity: Activity) =>
    formatUserName(activity) || t('portfolio:activity.authorUnknown');

  return (
    <Stack spacing={2}>
      {/* Comment Input */}
      {canComment && !readOnly && (
        <UnifiedActivityForm
          taskId={taskId}
          projectId={projectId}
          currentStatus={currentStatus}
          readOnly={readOnly}
          relatedObjectType={relatedObjectType}
          totalTimeHours={totalTimeHours}
          initialStatus={initialStatus}
          focusNonce={commentFocusNonce}
          onSuccess={async () => {
            await refetch();
            queryClient.invalidateQueries({ queryKey: ['tasks', taskId] });
          }}
          onImageUpload={handleUploadImage}
          onImageUrlImport={handleImportImageUrl}
        />
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {isLoading && (
        <Typography color="text.secondary">
          {t('portfolio:activity.messages.loadingComments')}
        </Typography>
      )}

      {!isLoading && comments.length === 0 && (
        <Typography color="text.secondary" variant="body2">
          {t('portfolio:activity.messages.noComments')}
        </Typography>
      )}

      {/* Comments List */}
      <Stack spacing="22px">
        {comments.map((comment) => (
          <Box
            key={comment.id}
            sx={{ display: 'flex', gap: '12px' }}
          >
            <Avatar sx={{ width: 26, height: 26, fontSize: '10px', fontWeight: 500, bgcolor: 'primary.main', flexShrink: 0 }}>
              {getUserInitials(comment)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Typography sx={{ fontSize: '13px', fontWeight: 500 }}>
                    {authorLabel(comment)}
                  </Typography>
                  <Typography sx={{ fontSize: '11px', color: 'text.secondary' }}>
                    {formatRelativeTime(t, comment.created_at, locale)}
                  </Typography>
                  {comment.updated_at && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                      {t('portfolio:activity.labels.edited')}
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  {canEditComment(comment) && editingId !== comment.id && (
                    <Tooltip title={t('portfolio:activity.actions.editComment')}>
                      <IconButton
                        size="small"
                        onClick={() => handleStartEdit(comment)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
                {editingId === comment.id ? (
                  <Box sx={{ mt: 1 }}>
                    <React.Suspense fallback={<Box sx={{ minHeight: 6 * 24, border: 1, borderColor: 'divider', borderRadius: 1 }} />}>
                      <MarkdownEditor
                        value={editContent}
                        onChange={setEditContent}
                        placeholder={t('portfolio:activity.placeholders.editComment')}
                        minRows={6}
                        maxRows={12}
                        disabled={editSubmitting}
                        onImageUpload={handleUploadImage}
                        onImageUrlImport={handleImportImageUrl}
                        delegateWheelUntilFocus
                      />
                    </React.Suspense>
                    <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'flex-end' }}>
                      <Button
                        size="small"
                        onClick={handleCancelEdit}
                        disabled={editSubmitting}
                      >
                        {t('common:buttons.cancel')}
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={handleSaveEdit}
                        disabled={editSubmitting || !editContent.trim()}
                      >
                        {editSubmitting ? t('common:status.saving') : t('common:buttons.save')}
                      </Button>
                    </Stack>
                  </Box>
                ) : (
                  <Box sx={{ mt: '4px' }}>
                    <MarkdownContent content={comment.content || ''} variant="compact" />
                  </Box>
                )}
                {/* The status changed with the comment, as a project's decision shows it. */}
                {Array.isArray(comment.changed_fields?.status) && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: '4px' }}>
                    {t('portfolio:activity.labels.statusChange', {
                      from: getTaskStatusLabel(t, String(comment.changed_fields.status[0])),
                      to: getTaskStatusLabel(t, String(comment.changed_fields.status[1])),
                    })}
                  </Typography>
                )}
            </Box>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}

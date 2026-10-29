import React from 'react';
import {
  Box,
  Tab,
  Tabs,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import TaskComments from './TaskComments';
import TaskWorkLog from './TaskWorkLog';
import type { TaskStatus } from '../task.constants';
import { taskDetailTokens } from '../theme/taskDetailTokens';
import { textTabSx, textTabsSx } from '../../../theme/formSx';

type ActivityTab = 'comments' | 'worklog';

interface TaskActivityProps {
  taskId: string;
  projectId?: string;
  readOnly?: boolean;
  relatedObjectType?: string;
  currentStatus: TaskStatus;
  totalTimeHours?: number;
  initialStatus?: TaskStatus | null;
  commentFocusNonce?: number;
}

// Task types that don't support time logging
const TIME_LOGGING_EXCLUDED_TYPES = ['contract', 'spend_item', 'capex_item'];

export default function TaskActivity({
  taskId,
  projectId,
  readOnly = false,
  relatedObjectType,
  currentStatus,
  totalTimeHours = 0,
  initialStatus = null,
  commentFocusNonce = 0,
}: TaskActivityProps) {
  const { t } = useTranslation('portfolio');
  const supportsTimeLogging = !TIME_LOGGING_EXCLUDED_TYPES.includes(relatedObjectType || '');
  const [activeTab, setActiveTab] = React.useState<ActivityTab>('comments');

  React.useEffect(() => {
    if (commentFocusNonce < 1) return;
    setActiveTab('comments');
  }, [commentFocusNonce]);

  return (
    <Box>
      {/* Comments and work log; the changes are in the History panel of the header. */}
      <Box sx={{ mb: taskDetailTokens.activityHead.mb }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          sx={textTabsSx}
        >
          <Tab
            label={t('activity.tabs.comments')}
            value="comments"
            sx={textTabSx(activeTab === 'comments')}
          />
          {supportsTimeLogging && (
            <Tab
              label={t('activity.tabs.workLog')}
              value="worklog"
              sx={[textTabSx(activeTab === 'worklog'), { mr: 0 }]}
            />
          )}
        </Tabs>
      </Box>

      <Box sx={{ minHeight: 200 }}>
        {activeTab === 'comments' && (
          <TaskComments
            taskId={taskId}
            projectId={projectId}
            readOnly={readOnly}
            relatedObjectType={relatedObjectType}
            currentStatus={currentStatus}
            totalTimeHours={totalTimeHours}
            initialStatus={initialStatus}
            commentFocusNonce={commentFocusNonce}
          />
        )}
        {activeTab === 'worklog' && supportsTimeLogging && (
          <TaskWorkLog taskId={taskId} projectId={projectId} readOnly={readOnly} relatedObjectType={relatedObjectType} />
        )}
      </Box>
    </Box>
  );
}

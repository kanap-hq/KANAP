import React from 'react';
import {
  Box,
  Tab,
  Tabs,
} from '@mui/material';
import CommentIcon from '@mui/icons-material/Comment';
import HistoryIcon from '@mui/icons-material/History';
import { useTranslation } from 'react-i18next';
import PortfolioComments from './PortfolioComments';
import PortfolioHistory from './PortfolioHistory';
import { textTabSx, textTabsSx } from '../../../theme/formSx';

type ActivityTab = 'comments' | 'history';

interface Activity {
  id: string;
  type: 'comment' | 'change' | 'decision';
  content: string | null;
  context: string | null;
  decision_outcome: string | null;
  changed_fields?: Record<string, [unknown, unknown]>;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface PortfolioActivityProps {
  entityType: 'request' | 'project';
  entityId: string;
  activities: Activity[];
  createdAt?: string | null;
  createdByName?: string | null;
  currentStatus: string;
  allowedTransitions: string[];
  statusOptions: Array<{ value: string; label: string }>;
  onAddComment: (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => Promise<void>;
  onUpdateComment?: (activityId: string, content: string) => Promise<void>;
  currentUserId?: string | null;
  readOnly?: boolean;
  onImageUpload?: (file: File, sourceField: string) => Promise<string>;
  onImageUrlImport?: (sourceUrl: string, sourceField: string) => Promise<string>;
  /**
   * Show the feed's History sub-tab. A record whose changes read in its own History tab (the
   * project) turns it off: its feed then shows the comments and decisions only.
   */
  showHistory?: boolean;
}

export default function PortfolioActivity({
  entityType,
  entityId,
  activities,
  createdAt,
  createdByName,
  currentStatus,
  allowedTransitions,
  statusOptions,
  onAddComment,
  onUpdateComment,
  currentUserId,
  readOnly = false,
  onImageUpload,
  onImageUrlImport,
  showHistory = true,
}: PortfolioActivityProps) {
  const { t } = useTranslation('portfolio');
  const [activeTab, setActiveTab] = React.useState<ActivityTab>('comments');

  const handleTabChange = (_: React.SyntheticEvent, newTab: ActivityTab) => {
    if (newTab) {
      setActiveTab(newTab);
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 1.75 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          sx={textTabsSx}
        >
          <Tab
            value="comments"
            icon={<CommentIcon sx={{ fontSize: 14 }} />}
            iconPosition="start"
            label={t('activity.tabs.comments')}
            sx={[textTabSx(activeTab === 'comments'), { '& .MuiTab-iconWrapper': { mr: 0.75 } }]}
          />
          {showHistory && (
            <Tab
              value="history"
              icon={<HistoryIcon sx={{ fontSize: 14 }} />}
              iconPosition="start"
              label={t('activity.tabs.history')}
              sx={[textTabSx(activeTab === 'history'), { '& .MuiTab-iconWrapper': { mr: 0.75 } }]}
            />
          )}
        </Tabs>
      </Box>

      <Box sx={{ minHeight: 200 }}>
        {activeTab === 'comments' && (
          <PortfolioComments
            entityType={entityType}
            entityId={entityId}
            activities={activities}
            currentStatus={currentStatus}
            allowedTransitions={allowedTransitions}
            statusOptions={statusOptions}
            onAddComment={onAddComment}
            onUpdateComment={onUpdateComment}
            currentUserId={currentUserId}
            readOnly={readOnly}
            onImageUpload={onImageUpload}
            onImageUrlImport={onImageUrlImport}
          />
        )}
        {showHistory && activeTab === 'history' && (
          <PortfolioHistory
            entityType={entityType}
            activities={activities}
            createdAt={createdAt}
            createdByName={createdByName}
          />
        )}
      </Box>
    </Box>
  );
}

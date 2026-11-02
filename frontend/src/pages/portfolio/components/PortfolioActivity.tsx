import React from 'react';
import PortfolioComments from './PortfolioComments';

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
}

/**
 * The feed of a project or a request: its comments and decisions only. Its changes read in the
 * record's History tab (`audit_log`); the feed's `change` entries stay stored for the dashboard
 * and the assistant, and `PortfolioComments` leaves them out.
 */
export default function PortfolioActivity(props: PortfolioActivityProps) {
  return <PortfolioComments {...props} />;
}

import React from 'react';
import PortfolioActivity from '../../components/PortfolioActivity';

type ProjectActivityTabProps = {
  activities: any[];
  allowedTransitions: string[];
  currentStatus: string;
  currentUserId?: string | null;
  entityId: string;
  onAddComment: (data: {
    content: string;
    context: string | null;
    is_decision: boolean;
    decision_outcome?: string;
    new_status?: string;
  }) => Promise<void>;
  onImageUpload: (file: File, sourceField: string) => Promise<string>;
  onImageUrlImport: (sourceUrl: string, sourceField: string) => Promise<string>;
  onUpdateComment: (activityId: string, content: string) => Promise<void>;
  readOnly: boolean;
  statusOptions: Array<{ value: string; label: string }>;
};

export default function ProjectActivityTab({
  activities,
  allowedTransitions,
  currentStatus,
  currentUserId,
  entityId,
  onAddComment,
  onImageUpload,
  onImageUrlImport,
  onUpdateComment,
  readOnly,
  statusOptions,
}: ProjectActivityTabProps) {
  return (
    <PortfolioActivity
      entityType="project"
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
  );
}

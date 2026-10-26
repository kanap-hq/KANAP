import React from 'react';
import { Alert, Box } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { incidentsApi } from '../../../api/endpoints/incidents';
import TaskAttachments, { type TaskAttachment } from '../../tasks/components/TaskAttachments';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type Props = {
  incidentId: string;
  canManage: boolean;
  onCountChange: (count: number) => void;
};

export default function IncidentAttachmentsSection({ incidentId, canManage, onCountChange }: Props) {
  const { t } = useTranslation('it');
  const [error, setError] = React.useState<string | null>(null);

  const { data: attachments = [], refetch } = useQuery({
    queryKey: ['incident-attachments', incidentId],
    queryFn: () => incidentsApi.listAttachments(incidentId),
  });

  // TaskAttachments is presentational and only reads id / filename / size.
  const rows = React.useMemo<TaskAttachment[]>(
    () => attachments.map(({ incident_id, ...rest }) => ({ ...rest, task_id: incident_id })),
    [attachments],
  );

  const syncCount = async () => {
    const result = await refetch();
    if (result.data) onCountChange(result.data.length);
  };

  const handleUpload = async (file: File) => {
    try {
      await incidentsApi.uploadAttachment(incidentId, file);
      setError(null);
      await syncCount();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.attachmentsFailed')));
    }
  };

  const handleDelete = async (attachmentId: string) => {
    try {
      await incidentsApi.deleteAttachment(attachmentId);
      setError(null);
      await syncCount();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.attachmentsFailed')));
    }
  };

  // A reader sees only what exists: no empty section and no permanent drop zone.
  if (!canManage && attachments.length === 0) return null;

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      <TaskAttachments
        taskId={incidentId}
        basePath="/incidents"
        attachments={rows}
        onUpload={handleUpload}
        onDelete={handleDelete}
        canManage={canManage}
      />
    </Box>
  );
}

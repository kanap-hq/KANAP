import React from 'react';
import { Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useKanapDialogs } from '../../../components/design';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type Props = {
  applicationId: string;
  applicationName: string;
  onDeleted: () => void;
  onError: (message: string) => void;
};

/**
 * Delete action of the application workspace: confirm, delete, refresh the
 * applications list, then hand control back so the page can leave.
 */
export default function ApplicationDeleteButton({ applicationId, applicationName, onDeleted, onError }: Props) {
  const { t } = useTranslation(['it', 'common']);
  const dialogs = useKanapDialogs();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = React.useState(false);

  const handleClick = async () => {
    const confirmed = await dialogs.confirm({
      title: t('common:delete.recordTitle', { name: applicationName }),
      message: t('workspace.application.deleteMessage', { name: applicationName }),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!confirmed) return;
    setDeleting(true);
    try {
      await api.delete(`/applications/${applicationId}`);
      await queryClient.invalidateQueries({
        predicate: (query) => ['applications', 'app-filter-values'].some((key) => String(query.queryKey[0]).startsWith(key)),
      });
      onDeleted();
    } catch (err: any) {
      setDeleting(false);
      onError(getApiErrorMessage(err, t, t('messages.deleteApplicationFailed')));
    }
  };

  return (
    <Button
      variant="action-danger"
      startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
      size="small"
      onClick={() => { void handleClick(); }}
      disabled={deleting}
    >
      {t('common:buttons.delete')}
    </Button>
  );
}

import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

type Props = {
  beingCreated: boolean;
  cancelling?: boolean;
  onCancel: () => void;
};

/** The "Cancel creation" pill of a record just created, shown while the person stays on it. */
export default function CancelCreationButton({ beingCreated, cancelling = false, onCancel }: Props) {
  const { t } = useTranslation('common');
  if (!beingCreated) return null;
  return (
    <Button variant="action" size="small" onClick={onCancel} disabled={cancelling}>
      {t('common:creation.cancel')}
    </Button>
  );
}

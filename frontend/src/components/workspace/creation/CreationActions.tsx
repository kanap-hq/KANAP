import { Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

type Props = {
  /** Keeps the record and closes it (the page saves what is still being typed first). */
  onCreate: () => void;
  /** Closes without keeping: leaves a new page, deletes a record being created. */
  onCancel: () => void;
  /** A create, a check or a cancel is running: both wait. */
  busy?: boolean;
};

/**
 * The two actions of a record being created, in its header in place of the close button: Create
 * (the primary pill) and Cancel. Shown on the new page and on the created record while the person
 * stays on it (`useRecordCreation`).
 */
export default function CreationActions({ onCreate, onCancel, busy = false }: Props) {
  const { t } = useTranslation('common');
  return (
    <>
      <Button variant="action" size="small" onClick={onCancel} disabled={busy}>
        {t('common:buttons.cancel')}
      </Button>
      <Button variant="action-primary" size="small" onClick={onCreate} disabled={busy}>
        {t('common:buttons.create')}
      </Button>
    </>
  );
}

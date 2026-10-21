import React from 'react';
import { Button } from '@mui/material';
import ShareIcon from '@mui/icons-material/Share';
import { useTranslation } from 'react-i18next';
import ShareDialog, { type ShareItemType } from '../ShareDialog';

type SendLinkButtonProps = {
  itemType: ShareItemType;
  itemId: string;
  itemName: string;
  itemNumber?: number | null;
  itemRef?: string | null;
  disabled?: boolean;
  variant?: 'action' | 'outlined';
  size?: 'small' | 'medium';
};

export default function SendLinkButton({
  itemType,
  itemId,
  itemName,
  itemNumber,
  itemRef,
  disabled = false,
  variant = 'action',
  size,
}: SendLinkButtonProps) {
  const { t } = useTranslation('common');
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        disabled={disabled}
        startIcon={<ShareIcon sx={{ fontSize: '14px !important' }} />}
      >
        {t('share.share')}
      </Button>
      <ShareDialog
        open={open}
        onClose={() => setOpen(false)}
        itemType={itemType}
        itemId={itemId}
        itemName={itemName}
        itemNumber={itemNumber}
        itemRef={itemRef}
      />
    </>
  );
}

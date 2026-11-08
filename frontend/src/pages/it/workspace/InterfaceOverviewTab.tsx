import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import IntegratedDocumentEditor, { type IntegratedDocumentEditorHandle } from '../../../components/IntegratedDocumentEditor';
import type { InterfaceDetail } from '../components/interface-workspace/types';

type Props = {
  canManage: boolean;
  data: InterfaceDetail | null;
  isCreate: boolean;
  specificationEditorRef: React.RefObject<IntegratedDocumentEditorHandle | null>;
  onPatch: (patch: Partial<InterfaceDetail>) => Promise<void>;
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="h2"
      sx={(theme) => ({
        m: 0,
        mb: 1,
        fontSize: 14,
        fontWeight: 500,
        color: theme.palette.kanap.text.primary,
      })}
    >
      {children}
    </Typography>
  );
}

export default function InterfaceOverviewTab({
  canManage,
  data,
  isCreate,
  specificationEditorRef,
  onPatch,
}: Props) {
  const { t } = useTranslation(['it', 'common']);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box data-creation-description="">
        <SectionHeader>{t('it:workspace.interface.overview.specification')}</SectionHeader>
        <IntegratedDocumentEditor
          ref={specificationEditorRef as React.Ref<IntegratedDocumentEditorHandle>}
          entityType="interfaces"
          entityId={isCreate ? null : (data?.id || null)}
          slotKey="specification"
          label={t('it:workspace.interface.overview.specificationDocument')}
          disabled={!canManage}
          draftValue={data?.specification_markdown || ''}
          onDraftChange={(value) => {
            void onPatch({ specification_markdown: value });
          }}
          editModeBehavior="auto"
          showDocumentControls={false}
          autosaveEnabled
          minRows={12}
          maxRows={34}
          surface
          hideToolbarUntilFocus
          placeholder={t('it:workspace.interface.overview.specificationPlaceholder')}
        />
      </Box>
    </Box>
  );
}

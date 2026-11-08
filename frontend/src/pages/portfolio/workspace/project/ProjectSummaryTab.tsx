import React from 'react';
import {
  Box,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import IntegratedDocumentEditor, { IntegratedDocumentEditorHandle } from '../../../../components/IntegratedDocumentEditor';

type ProjectSummaryTabProps = {
  canEditManagedDocs: boolean;
  form: any;
  id: string;
  isCreate: boolean;
  onPurposeDirtyChange: (dirty: boolean) => void;
  onPurposeDraftChange: (value: string) => void;
  purposeEditorRef: React.RefObject<IntegratedDocumentEditorHandle>;
};

export default function ProjectSummaryTab({
  canEditManagedDocs,
  form,
  id,
  isCreate,
  onPurposeDirtyChange,
  onPurposeDraftChange,
  purposeEditorRef,
}: ProjectSummaryTabProps) {
  const { t } = useTranslation('portfolio');
  const [purposeExpanded, setPurposeExpanded] = React.useState(true);

  return (
    <Stack spacing={3}>
      <Box data-creation-description="">
        <IntegratedDocumentEditor
          ref={purposeEditorRef}
          collapsed={!purposeExpanded}
          collapsible
          entityType="projects"
          entityId={isCreate ? null : id}
          headerTitle={(
            <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
              {t('workspace.project.summary.cards.purpose')}
            </Typography>
          )}
          slotKey="purpose"
          label={t('workspace.project.summary.cards.purpose')}
          hideHeaderLabel
          onToggleCollapsed={() => setPurposeExpanded((prev) => !prev)}
          placeholder={t('workspace.project.summary.placeholders.purpose')}
          minRows={14}
          maxRows={26}
          disabled={!canEditManagedDocs}
          showManagedDocChip={false}
          showDocumentControls={false}
          editModeBehavior="auto"
          autosaveEnabled={!isCreate}
          draftValue={form?.purpose || ''}
          onDraftChange={onPurposeDraftChange}
          onDirtyChange={onPurposeDirtyChange}
          surface
          hideToolbarUntilFocus
        />
      </Box>
    </Stack>
  );
}

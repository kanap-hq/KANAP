import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { PhaseTemplateEditDialog } from './PhaseTemplateEditDialog';
import TabActions from './TabActions';
import type { PhaseTemplate, SettingsTabProps } from './types';
import { useSettingsDelete } from './useSettingsDelete';

/** The phase templates tab: the phases a new project can start from. */
export default function PhaseTemplatesTab({ canEdit }: SettingsTabProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const [phaseTemplates, setPhaseTemplates] = useState<PhaseTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<PhaseTemplate | null>(null);

  const loadData = useCallback(async () => {
    try {
      const templatesRes = await api.get('/portfolio/phase-templates');
      setPhaseTemplates(templatesRes.data || []);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings.messages.loadFailed')));
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const deleteItem = useSettingsDelete({ canEdit, onDeleted: loadData, onError: setError });

  const handleEditTemplate = useCallback((template: PhaseTemplate) => {
    setEditingTemplate(template);
    setTemplateDialogOpen(true);
  }, []);

  const handleCreateTemplate = useCallback(() => {
    setEditingTemplate(null);
    setTemplateDialogOpen(true);
  }, []);

  const handleDeleteTemplate = useCallback((id: string) => deleteItem({
    id,
    name: phaseTemplates.find((entry) => entry.id === id)?.name ?? '',
    base: '/portfolio/phase-templates',
    failed: t('settings.phaseTemplates.messages.deleteFailed'),
  }), [deleteItem, phaseTemplates, t]);

  return (
    <>
      {canEdit && (
        <TabActions>
          <Button variant="action-primary" startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />} onClick={handleCreateTemplate}>
            {t('settings.actions.addTemplate')}
          </Button>
        </TabActions>
      )}

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <PhaseTemplatesSection
        templates={phaseTemplates}
        canEdit={canEdit}
        onEdit={handleEditTemplate}
        onDelete={handleDeleteTemplate}
      />

      {/* Edit/Create Phase Template Dialog */}
      <PhaseTemplateEditDialog
        open={templateDialogOpen}
        template={editingTemplate}
        onClose={() => setTemplateDialogOpen(false)}
        onSave={() => {
          setTemplateDialogOpen(false);
          loadData();
        }}
      />
    </>
  );
}

// Phase Templates Section Component
function PhaseTemplatesSection({
  templates,
  canEdit,
  onEdit,
  onDelete,
}: {
  templates: PhaseTemplate[];
  canEdit: boolean;
  onEdit: (template: PhaseTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation(['portfolio', 'common']);
  if (templates.length === 0) {
    return (
      <Alert severity="info">
        {t('settings.phaseTemplates.empty')}
      </Alert>
    );
  }

  return (
    <Stack spacing={2}>

      {templates.map((template) => (
        <Card key={template.id}>
          <CardContent>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle1">{template.name}</Typography>
                  {template.is_system && (
                    <Typography variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                      {t('settings.labels.system')}
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                    {t('settings.phaseTemplates.chips.phaseCount', { count: template.items.length })}
                  </Typography>
                </Stack>

                <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                  {template.items.map((item, idx) => (
                    <Typography
                      key={item.id || idx}
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontSize: '0.8125rem' }}
                    >
                      {item.name}
                    </Typography>
                  ))}
                </Stack>
              </Box>

              {canEdit && (
                <>
                  <IconButton onClick={() => onEdit(template)}>
                    <EditIcon />
                  </IconButton>
                  <IconButton color="error" onClick={() => onDelete(template.id)}>
                    <DeleteIcon />
                  </IconButton>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

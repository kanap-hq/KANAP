/**
 * Compact Knowledge section for the task properties drawer.
 * Shows linked docs as 1-line items with hover actions,
 * and provides `+ Link existing` / `+ New document ▾` teal links.
 */
import React from 'react';
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Button,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import KnowledgeLinkPickerDialog, { type KnowledgeLinkOption } from '../../../components/knowledge/KnowledgeLinkPickerDialog';
import { tealLinkSx } from '../../../theme/formSx';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type KnowledgeContextItem = {
  id: string;
  item_number: number;
  title: string;
  status: string;
  updated_at: string | null;
  provenance: Array<{ entity_type: string; entity_id: string; item_number: number | null; name: string }>;
};

type KnowledgeContextGroup = {
  key: string;
  label: string;
  linked_via_label: string;
  total: number;
  items: KnowledgeContextItem[];
};

type KnowledgeContextResponse = {
  access: string;
  total: number;
  groups: KnowledgeContextGroup[];
};

type DocumentListItem = KnowledgeLinkOption;

type TemplateListItem = {
  id: string;
  item_number: number;
  title: string;
  document_type_id: string | null;
  document_type_name: string | null;
};

interface DrawerKnowledgeSectionProps {
  taskId: string;
  canCreate: boolean;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function DrawerKnowledgeSection({ taskId, canCreate }: DrawerKnowledgeSectionProps) {
  const { t } = useTranslation(['portfolio', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [linkOpen, setLinkOpen] = React.useState(false);
  const [newDocAnchor, setNewDocAnchor] = React.useState<HTMLElement | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = React.useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = React.useState('');

  /* ---- Queries ---- */

  const { data: contextData } = useQuery({
    queryKey: ['task-knowledge-context', taskId],
    queryFn: async () => {
      const res = await api.get<KnowledgeContextResponse>(`/tasks/${taskId}/knowledge-context`);
      return res.data;
    },
    enabled: !!taskId,
  });

  // Direct linked docs (group key = 'direct')
  const directDocs = React.useMemo(() => {
    if (!contextData?.groups) return [];
    const directGroup = contextData.groups.find((g) => g.key === 'direct');
    return directGroup?.items || [];
  }, [contextData]);

  const linkedDocIds = React.useMemo(() => new Set(directDocs.map((d) => d.id)), [directDocs]);

  // Templates for the picker
  const { data: templatesData } = useQuery({
    queryKey: ['knowledge-templates'],
    queryFn: async () => {
      const libs = await api.get<{ items: Array<{ id: string; slug: string }> }>('/knowledge-libraries');
      const templateLib = (libs.data.items || []).find((l) => l.slug === 'templates');
      if (!templateLib) return [];
      const res = await api.get<{ items: TemplateListItem[] }>('/knowledge', {
        params: { library_id: templateLib.id, limit: 100, sort: 'title:ASC' },
      });
      return res.data.items;
    },
    enabled: templatePickerOpen,
  });

  /* ---- Mutations ---- */

  const invalidateAll = React.useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task-knowledge-context', taskId] }),
    ]);
  }, [queryClient, taskId]);

  const updateRelation = React.useCallback(async (documentId: string, mode: 'link' | 'unlink') => {
    const details = await api.get<{ relations?: { tasks?: Array<string | { id?: string | null }> } }>(`/knowledge/${documentId}`);
    const current = (details.data.relations?.tasks || [])
      .map((e) => typeof e === 'string' ? e : String(e?.id || '').trim())
      .filter(Boolean);
    const next = mode === 'link'
      ? Array.from(new Set([...current, taskId]))
      : current.filter((id) => id !== taskId);
    await api.post(`/knowledge/${documentId}/relations/tasks/bulk-replace`, { task_ids: next });
  }, [taskId]);

  const linkMutation = useMutation({
    mutationFn: async (doc: DocumentListItem) => { await updateRelation(doc.id, 'link'); },
    onSuccess: async () => { setLinkOpen(false); await invalidateAll(); },
  });

  const unlinkMutation = useMutation({
    mutationFn: async (docId: string) => { await updateRelation(docId, 'unlink'); },
    onSuccess: invalidateAll,
  });

  const createBlankMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/knowledge', {
        title: 'New linked knowledge (task)',
        content_markdown: '',
        status: 'draft',
        relations: { tasks: [taskId] },
      });
      return res.data as { id: string; item_number: number; item_ref?: string };
    },
    onSuccess: async (created) => {
      await invalidateAll();
      const ref = created.item_ref || `DOC-${created.item_number}`;
      window.open(`/knowledge/${ref}`, '_blank', 'noopener');
    },
  });

  const handleCreateFromTemplate = React.useCallback(() => {
    const template = (templatesData || []).find((t) => t.id === selectedTemplateId);
    if (!template) return;
    const sp = new URLSearchParams();
    sp.set('task_id', taskId);
    sp.set('template_document_id', template.id);
    navigate(`/knowledge/new?${sp.toString()}`);
    setTemplatePickerOpen(false);
    setSelectedTemplateId('');
  }, [taskId, navigate, selectedTemplateId, templatesData]);

  /* ---- Render ---- */

  return (
    <Box>
      {/* Document list — 1 line per doc */}
      {directDocs.length > 0 && (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mb: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {directDocs.map((doc) => {
            const ref = `DOC-${doc.item_number}`;
            return (
              <Box
                component="li"
                key={doc.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: 13, minHeight: 20, py: '2px',
                  '&:hover .knowledge-actions': { opacity: 1 },
                }}
              >
                <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 10, color: 'text.secondary', flexShrink: 0 }}>
                  {ref}
                </Box>
                <Box
                  component="a"
                  href={`/knowledge/${ref}`}
                  target="_blank"
                  rel="noopener"
                  title={doc.title}
                  sx={(theme) => ({
                    color: theme.palette.kanap.text.primary,
                    textDecoration: 'none',
                    flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    fontSize: 13, lineHeight: 1.3,
                    '&:hover': { color: theme.palette.kanap.teal, textDecoration: 'underline', textUnderlineOffset: '2px' },
                  })}
                >
                  {doc.title}
                </Box>
                <Box className="knowledge-actions" sx={{ display: 'flex', alignItems: 'center', gap: '4px', opacity: 0, transition: 'opacity 0.15s', flexShrink: 0 }}>
                  <Box
                    component="a"
                    href={`/knowledge/${ref}`}
                    target="_blank"
                    rel="noopener"
                    aria-label="Open in new tab"
                    sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, textDecoration: 'none', fontSize: 12, lineHeight: 1, p: '0 2px', '&:hover': { color: theme.palette.kanap.text.primary } })}
                  >
                    ↗
                  </Box>
                  {canCreate && (
                    <Box
                      component="button"
                      onClick={() => unlinkMutation.mutate(doc.id)}
                      aria-label="Unlink document"
                      sx={(theme) => ({ background: 'none', border: 'none', cursor: 'pointer', color: theme.palette.kanap.text.tertiary, fontSize: 14, lineHeight: 1, p: '0 2px', '&:hover': { color: theme.palette.kanap.danger } })}
                    >
                      ×
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {directDocs.length === 0 && (
        <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.tertiary, mb: '6px' })}>
          {t('portfolio:knowledgePanel.noDocuments', 'No documents linked')}
        </Typography>
      )}

      {/* Actions: + Link existing   + New document ▾ */}
      {canCreate && (
        <Box sx={{ display: 'flex', gap: '14px', mt: '8px', alignItems: 'center' }}>
          <Box
            component="button"
            onClick={() => setLinkOpen(true)}
            sx={tealLinkSx}
          >
            + Link existing
          </Box>

          {/* Split link: + New document ▾ */}
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap' }}>
            <Box
              component="button"
              onClick={() => createBlankMutation.mutate()}
              disabled={createBlankMutation.isPending}
              sx={tealLinkSx}
            >
              + New document
            </Box>
            <Box
              component="button"
              onClick={(e) => setNewDocAnchor(e.currentTarget as HTMLElement)}
              sx={(theme) => ({ color: theme.palette.kanap.teal, fontSize: 9, background: 'none', border: 'none', cursor: 'pointer', p: '0 2px', lineHeight: 1 })}
              aria-label="New document options"
            >
              ▾
            </Box>
          </Box>
          <Menu anchorEl={newDocAnchor} open={!!newDocAnchor} onClose={() => setNewDocAnchor(null)}>
            <MenuItem sx={{ fontSize: 13 }} onClick={() => { createBlankMutation.mutate(); setNewDocAnchor(null); }}>
              {t('portfolio:knowledgePanel.blankDocument', 'Blank document')}
            </MenuItem>
            <MenuItem sx={{ fontSize: 13 }} onClick={() => { setTemplatePickerOpen(true); setSelectedTemplateId(''); setNewDocAnchor(null); }}>
              {t('portfolio:knowledgePanel.fromTemplate', 'From template…')}
            </MenuItem>
          </Menu>
        </Box>
      )}

      <KnowledgeLinkPickerDialog
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        linkedDocumentIds={linkedDocIds}
        linkPending={linkMutation.isPending}
        onLink={(document) => linkMutation.mutate(document)}
        title={t('common:knowledgePanel.linkExistingKnowledge', 'Link existing document')}
      />

      {/* Template picker dialog */}
      <Dialog open={templatePickerOpen} onClose={() => setTemplatePickerOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 14 }}>{t('portfolio:knowledgePanel.selectTemplate', 'Select a template')}</DialogTitle>
        <DialogContent>
          {(templatesData || []).length > 0 ? (
            <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {(templatesData || []).map((tmpl) => (
                <MenuItem
                  key={tmpl.id}
                  selected={tmpl.id === selectedTemplateId}
                  onClick={() => setSelectedTemplateId(tmpl.id)}
                  sx={{ fontSize: 13, borderRadius: 1 }}
                >
                  {tmpl.title}
                  {tmpl.document_type_name && (
                    <Typography component="span" sx={{ ml: 1, fontSize: 11, color: 'text.secondary' }}>
                      ({tmpl.document_type_name})
                    </Typography>
                  )}
                </MenuItem>
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ fontSize: 13, mt: 1 }}>
              {t('portfolio:knowledgePanel.noTemplatesAvailable', 'No templates available')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={() => setTemplatePickerOpen(false)}>{t('common:buttons.cancel')}</Button>
          <Button
            variant="action-primary"
            onClick={handleCreateFromTemplate}
            disabled={!selectedTemplateId}
          >
            {t('portfolio:knowledgePanel.useTemplate', 'Use template')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

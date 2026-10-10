import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import api from '../../api';
import { useKanapDialogs } from '../../components/design';

type BusinessProcessCategory = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order?: number;
  _isNew?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
};

export default function BusinessProcessCategoryManagerDialog({ open, onClose, onUpdated }: Props) {
  const [categories, setCategories] = useState<BusinessProcessCategory[]>([]);
  const { t } = useTranslation(['master-data', 'common']);
  const dialogs = useKanapDialogs();
  const [originalCategories, setOriginalCategories] = useState<BusinessProcessCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: BusinessProcessCategory[] }>('/business-process-categories', {
        params: { limit: 1000, sort: 'sort_order:ASC', includeInactive: true },
      });
      const items = res.data?.items || [];
      items.sort((a, b) => {
        const sa = a.sort_order ?? 100;
        const sb = b.sort_order ?? 100;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      });
      setCategories(items);
      setOriginalCategories(items);
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('businessProcesses.categoryManager.failedToLoad');
      setError(msg);
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadCategories();
    }
  }, [open, loadCategories]);

  const handleClose = () => {
    // Cancel: discard unsaved changes
    onClose();
  };

  const handleNameChange = (id: string, name: string) => {
    setCategories((prev) => prev.map((cat) => (cat.id === id ? { ...cat, name } : cat)));
  };

  const handleNameBlur = (id: string, currentName: string) => {
    const trimmed = currentName.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    // Defer saving to the Save button; just normalize local state
    setCategories((prev) =>
      prev.map((cat) => (cat.id === id ? { ...cat, name: trimmed } : cat)),
    );
  };

  const handleToggleActive = (id: string, next: boolean) => {
    setCategories((prev) =>
      prev.map((cat) => (cat.id === id ? { ...cat, is_active: next } : cat)),
    );
  };

  const handleDelete = async (id: string) => {
    if (!(await dialogs.confirm({
      message: t('businessProcesses.categoryManager.deleteConfirm'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    }))) return;
    setError(null);
    try {
      // Mark as deleted locally; deletion will be applied on Save
      setCategories((prev) => prev.filter((cat) => cat.id !== id));
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || t('businessProcesses.categoryManager.failedToDelete');
      setError(msg);
    }
  };

  const handleCreate = async () => {
    const name = await dialogs.prompt({
      title: 'New category name',
      required: true,
    });
    const trimmed = (name ?? '').trim();
    if (!trimmed) return;
    setError(null);
    const next: BusinessProcessCategory = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: trimmed,
      is_active: true,
      sort_order: 100,
      _isNew: true,
    };
    setCategories((prev) =>
      [...prev, next].sort((a, b) => {
        const sa = a.sort_order ?? 100;
        const sb = b.sort_order ?? 100;
        if (sa !== sb) return sa - sb;
        return a.name.localeCompare(b.name);
      }),
    );
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const originalById = new Map(originalCategories.map((c) => [c.id, c]));
      const currentById = new Map(categories.map((c) => [c.id, c]));

      // Deletions: originals that no longer exist in current (and are not _isNew)
      for (const orig of originalCategories) {
        if (!currentById.has(orig.id)) {
          try {
            await api.delete(`/business-process-categories/${orig.id}`);
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || t('businessProcesses.categoryManager.failedToDelete');
            setError(msg);
            setSaving(false);
            return;
          }
        }
      }

      // Updates and creations
      for (const cat of categories) {
        const orig = originalById.get(cat.id);
        if (cat._isNew) {
          // Create new
          try {
            await api.post<BusinessProcessCategory>('/business-process-categories', {
              name: cat.name.trim(),
              is_active: cat.is_active,
            });
          } catch (e: any) {
            const msg = e?.response?.data?.message || e?.message || t('businessProcesses.categoryManager.failedToCreate');
            setError(msg);
            setSaving(false);
            return;
          }
        } else if (orig) {
          const nameChanged = orig.name.trim() !== cat.name.trim();
          const activeChanged = orig.is_active !== cat.is_active;
          if (nameChanged || activeChanged) {
            try {
              await api.patch<BusinessProcessCategory>(`/business-process-categories/${cat.id}`, {
                name: cat.name.trim(),
                is_active: cat.is_active,
              });
            } catch (e: any) {
              const msg = e?.response?.data?.message || e?.message || t('businessProcesses.categoryManager.failedToUpdate');
              setError(msg);
              setSaving(false);
              return;
            }
          }
        }
      }

      if (onUpdated) onUpdated();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>Manage Business Process Categories</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Rename, activate/deactivate, or delete categories. Categories in use cannot be deleted. Changes are only saved when you click Save.
        </Typography>
        <Box sx={{ mb: 2 }}>
          <Button variant="outlined" size="small" onClick={handleCreate} disabled={loading}>
            New category
          </Button>
        </Box>
        {!!error && (
          <Box sx={{ mb: 2 }}>
            <Alert severity="error">{error}</Alert>
          </Box>
        )}
        {loading && (
          <Typography variant="body2" color="text.secondary">
            Loading categories…
          </Typography>
        )}
        {!loading && categories.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No categories found.
          </Typography>
        )}
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {categories.map((cat) => (
            <Box
              key={cat.id}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 1,
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <TextField
                  label="Name"
                  size="small"
                  value={cat.name}
                  onChange={(e) => handleNameChange(cat.id, e.target.value)}
                  onBlur={() => handleNameBlur(cat.id, cat.name)}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1 }}
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={cat.is_active}
                      onChange={(_, checked) => handleToggleActive(cat.id, checked)}
                    />
                  }
                  label="Active"
                />
                <Button
                  color="error"
                  size="small"
                  onClick={() => handleDelete(cat.id)}
                >
                  Delete
                </Button>
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button variant="action-primary" onClick={handleSave} disabled={saving || loading}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

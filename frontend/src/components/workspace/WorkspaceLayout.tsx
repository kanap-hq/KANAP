import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Divider,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

export interface WorkspaceTab {
  id: string;
  label: string;
  icon?: React.ReactElement;
  content: React.ReactNode;
  disabled?: boolean;
}

export interface WorkspaceLayoutProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tabs: WorkspaceTab[];
  currentTab: string;
  onTabChange: (tabId: string) => void;
  actions?: React.ReactNode;
  sidebar?: React.ReactNode;
  error?: string | null;
  onErrorClose?: () => void;
  loading?: boolean;
}

export function WorkspaceLayout({
  title,
  subtitle,
  tabs,
  currentTab,
  onTabChange,
  actions,
  sidebar,
  error,
  onErrorClose,
  loading,
}: WorkspaceLayoutProps) {
  const currentTabContent = tabs.find((t) => t.id === currentTab)?.content;

  return (
    <Box sx={{ p: 2 }}>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}
      >
        <Box>
          <Typography variant="h6">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        {actions}
      </Stack>
      {error && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={onErrorClose}
        >
          {error}
        </Alert>
      )}
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'flex', minHeight: 420 }}>
        <Tabs
          orientation="vertical"
          value={currentTab}
          onChange={(_, v) => onTabChange(v)}
          sx={{ borderRight: 1, borderColor: 'divider', minWidth: 180 }}
        >
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              label={tab.label}
              value={tab.id}
              icon={tab.icon}
              iconPosition="start"
              disabled={tab.disabled || loading}
            />
          ))}
        </Tabs>
        <Box sx={{ flex: 1, pl: 3 }}>
          {sidebar && (
            <Box sx={{ mb: 2 }}>
              {sidebar}
            </Box>
          )}
          {currentTabContent}
        </Box>
      </Box>
    </Box>
  );
}

export interface WorkspaceActionsProps {
  onClose: () => void;
  onReset?: () => void;
  onSave: () => void;
  dirty: boolean;
  loading?: boolean;
  showReset?: boolean;
}

export function WorkspaceActions({
  onClose,
  onReset,
  onSave,
  dirty,
  loading,
  showReset = true,
}: WorkspaceActionsProps) {
  const { t } = useTranslation('common');
  return (
    <Stack direction="row" spacing={1}>
      <Button onClick={onClose}>{t('buttons.close')}</Button>
      {showReset && onReset && (
        <Button onClick={onReset} disabled={!dirty || loading}>
          {t('buttons.reset')}
        </Button>
      )}
      <Button
        variant="contained"
        onClick={onSave}
        disabled={!dirty || loading}
      >
        {t('buttons.save')}
      </Button>
    </Stack>
  );
}

export default WorkspaceLayout;

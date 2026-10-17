import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useFeatures } from '../../config/FeaturesContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

interface WorkspaceSettings {
  portfolio: {
    enabled: boolean;
    status_changes: boolean;
    team_additions: boolean;
    team_changes_as_lead: boolean;
    comments: boolean;
  };
  tasks: {
    enabled: boolean;
    as_assignee: boolean;
    as_requestor: boolean;
    as_viewer: boolean;
    status_changes: boolean;
    comments: boolean;
  };
  budget: {
    enabled: boolean;
    expiration_warnings: boolean;
    status_changes: boolean;
    comments: boolean;
  };
  technologies?: {
    enabled: boolean;
    vulnerabilities: boolean;
  };
}

interface NotificationPreferencesData {
  emails_enabled: boolean;
  workspace_settings: WorkspaceSettings;
  weekly_review_enabled: boolean;
  weekly_review_day: number;
  weekly_review_hour: number;
  timezone: string;
}

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: `${String(i).padStart(2, '0')}:00`,
}));

const COMMON_TIMEZONES = [
  'Europe/Paris',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Zurich',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
];

export default function NotificationsTab() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['settings', 'common', 'errors']);
  const { config } = useFeatures();
  const [prefs, setPrefs] = useState<NotificationPreferencesData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dayOptions = useMemo(
    () => DAY_KEYS.map((key, i) => ({ value: i, label: t(`settings:notifications.days.${key}`) })),
    [t],
  );

  const sendTestEmail = useCallback(async () => {
    setSendingTest(true);
    setError(null);
    try {
      const res = await api.post('/users/me/notification-preferences/test-weekly-review');
      if (res.data?.success) {
        setSuccessMessage(res.data.message || t('common:messages.testEmailSent'));
        setTimeout(() => setSuccessMessage(''), 5000);
      } else {
        const code = res.data?.code;
        setError(code ? t(`errors:${code}`, { defaultValue: res.data?.message }) : (res.data?.message || t('common:messages.testEmailFailed')));
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('common:messages.testEmailFailed')));
    } finally {
      setSendingTest(false);
    }
  }, [t]);

  // Fetch current preferences
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => {
      const res = await api.get('/users/me/notification-preferences');
      return res.data as NotificationPreferencesData;
    },
  });

  // Initialize local state from fetched data
  useEffect(() => {
    if (data) {
      setPrefs(data);
    }
  }, [data]);

  // Debounced save function
  const debouncedSave = useCallback(
    (updates: Partial<NotificationPreferencesData>) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(async () => {
        setError(null);
        try {
          await api.patch('/users/me/notification-preferences', updates);
          queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
        } catch (e: any) {
          setError(getApiErrorMessage(e, t, t('common:messages.saveFailed')));
        }
      }, 500);
    },
    [queryClient, t]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const updatePrefs = useCallback(
    (updates: Partial<NotificationPreferencesData>) => {
      setPrefs((prev) => {
        if (!prev) return prev;
        const newPrefs = { ...prev, ...updates };
        debouncedSave(updates);
        return newPrefs;
      });
    },
    [debouncedSave]
  );

  const updateWorkspaceSettings = useCallback(
    (
      workspace: keyof WorkspaceSettings,
      field: string,
      value: boolean
    ) => {
      setPrefs((prev) => {
        if (!prev) return prev;
        const newWorkspaceSettings = {
          ...prev.workspace_settings,
          [workspace]: {
            ...prev.workspace_settings[workspace],
            [field]: value,
          },
        };
        const updates = { workspace_settings: newWorkspaceSettings };
        debouncedSave(updates);
        return { ...prev, workspace_settings: newWorkspaceSettings };
      });
    },
    [debouncedSave]
  );

  if (isLoading) {
    return <Typography>{t('common:status.loading')}</Typography>;
  }

  if (isError || !prefs) {
    return (
      <Alert severity="error">
        {t('common:messages.loadFailedRefresh')}
      </Alert>
    );
  }

  const emailsEnabled = prefs.emails_enabled;
  // On by default (the server's defaults): an owner hears of a critical flaw unless he turns it off.
  const technologies = prefs.workspace_settings.technologies ?? { enabled: true, vulnerabilities: true };

  return (
    <Stack spacing={3}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {successMessage && (
        <Alert severity="success" sx={{ opacity: 0.9 }}>
          {successMessage}
        </Alert>
      )}

      {/* Master Toggle */}
      <Card>
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={prefs.emails_enabled}
                onChange={(e) => updatePrefs({ emails_enabled: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant="subtitle1">{t('settings:notifications.emailNotifications')}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {t('settings:notifications.emailDescription')}
                </Typography>
              </Box>
            }
          />
        </CardContent>
      </Card>

      {/* Workspace Notifications */}
      <Collapse in={emailsEnabled}>
        <Stack spacing={2}>
          {/* Portfolio Section */}
          <Card>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={prefs.workspace_settings.portfolio.enabled}
                    onChange={(e) =>
                      updateWorkspaceSettings('portfolio', 'enabled', e.target.checked)
                    }
                  />
                }
                label={
                  <Typography variant="subtitle1">{t('settings:notifications.portfolio.title')}</Typography>
                }
              />
              <Collapse in={prefs.workspace_settings.portfolio.enabled}>
                <Stack spacing={1} sx={{ ml: 4, mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.portfolio.status_changes}
                        onChange={(e) =>
                          updateWorkspaceSettings('portfolio', 'status_changes', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.portfolio.statusChanges')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.portfolio.team_additions}
                        onChange={(e) =>
                          updateWorkspaceSettings('portfolio', 'team_additions', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.portfolio.teamAdditions')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.portfolio.team_changes_as_lead ?? true}
                        onChange={(e) =>
                          updateWorkspaceSettings('portfolio', 'team_changes_as_lead', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.portfolio.teamChangesAsLead')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.portfolio.comments}
                        onChange={(e) =>
                          updateWorkspaceSettings('portfolio', 'comments', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.portfolio.comments')}</Typography>
                    }
                  />
                </Stack>
              </Collapse>
            </CardContent>
          </Card>

          {/* Tasks Section */}
          <Card>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={prefs.workspace_settings.tasks.enabled}
                    onChange={(e) =>
                      updateWorkspaceSettings('tasks', 'enabled', e.target.checked)
                    }
                  />
                }
                label={
                  <Typography variant="subtitle1">{t('settings:notifications.tasks.title')}</Typography>
                }
              />
              <Collapse in={prefs.workspace_settings.tasks.enabled}>
                <Stack spacing={1} sx={{ ml: 4, mt: 1 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {t('settings:notifications.tasks.notifyWhen')}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.tasks.as_assignee}
                        onChange={(e) =>
                          updateWorkspaceSettings('tasks', 'as_assignee', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.tasks.asAssignee')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.tasks.as_requestor}
                        onChange={(e) =>
                          updateWorkspaceSettings('tasks', 'as_requestor', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.tasks.asRequestor')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.tasks.as_viewer}
                        onChange={(e) =>
                          updateWorkspaceSettings('tasks', 'as_viewer', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Stack>
                        <Typography variant="body2">{t('settings:notifications.tasks.asViewer')}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t('settings:notifications.tasks.viewerHint')}
                        </Typography>
                      </Stack>
                    }
                  />
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="body2" color="text.secondary">
                    {t('settings:notifications.tasks.eventTypes')}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.tasks.status_changes}
                        onChange={(e) =>
                          updateWorkspaceSettings('tasks', 'status_changes', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.tasks.statusChanges')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.tasks.comments}
                        onChange={(e) =>
                          updateWorkspaceSettings('tasks', 'comments', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.tasks.comments')}</Typography>
                    }
                  />
                </Stack>
              </Collapse>
            </CardContent>
          </Card>

          {/* Budget Section */}
          <Card>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={prefs.workspace_settings.budget.enabled}
                    onChange={(e) =>
                      updateWorkspaceSettings('budget', 'enabled', e.target.checked)
                    }
                  />
                }
                label={
                  <Typography variant="subtitle1">{t('settings:notifications.budget.title')}</Typography>
                }
              />
              <Collapse in={prefs.workspace_settings.budget.enabled}>
                <Stack spacing={1} sx={{ ml: 4, mt: 1 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.budget.expiration_warnings}
                        onChange={(e) =>
                          updateWorkspaceSettings('budget', 'expiration_warnings', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.budget.expirationWarnings')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.budget.status_changes}
                        onChange={(e) =>
                          updateWorkspaceSettings('budget', 'status_changes', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.budget.statusChanges')}</Typography>
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={prefs.workspace_settings.budget.comments}
                        onChange={(e) =>
                          updateWorkspaceSettings('budget', 'comments', e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">{t('settings:notifications.budget.comments')}</Typography>
                    }
                  />
                </Stack>
              </Collapse>
            </CardContent>
          </Card>

          {/* Technologies Section: shown while the vulnerability feed is on */}
          {config.features.vulnerabilityFeed && (
            <Card>
              <CardContent>
                <FormControlLabel
                  control={
                    <Switch
                      checked={technologies.enabled}
                      onChange={(e) =>
                        updateWorkspaceSettings('technologies', 'enabled', e.target.checked)
                      }
                    />
                  }
                  label={
                    <Typography variant="subtitle1">{t('settings:notifications.technologies.title')}</Typography>
                  }
                />
                <Collapse in={technologies.enabled}>
                  <Stack spacing={1} sx={{ ml: 4, mt: 1 }}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={technologies.vulnerabilities}
                          onChange={(e) =>
                            updateWorkspaceSettings('technologies', 'vulnerabilities', e.target.checked)
                          }
                          size="small"
                        />
                      }
                      label={
                        <Typography variant="body2">{t('settings:notifications.technologies.vulnerabilities')}</Typography>
                      }
                    />
                  </Stack>
                </Collapse>
              </CardContent>
            </Card>
          )}

          {/* Weekly Review Section */}
          <Card>
            <CardContent>
              <FormControlLabel
                control={
                  <Switch
                    checked={prefs.weekly_review_enabled}
                    onChange={(e) => updatePrefs({ weekly_review_enabled: e.target.checked })}
                  />
                }
                label={
                  <Box>
                    <Typography variant="subtitle1">{t('settings:notifications.weeklyReview.title')}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t('settings:notifications.weeklyReview.description')}
                    </Typography>
                  </Box>
                }
              />
              <Collapse in={prefs.weekly_review_enabled}>
                <Stack spacing={2} sx={{ ml: 4, mt: 2 }}>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <FormControl size="small" sx={{ minWidth: 140 }}>
                      <InputLabel>{t('settings:notifications.weeklyReview.day')}</InputLabel>
                      <Select
                        value={prefs.weekly_review_day}
                        label={t('settings:notifications.weeklyReview.day')}
                        onChange={(e) =>
                          updatePrefs({ weekly_review_day: e.target.value as number })
                        }
                      >
                        {dayOptions.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 100 }}>
                      <InputLabel>{t('settings:notifications.weeklyReview.time')}</InputLabel>
                      <Select
                        value={prefs.weekly_review_hour}
                        label={t('settings:notifications.weeklyReview.time')}
                        onChange={(e) =>
                          updatePrefs({ weekly_review_hour: e.target.value as number })
                        }
                      >
                        {HOUR_OPTIONS.map((opt) => (
                          <MenuItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Stack>
                  <FormControl size="small" sx={{ maxWidth: 240 }}>
                    <InputLabel>{t('settings:notifications.weeklyReview.timezone')}</InputLabel>
                    <Select
                      value={prefs.timezone}
                      label={t('settings:notifications.weeklyReview.timezone')}
                      onChange={(e) => updatePrefs({ timezone: e.target.value })}
                    >
                      {COMMON_TIMEZONES.map((tz) => (
                        <MenuItem key={tz} value={tz}>
                          {tz.replace(/_/g, ' ')}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SendIcon />}
                    onClick={sendTestEmail}
                    disabled={sendingTest}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {sendingTest ? t('settings:notifications.weeklyReview.sending') : t('settings:notifications.weeklyReview.previewEmail')}
                  </Button>
                </Stack>
              </Collapse>
            </CardContent>
          </Card>
        </Stack>
      </Collapse>
    </Stack>
  );
}

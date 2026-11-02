import { useCallback, useEffect, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { SUPPORTED_LANGUAGES } from '../../i18n';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

export default function ProfileTab() {
  const { t } = useTranslation(['common', 'settings']);
  const { hasLevel, isAuthenticating, profile, refreshMe } = useAuth();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [selectedLocale, setSelectedLocale] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSucceeded, setSaveSucceeded] = useState(false);

  const hasAnyPortfolioReader = (
    hasLevel('tasks', 'reader') ||
    hasLevel('portfolio_requests', 'reader') ||
    hasLevel('portfolio_projects', 'reader') ||
    hasLevel('portfolio_planning', 'reader') ||
    hasLevel('portfolio_reports', 'reader') ||
    hasLevel('portfolio_settings', 'reader')
  );

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setJobTitle(profile.job_title || '');
      setBusinessPhone(profile.business_phone || '');
      setMobilePhone(profile.mobile_phone || '');
      setSelectedLocale(profile.locale || '');
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!profile?.id) return;
    setSaving(true);
    setError(null);
    setSaveSucceeded(false);

    try {
      await api.patch('/users/me', {
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        job_title: jobTitle.trim() || null,
        business_phone: businessPhone.trim() || null,
        mobile_phone: mobilePhone.trim() || null,
        locale: selectedLocale || null,
      });
      await refreshMe();
      setSaveSucceeded(true);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('settings:profile.messages.saveFailed')));
    } finally {
      setSaving(false);
    }
  }, [profile?.id, firstName, lastName, jobTitle, businessPhone, mobilePhone, selectedLocale, refreshMe, t]);

  const handleReset = useCallback(() => {
    if (profile) {
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setJobTitle(profile.job_title || '');
      setBusinessPhone(profile.business_phone || '');
      setMobilePhone(profile.mobile_phone || '');
      setSelectedLocale(profile.locale || '');
    }
    setSaveSucceeded(false);
    setError(null);
  }, [profile]);

  const handleLocaleChange = useCallback((event: SelectChangeEvent<string>) => {
    setSelectedLocale(event.target.value);
  }, []);

  if (isAuthenticating || !profile) {
    return <Typography>{t('common:status.loading')}</Typography>;
  }

  return (
    <Stack spacing={3}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {saveSucceeded && (
        <Alert severity="success" onClose={() => setSaveSucceeded(false)}>
          {t('settings:profile.messages.saveSuccess')}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>
            {t('settings:profile.sections.accountInformation')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('common:labels.email')}: {profile.email}
          </Typography>

          <Stack spacing={2}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('settings:profile.fields.firstName')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                fullWidth
              />
              <TextField
                label={t('settings:profile.fields.lastName')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                fullWidth
              />
            </Stack>

            <TextField
              label={t('settings:profile.fields.jobTitle')}
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              fullWidth
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label={t('settings:profile.fields.businessPhone')}
                value={businessPhone}
                onChange={(e) => setBusinessPhone(e.target.value)}
                fullWidth
                placeholder={t('settings:profile.placeholders.businessPhone')}
              />
              <TextField
                label={t('settings:profile.fields.mobilePhone')}
                value={mobilePhone}
                onChange={(e) => setMobilePhone(e.target.value)}
                fullWidth
                placeholder={t('settings:profile.placeholders.mobilePhone')}
              />
            </Stack>

            <FormControl fullWidth>
              <InputLabel id="profile-language-label">
                {t('settings:profile.fields.language')}
              </InputLabel>
              <Select
                labelId="profile-language-label"
                value={selectedLocale}
                displayEmpty
                label={t('settings:profile.fields.language')}
                onChange={handleLocaleChange}
                renderValue={(value) => {
                  if (!value) {
                    return t('settings:profile.locale.autoDetect')
                  }
                  return SUPPORTED_LANGUAGES.find((language) => language.code === value)?.nativeLabel ?? value
                }}
              >
                <MenuItem value="">
                  {t('settings:profile.locale.autoDetect')}
                </MenuItem>
                {SUPPORTED_LANGUAGES.map((language) => (
                  <MenuItem key={language.code} value={language.code}>
                    {language.nativeLabel}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1}>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? t('common:status.saving') : t('common:buttons.saveChanges')}
        </Button>
        <Button variant="outlined" onClick={handleReset} disabled={saving}>
          {t('common:buttons.reset')}
        </Button>
      </Stack>

      {hasAnyPortfolioReader && (
        <Card>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              {t('settings:profile.sections.portfolioContributor')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('settings:profile.messages.portfolioDescription')}
            </Typography>
            <Box>
              <Link
                component={RouterLink}
                to="/portfolio/contributors/me"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
              >
                {t('settings:profile.actions.viewContributorProfile')}
                <ArrowForwardIcon fontSize="small" />
              </Link>
            </Box>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

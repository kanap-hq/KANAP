import React from 'react';
import {
  Box,
  Button,
  TextField,
  Stack,
  Typography,
  Stepper,
  Step,
  StepLabel,
  Checkbox,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Alert,
} from '@mui/material';
import DateEUField from '../../../components/fields/DateEUField';
import api from '../../../api';
import { KanapDialog, PropertyRow } from '../../../components/design';
import { drawerFieldValueSx } from '../../../theme/formSx';

import { useTranslation } from 'react-i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
interface InterfaceForMigration {
  id: string;
  name: string | null;
  interface_reference?: string | null;
  interface_id?: string | null;
  lifecycle: string;
  source_app_name: string | null;
  target_app_name: string | null;
  app_role: 'source' | 'target' | 'both' | 'via_middleware';
}

interface SourceApp {
  id: string;
  name: string;
  version?: string | null;
}

interface CreateVersionDialogProps {
  open: boolean;
  onClose: () => void;
  sourceApp: SourceApp;
  onSuccess: (newApp: any) => void;
}

export default function CreateVersionDialog({ open, onClose, sourceApp, onSuccess }: CreateVersionDialogProps) {
  const { t } = useTranslation(['it', 'common']);
  const steps = [
    t('components.createVersion.steps.versionDetails'),
    t('components.createVersion.steps.copyOptions'),
    t('components.createVersion.steps.interfaces'),
  ];
  const [step, setStep] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [interfaces, setInterfaces] = React.useState<InterfaceForMigration[]>([]);
  const [interfacesLoading, setInterfacesLoading] = React.useState(false);

  // Form state - Step 1
  const [name, setName] = React.useState('');
  const [version, setVersion] = React.useState('');
  const [goLiveDate, setGoLiveDate] = React.useState<string>('');
  const [endOfSupportDate, setEndOfSupportDate] = React.useState<string>('');

  // Form state - Step 2
  const [copyOptions, setCopyOptions] = React.useState({
    copyOwners: true,
    copyCompanies: true,
    copyDepartments: true,
    copyDataResidency: true,
    copyLinks: true,
    copySupportContacts: true,
    copySpendItems: true,
    copyCapexItems: true,
    copyContracts: true,
    copyInstances: false,
    copyBindings: false,
  });

  // Form state - Step 3
  const [selectedInterfaceIds, setSelectedInterfaceIds] = React.useState<string[]>([]);

  // Reset form when dialog opens
  React.useEffect(() => {
    if (open) {
      setStep(0);
      setError(null);
      setName(t('components.createVersion.defaultName', { name: sourceApp.name }));
      setVersion('');
      setGoLiveDate('');
      setEndOfSupportDate('');
      setCopyOptions({
        copyOwners: true,
        copyCompanies: true,
        copyDepartments: true,
        copyDataResidency: true,
        copyLinks: true,
        copySupportContacts: true,
        copySpendItems: true,
        copyCapexItems: true,
        copyContracts: true,
        copyInstances: false,
        copyBindings: false,
      });
      setSelectedInterfaceIds([]);
      setInterfaces([]);
    }
  }, [open, sourceApp.name, t]);

  // Load interfaces when reaching step 3
  React.useEffect(() => {
    if (open && step === 2 && interfaces.length === 0) {
      setInterfacesLoading(true);
      api.get(`/applications/${sourceApp.id}/interfaces-for-migration`)
        .then(res => setInterfaces(res.data || []))
        .catch(() => setInterfaces([]))
        .finally(() => setInterfacesLoading(false));
    }
  }, [open, step, sourceApp.id, interfaces.length]);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError(t('components.createVersion.nameRequired'));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await api.post(`/applications/${sourceApp.id}/create-version`, {
        name: name.trim(),
        version: version.trim() || undefined,
        go_live_date: goLiveDate || undefined,
        end_of_support_date: endOfSupportDate || undefined,
        ...copyOptions,
        interfaceIds: selectedInterfaceIds,
      });
      onSuccess(result.data);
      onClose();
    } catch (err: any) {
      setError(getApiErrorMessage(err, t, t('messages.createVersionFailed')));
    } finally {
      setLoading(false);
    }
  };

  const toggleInterface = (id: string) => {
    setSelectedInterfaceIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAllInterfaces = () => {
    setSelectedInterfaceIds(interfaces.map(i => i.id));
  };

  const deselectAllInterfaces = () => {
    setSelectedInterfaceIds([]);
  };

  const copyOptionRows: Array<{
    key: keyof typeof copyOptions;
    label: string;
    disabled?: boolean;
    indent?: boolean;
    onChange?: (checked: boolean) => void;
  }> = [
    { key: 'copyOwners', label: t('components.createVersion.copyOwners') },
    { key: 'copyCompanies', label: t('components.createVersion.copyCompanies') },
    { key: 'copyDepartments', label: t('components.createVersion.copyDepartments') },
    { key: 'copyDataResidency', label: t('components.createVersion.copyDataResidency') },
    { key: 'copyLinks', label: t('components.createVersion.copyLinks') },
    { key: 'copySupportContacts', label: t('components.createVersion.copySupportContacts') },
    {
      key: 'copySpendItems',
      label: t('components.createVersion.copyBudgetItems'),
      onChange: (checked) => setCopyOptions({ ...copyOptions, copySpendItems: checked, copyCapexItems: checked }),
    },
    { key: 'copyContracts', label: t('components.createVersion.copyContracts') },
    {
      key: 'copyInstances',
      label: t('components.createVersion.copyInstances'),
      onChange: (checked) => setCopyOptions({
        ...copyOptions,
        copyInstances: checked,
        copyBindings: checked ? copyOptions.copyBindings : false,
      }),
    },
    { key: 'copyBindings', label: t('components.createVersion.copyBindings'), disabled: !copyOptions.copyInstances, indent: true },
  ];

  return (
    <KanapDialog
      open={open}
      onClose={onClose}
      title={t('components.createVersion.dialogTitle')}
      onSave={() => {
        if (step < 2) {
          setStep(step + 1);
          return;
        }
        void handleCreate();
      }}
      saveLabel={step < 2 ? t('components.createVersion.next') : t('components.createVersion.createVersion')}
      saveDisabled={step === 2 && !name.trim()}
      saveLoading={step === 2 && loading}
      sx={{ maxWidth: 720 }}
      footerLeft={step > 0 ? (
        <Button variant="action" onClick={() => setStep(step - 1)} disabled={loading}>
          {t('components.createVersion.back')}
        </Button>
      ) : null}
    >
        <Stepper
          activeStep={step}
          sx={(theme) => ({
            mb: 3,
            '& .MuiStepLabel-label': {
              fontSize: 12,
              fontWeight: 400,
              color: theme.palette.kanap.text.secondary,
            },
            '& .MuiStepLabel-label.Mui-active': {
              fontWeight: 500,
              color: theme.palette.kanap.text.primary,
            },
            '& .MuiStepIcon-root': {
              width: 18,
              height: 18,
            },
          })}
        >
          {steps.map(label => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {step === 0 && (
          <Stack spacing={1.35}>
            <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary, mb: 0.5 })}>
              {t('components.createVersion.creatingVersionOf')} <Box component="span" sx={(theme) => ({ fontWeight: 500, color: theme.palette.kanap.text.primary })}>{sourceApp.name}</Box>
              {sourceApp.version && ` (${sourceApp.version})`}
            </Typography>
            <PropertyRow label={t('components.createVersion.applicationName')} required>
              <TextField
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                fullWidth
                variant="standard"
                sx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('components.createVersion.version')}>
              <TextField
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder={t('components.createVersion.versionPlaceholder')}
                fullWidth
                variant="standard"
                sx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('components.createVersion.goLiveDate')}>
              <DateEUField
                label=""
                valueYmd={goLiveDate}
                onChangeYmd={setGoLiveDate}
                hideLabel
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
            <PropertyRow label={t('components.createVersion.endOfSupportDate')}>
              <DateEUField
                label=""
                valueYmd={endOfSupportDate}
                onChangeYmd={setEndOfSupportDate}
                hideLabel
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
          </Stack>
        )}

        {step === 1 && (
          <Stack spacing={1}>
            <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary, mb: 0.5 })}>
              {t('components.createVersion.selectWhatToCopy')}
            </Typography>
            {copyOptionRows.map((row) => (
              <Box
                component="label"
                key={row.key}
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  pl: row.indent ? '24px' : 0,
                  fontSize: 13,
                  color: row.disabled ? theme.palette.kanap.text.tertiary : theme.palette.kanap.text.primary,
                })}
              >
                <input
                  type="checkbox"
                  checked={!!copyOptions[row.key]}
                  disabled={row.disabled}
                  onChange={(e) => {
                    if (row.onChange) {
                      row.onChange(e.target.checked);
                    } else {
                      setCopyOptions({ ...copyOptions, [row.key]: e.target.checked });
                    }
                  }}
                  style={{ accentColor: 'var(--kanap-teal)' }}
                />
                {row.label}
              </Box>
            ))}
            {copyOptions.copyBindings && (
              <Typography sx={(theme) => ({ ml: 3, fontSize: 12, color: theme.palette.kanap.text.secondary })}>
                {t('components.createVersion.bindingsHint')}
              </Typography>
            )}
            <Typography sx={(theme) => ({ mt: 1, fontSize: 12, color: theme.palette.kanap.text.secondary })}>
              {t('components.createVersion.suitesNotCopied')}
            </Typography>
          </Stack>
        )}

        {step === 2 && (
          <Stack spacing={2}>
            <Typography sx={(theme) => ({ fontSize: 13, color: theme.palette.kanap.text.secondary })}>
              {t('components.createVersion.selectInterfaces')}
            </Typography>

            {interfacesLoading ? (
              <Stack alignItems="center" py={4}>
                <CircularProgress size={24} />
                <Typography sx={(theme) => ({ mt: 1, fontSize: 13, color: theme.palette.kanap.text.secondary })}>
                  {t('components.createVersion.loadingInterfaces')}
                </Typography>
              </Stack>
            ) : interfaces.length === 0 ? (
              <Typography sx={(theme) => ({ py: 2, fontSize: 13, color: theme.palette.kanap.text.secondary })}>
                {t('components.createVersion.noInterfaces')}
              </Typography>
            ) : (
              <>
                <Stack direction="row" spacing={1}>
                  <Button variant="action" size="small" onClick={selectAllInterfaces}>{t('components.createVersion.selectAll')}</Button>
                  <Button variant="action" size="small" onClick={deselectAllInterfaces}>{t('components.createVersion.deselectAll')}</Button>
                  <Typography sx={(theme) => ({ ml: 'auto', alignSelf: 'center', fontSize: 12, color: theme.palette.kanap.text.secondary })}>
                    {t('components.createVersion.selectedOf', { count: selectedInterfaceIds.length, total: interfaces.length })}
                  </Typography>
                </Stack>
                <List dense sx={(theme) => ({ maxHeight: 300, overflow: 'auto', border: `1px solid ${theme.palette.kanap.border.soft}`, borderRadius: '6px' })}>
                  {interfaces.map(iface => {
                    const isMiddleware = iface.app_role === 'via_middleware';
                    const roleLabel = iface.app_role === 'both'
                      ? t('components.createVersion.sourceTarget')
                      : iface.app_role === 'target'
                        ? t('components.createVersion.roleTarget')
                        : t('components.createVersion.roleSource');
                    const route = { source: iface.source_app_name || '?', target: iface.target_app_name || '?' };
                    return (
                      <ListItem key={iface.id} disablePadding>
                        <ListItemButton onClick={() => toggleInterface(iface.id)}>
                          <ListItemIcon>
                            <Checkbox
                              edge="start"
                              checked={selectedInterfaceIds.includes(iface.id)}
                              tabIndex={-1}
                              disableRipple
                            />
                          </ListItemIcon>
                          <ListItemText
                            primary={iface.name || iface.interface_reference || iface.interface_id}
                            secondary={
                              isMiddleware
                                ? t('components.createVersion.flowsThroughAs', route)
                                : t('components.createVersion.asRole', { ...route, role: roleLabel })
                            }
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
                {interfaces.some(i => i.app_role === 'via_middleware') && (
                  <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary })}>
                    {t('components.createVersion.middlewareHint')}
                  </Typography>
                )}
              </>
            )}
          </Stack>
        )}
    </KanapDialog>
  );
}

import React from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, IconButton, Typography } from '@mui/material';
import type { Theme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import WorkOutlineIcon from '@mui/icons-material/WorkOutline';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { KanapDialog } from '../design';
import {
  holdsSampleData,
  onboardingApi,
  ONBOARDING_ANGLES,
  type OnboardingAngle,
  type OnboardingChoice,
  type OnboardingMode,
  type OnboardingState,
} from './onboardingApi';

const ANGLE_ICONS: Record<OnboardingAngle, React.ElementType> = {
  budget: AccountBalanceWalletOutlinedIcon,
  cartography: HubOutlinedIcon,
  portfolio: WorkOutlineIcon,
};

const MODE_ICONS: Record<OnboardingMode, React.ElementType> = {
  example: ExploreOutlinedIcon,
  own_data: UploadFileOutlinedIcon,
};

type Screen = 'angle' | 'mode';

type Conflict = { count: number; choice: OnboardingChoice };

/** The 409 of a mode change that would erase objects created since the sample data was loaded. */
function sampleDataModified(error: unknown): number | null {
  const response = (error as { response?: { status?: number; data?: { code?: string; created_since_load?: number } } })?.response;
  if (response?.status !== 409 || response.data?.code !== 'sample_data_modified') return null;
  return Number(response.data.created_since_load ?? 0);
}

const optionSx = (selected: boolean) => (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  width: '100%',
  minHeight: 56,
  px: 1.75,
  py: 1.25,
  textAlign: 'left',
  font: 'inherit',
  cursor: 'pointer',
  borderRadius: '8px',
  border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.kanap.border.default}`,
  bgcolor: theme.palette.kanap.bg.primary,
  color: theme.palette.kanap.text.primary,
  transition: 'background-color 120ms ease, border-color 120ms ease',
  '&:hover': { bgcolor: theme.palette.kanap.bg.hover, borderColor: theme.palette.primary.main },
  '&:focus-visible': { outline: 'none', borderColor: theme.palette.primary.main, boxShadow: `0 0 0 1px ${theme.palette.primary.main}` },
  '&:disabled': { cursor: 'default', opacity: 0.6 },
});

function Option({ icon: Icon, label, note, selected, disabled, onClick }: {
  icon: React.ElementType;
  label: string;
  note?: string | null;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Box component="button" type="button" onClick={onClick} disabled={disabled} sx={optionSx(selected)}>
      <Icon aria-hidden sx={{ fontSize: 20, color: 'text.secondary', flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 14, fontWeight: 500 }}>{label}</Typography>
        {note ? <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: '2px' }}>{note}</Typography> : null}
      </Box>
    </Box>
  );
}

/**
 * The onboarding question, one per screen: what brings you (three paths, or "just looking"),
 * then explore the sample data or start with your own data. One answer is one click; the choice
 * is sent once, at the end. "Start with my own data" is not offered to a user who is not an
 * administrator while the workspace holds sample data (the API refuses it). A change that would
 * also erase objects created since the sample data was loaded asks first.
 */
export default function OnboardingChoiceDialog({ open, state, onClose, onChosen }: {
  open: boolean;
  state: OnboardingState;
  onClose: () => void;
  onChosen: (state: OnboardingState) => void;
}) {
  const { t } = useTranslation(['common', 'admin', 'errors']);
  const { claims } = useAuth();
  const isAdministrator = claims?.isGlobalAdmin === true;
  const angleOpen = state.angle === null || isAdministrator;
  const [screen, setScreen] = React.useState<Screen>(angleOpen ? 'angle' : 'mode');
  const [angle, setAngle] = React.useState<OnboardingAngle | null>(state.angle);
  const [conflict, setConflict] = React.useState<Conflict | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setScreen(angleOpen ? 'angle' : 'mode');
    setAngle(state.angle);
    setConflict(null);
    // Each opening starts from the workspace's answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const choose = useMutation({
    mutationFn: onboardingApi.choose,
    onSuccess: (next) => { setConflict(null); onChosen(next); },
    onError: (error, choice) => {
      const count = sampleDataModified(error);
      if (count !== null) setConflict({ count, choice });
    },
  });

  const modeOpen = state.mode === null || isAdministrator;
  const offerOwnData = isAdministrator || !holdsSampleData(state);

  const submit = (mode: OnboardingMode | null, nextAngle: OnboardingAngle | null) => {
    const choice: OnboardingChoice = {};
    if (nextAngle && nextAngle !== state.angle) choice.angle = nextAngle;
    if (mode && mode !== state.mode) choice.mode = mode;
    if (!choice.angle && !choice.mode) { onClose(); return; }
    choose.mutate(choice);
  };

  const pickAngle = (next: OnboardingAngle | null) => {
    setAngle(next);
    choose.reset();
    if (modeOpen) setScreen('mode');
    else submit(null, next);
  };

  const busy = choose.isPending;
  const error = choose.error && sampleDataModified(choose.error) === null
    ? getApiErrorMessage(choose.error, t, t('common:onboarding.choice.failed'))
    : null;

  const title = screen === 'angle' ? t('common:onboarding.choice.angleTitle') : t('common:onboarding.choice.modeTitle');

  return (
    <>
      <Dialog
        open={open && !conflict}
        onClose={busy ? undefined : onClose}
        fullWidth
        maxWidth={false}
        BackdropProps={{
          sx: (theme: Theme) => ({ bgcolor: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.65)' : 'rgba(15, 17, 23, 0.45)' }),
        }}
        PaperProps={{
          'aria-labelledby': 'onboarding-choice-title',
          sx: (theme: Theme) => ({
            width: '100%',
            maxWidth: 520,
            m: 2,
            bgcolor: theme.palette.kanap.bg.primary,
            borderRadius: '8px',
            border: `0.5px solid ${theme.palette.kanap.border.default}`,
            boxShadow: 'none',
            backgroundImage: 'none',
          }),
        } as object}
      >
        <Box sx={(theme) => ({ display: 'flex', alignItems: 'center', gap: 1, px: '20px', py: '16px', borderBottom: `1px solid ${theme.palette.kanap.border.default}` })}>
          <Typography id="onboarding-choice-title" component="h2" sx={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 500, m: 0 }}>
            {title}
          </Typography>
          {busy ? <CircularProgress size={16} thickness={5} aria-hidden /> : null}
          <IconButton aria-label={t('common:labels.closeDialog')} onClick={onClose} size="small" disabled={busy}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box sx={{ px: '20px', py: '18px', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {error ? <Alert severity="error" sx={{ mb: 0.5 }}>{error}</Alert> : null}
          {screen === 'angle' ? (
            ONBOARDING_ANGLES.map((key) => (
              <Option
                key={key}
                icon={ANGLE_ICONS[key]}
                label={t(`common:onboarding.angles.${key}`)}
                selected={angle === key}
                disabled={busy}
                onClick={() => pickAngle(key)}
              />
            ))
          ) : (
            (['example', 'own_data'] as const)
              .filter((key) => key === 'example' || offerOwnData)
              .map((key) => (
                <Option
                  key={key}
                  icon={MODE_ICONS[key]}
                  label={t(`common:onboarding.modes.${key}`)}
                  note={key === 'own_data' && holdsSampleData(state) ? t('common:onboarding.choice.erasesExample') : null}
                  selected={state.mode === key}
                  disabled={busy}
                  onClick={() => submit(key, angle)}
                />
              ))
          )}
        </Box>

        {(screen === 'angle' && state.angle === null) || (screen === 'mode' && angleOpen) ? (
          <Box sx={(theme) => ({ display: 'flex', px: '20px', py: '12px', borderTop: `1px solid ${theme.palette.kanap.border.soft}` })}>
            {screen === 'angle' ? (
              <Button variant="action" onClick={() => pickAngle(null)} disabled={busy}>
                {t('common:onboarding.choice.justLooking')}
              </Button>
            ) : (
              <Button variant="action" onClick={() => { choose.reset(); setScreen('angle'); }} disabled={busy}>
                {t('common:buttons.back')}
              </Button>
            )}
          </Box>
        ) : null}
      </Dialog>

      <KanapDialog
        open={open && !!conflict}
        title={t('common:onboarding.choice.confirmTitle')}
        onClose={() => { setConflict(null); choose.reset(); }}
        onSave={() => { if (conflict) choose.mutate({ ...conflict.choice, confirm_reset: true }); }}
        saveLabel={t('admin:sampleData.actions.eraseAll')}
        saveVariant="action-danger"
        saveLoading={busy}
      >
        {choose.error && sampleDataModified(choose.error) === null ? (
          <Alert severity="error" sx={{ mb: 1.5 }}>{getApiErrorMessage(choose.error, t, t('common:onboarding.choice.failed'))}</Alert>
        ) : null}
        <Typography variant="body2">
          {t('admin:sampleData.resetDialog.createdSinceLoad', { count: conflict?.count ?? 0 })}
        </Typography>
      </KanapDialog>
    </>
  );
}

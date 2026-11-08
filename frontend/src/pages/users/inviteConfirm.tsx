import React from 'react';
import { Box, Radio, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { FieldLabel, useKanapDialogs } from '../../components/design';

/** How the invited person will sign in. Asked only in a workspace with Microsoft Entra sign-in. */
export type InviteSignIn = 'microsoft' | 'password';

/** A confirmed invitation: `signIn` is set when the choice was asked. Null when cancelled. */
export type InviteChoice = { signIn?: InviteSignIn } | null;

const SIGN_IN_CHOICES: InviteSignIn[] = ['microsoft', 'password'];

function SignInChoice({ onChange }: { onChange: (value: InviteSignIn) => void }) {
  const { t } = useTranslation(['admin']);
  const [value, setValue] = React.useState<InviteSignIn>('microsoft');
  const labelId = React.useId();
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 2 }}>
      <FieldLabel>
        <span id={labelId}>{t('users.invite.signIn')}</span>
      </FieldLabel>
      <Box role="radiogroup" aria-labelledby={labelId} sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2.5 }}>
        {SIGN_IN_CHOICES.map((choice) => (
          <Box key={choice} component="label" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, cursor: 'pointer' }}>
            <Radio
              size="small"
              checked={value === choice}
              onChange={() => { setValue(choice); onChange(choice); }}
              value={choice}
              name="invite-sign-in"
              sx={{ p: 0.25 }}
            />
            <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.primary', lineHeight: 1.4 }}>
              {t(choice === 'microsoft' ? 'users.invite.withMicrosoft' : 'users.invite.withPassword')}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Asks before invitations go out. One recipient is named, several are a count. In a workspace with
 * Microsoft Entra sign-in the dialog also asks how they will sign in (Microsoft first); elsewhere
 * an invitation is the password link, with no choice.
 */
export function useInviteConfirm() {
  const { t } = useTranslation(['admin']);
  const dialogs = useKanapDialogs();
  const { tenantAuth } = useAuth();
  const entraSignIn = tenantAuth?.sso_provider === 'entra' && !!tenantAuth?.sso_enabled;

  return React.useCallback(async (emails: string[]): Promise<InviteChoice> => {
    const question = t('users.messages.inviteConfirm', {
      count: emails.length,
      ...(emails.length === 1 ? { email: emails[0] ?? '' } : {}),
    });
    const confirmLabel = t('users.actions.sendInvite');
    if (!entraSignIn) {
      return (await dialogs.confirm({ message: question, confirmLabel })) ? {} : null;
    }
    let signIn: InviteSignIn = 'microsoft';
    const okToGo = await dialogs.confirm({
      message: (
        <>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{question}</Typography>
          <SignInChoice onChange={(value) => { signIn = value; }} />
        </>
      ),
      confirmLabel,
    });
    return okToGo ? { signIn } : null;
  }, [dialogs, entraSignIn, t]);
}

/** Sends one invitation as confirmed. */
export function postInvite(userId: string, choice: NonNullable<InviteChoice>) {
  const url = `/users/${userId}/invite`;
  return choice.signIn ? api.post(url, { sign_in: choice.signIn }) : api.post(url);
}

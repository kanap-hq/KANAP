import React from 'react';
import { Box, Button, FormControlLabel, Link, Stack, Switch, TextField, Typography, useTheme } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useTranslation } from 'react-i18next';
import { StatusDot, unsavedConfirm, useKanapDialogs } from '../design';
import InfoHint from '../workspace/InfoHint';
import { useLeaveGuard } from '../../hooks/leaveGuard';
import { useLocale } from '../../i18n/useLocale';
import { formatShortInstantDate } from '../../lib/dateFormat';
import { getDotColor } from '../../utils/statusColors';
import { SettingField } from './SettingField';

/** A connection test as the card shows it: stored on the saved values, or run in this session. */
export type ConnectionTest = {
  ok: boolean;
  /** ISO instant of the test. */
  tested_at: string;
  /** A failure run in this session: its cause, in one translated sentence. */
  cause?: string;
  /** A success run in this session: what the system answered ("PRTG 24.1, 321 sensors visible"). */
  detail?: string;
};

/** A status line the card cannot derive from its props, shown as given (a disconnected account). */
export type ConnectionStatus = {
  tone: 'success' | 'neutral' | 'progress' | 'danger';
  text: string;
};

/** What the fields need from the card: `locked` when the values are not changeable here. */
export type ConnectionCardFields = { locked: boolean };

export interface ConnectionCardProps {
  /** The system's name, on the left. */
  title: string;
  /** What the connection is for, in a tooltip beside the name. */
  hint?: string;
  /** A connection is saved: an untested card says "Saved, not tested yet" instead of "Never tested". */
  configured: boolean;
  /** Something on the card differs from what is saved: Save is on, leaving the page asks first. */
  dirty: boolean;
  /** The test kept on the saved values (after a reload). */
  storedTest?: ConnectionTest | null;
  /** The test run in this session, cleared by the card's owner when a value changes. */
  sessionTest?: ConnectionTest | null;
  /** A test is running: "Testing…". */
  testing?: boolean;
  saving?: boolean;
  /** Tries the values on screen, saved or not. Absent: no Test button. */
  onTest?: () => void;
  /** Test cannot run on the values on screen (a secret to enter again). */
  testDisabled?: boolean;
  onSave?: () => void;
  /** Save cannot run although something changed (a secret to enter again). */
  saveDisabled?: boolean;
  /**
   * `file`: the values come from the configuration file. A lock line at the top with
   * `fileHint`, every field read-only (`locked`), no Save and no Replace; Test stays.
   */
  source?: 'screen' | 'file';
  /** Where the file values come from and how to set them here instead (`source="file"`). */
  fileHint?: string;
  /** Replaces Save at the bottom: the card's own actions (connect, disconnect). */
  actions?: React.ReactNode;
  /** A status the card cannot derive; wins over every other state. */
  status?: ConnectionStatus;
  /** One line under the fields: a refused save, the next step after a save. */
  notice?: React.ReactNode;
  /** The connection is not loaded yet / could not be loaded: one line in place of the fields. */
  loading?: boolean;
  error?: React.ReactNode;
  /** The fields (`SettingField`, `ConnectionSecretField`), in two columns from 760 px; `gridColumn: '1 / -1'` for a full row. */
  children: React.ReactNode | ((card: ConnectionCardFields) => React.ReactNode);
}

const TONE_COLOR: Record<ConnectionStatus['tone'], string> = {
  success: 'success',
  neutral: 'default',
  progress: 'warning',
  danger: 'error',
};

function newer(a: ConnectionTest | null | undefined, b: ConnectionTest | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return Date.parse(a.tested_at) >= Date.parse(b.tested_at);
}

/**
 * The status line's state, in this order: a status given; a test running; the test run in this
 * session (on the values on screen); unsaved changes; the stored test; saved; never tested.
 */
export function connectionStatusLine(
  props: Pick<ConnectionCardProps, 'status' | 'testing' | 'sessionTest' | 'storedTest' | 'dirty' | 'configured'>,
  t: (key: string, options?: Record<string, unknown>) => string,
  locale: string,
): ConnectionStatus & { detail?: string } {
  if (props.status) return props.status;
  if (props.testing) return { tone: 'progress', text: t('common:connectionCard.status.testing') };
  const describe = (test: ConnectionTest, fresh: boolean): ConnectionStatus & { detail?: string } => {
    const at = new Date(test.tested_at);
    const when = {
      date: formatShortInstantDate(at, locale),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(at),
    };
    if (test.ok) {
      return { tone: 'success', text: t('common:connectionCard.status.passed', when), ...(fresh && test.detail ? { detail: test.detail } : {}) };
    }
    return { tone: 'danger', text: fresh && test.cause ? test.cause : t('common:connectionCard.status.failed', when) };
  };
  if (props.sessionTest && newer(props.sessionTest, props.storedTest)) return describe(props.sessionTest, true);
  if (props.dirty) return { tone: 'neutral', text: t('common:connectionCard.status.notSaved') };
  if (props.storedTest) return describe(props.storedTest, false);
  return { tone: 'neutral', text: t(props.configured ? 'common:connectionCard.status.savedNotTested' : 'common:connectionCard.status.neverTested') };
}

/**
 * A connection to an external system (design: settings-pages.md §6): a bordered card with the
 * system's name and its status line, the fields in two columns, then Test and Save at the bottom
 * left. Save is off while nothing changed; leaving the page with a changed card asks first. The
 * card is a frame: its owner holds the form, saves, tests and says what changed.
 */
export function ConnectionCard(props: ConnectionCardProps) {
  const {
    title,
    hint,
    dirty,
    testing = false,
    saving = false,
    onTest,
    testDisabled = false,
    onSave,
    saveDisabled = false,
    source = 'screen',
    fileHint,
    actions,
    notice,
    loading = false,
    error,
    children,
  } = props;
  const { t } = useTranslation(['common']);
  const theme = useTheme();
  const locale = useLocale();
  const dialogs = useKanapDialogs();
  const locked = source === 'file';
  const titleId = React.useId();

  const confirmLeave = React.useCallback(() => dialogs.confirm({
    title: t('common:autosave.leaveTitle'),
    ...unsavedConfirm(t, 'leaveWithoutSaving'),
  }), [dialogs, t]);
  useLeaveGuard(() => dirty && !locked, confirmLeave);

  const line = connectionStatusLine(props, t, locale);
  const dotColor = getDotColor(TONE_COLOR[line.tone], theme.palette.mode);
  const showBody = !loading && !error;

  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{
        border: '1px solid',
        borderColor: 'kanap.border.default',
        borderRadius: '8px',
        bgcolor: 'kanap.bg.primary',
        p: 2,
        containerType: 'inline-size',
      }}
    >
      <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap columnGap={1.25} rowGap={0.75} sx={{ mb: 1 }}>
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <Typography id={titleId} component="h2" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
            {title}
          </Typography>
          {hint && <InfoHint text={hint} />}
        </Stack>
        <Box sx={{ flex: 1 }} />
        {showBody && (
          <Stack direction="row" alignItems="center" spacing={0.75} role="status" aria-live="polite" sx={{ minWidth: 0 }}>
            <StatusDot color={dotColor} />
            <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
              {line.text}
              {line.detail ? <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` · ${line.detail}`}</Box> : null}
            </Typography>
          </Stack>
        )}
      </Stack>

      {error ? (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger' }}>{error}</Typography>
      ) : loading ? (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('common:status.loading')}</Typography>
      ) : (
        <>
          {locked && (
            <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
              <LockOutlinedIcon aria-hidden sx={{ fontSize: 14, color: 'kanap.text.tertiary' }} />
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('common:connectionCard.setInFile')}</Typography>
              {fileHint && <InfoHint text={fileHint} />}
            </Stack>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              columnGap: 2,
              '@container (min-width: 760px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            {typeof children === 'function' ? children({ locked }) : children}
          </Box>
          {notice ? <Box sx={{ mt: 1 }}>{notice}</Box> : null}
          {(onTest || (!locked && (onSave || actions))) && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
              {onTest && (
                <Button variant="action" onClick={onTest} disabled={testing || testDisabled}>
                  {t('common:connectionCard.test')}
                </Button>
              )}
              {!locked && (actions ?? (onSave && (
                <Button variant="action-primary" onClick={onSave} disabled={!dirty || saving || saveDisabled}>
                  {saving ? t('common:status.saving') : t('common:buttons.save')}
                </Button>
              )))}
            </Stack>
          )}
        </>
      )}
    </Box>
  );
}

export interface ConnectionSecretFieldProps {
  label: string;
  /** Where to find the value in the external system. */
  hint?: string;
  /** A secret is saved and still goes to the address on screen. */
  stored: boolean;
  /** The secret typed, empty to keep the saved one. */
  value: string;
  onChange: (value: string) => void;
  /** The address changed: the saved secret will be emptied, the field asks for it again. */
  addressChanged?: boolean;
  /** The card's `locked`: the saved secret only says it is set. */
  locked?: boolean;
  /** An example of the shape, for an empty field. */
  placeholder?: string;
  error?: string | null;
}

const DOTS = '••••••••••••';

/**
 * A secret of a connection (settings-pages.md §4): never read back. Saved, it shows dots, greyed,
 * with "Replace" on its right, which empties the field and opens it. Not saved, or saved for
 * another address, it is an open password field. Give it a `key` that changes after a save, so
 * that a replaced secret shows as dots again.
 */
export function ConnectionSecretField({
  label,
  hint,
  stored,
  value,
  onChange,
  addressChanged = false,
  locked = false,
  placeholder,
  error,
}: ConnectionSecretFieldProps) {
  const { t } = useTranslation(['common', 'admin']);
  const [replacing, setReplacing] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const showDots = stored && !addressChanged && (locked || !replacing);
  const shownError = error ?? (addressChanged && !value.trim() ? t('admin:integrations.secretAddressChanged') : null);

  React.useEffect(() => {
    if (replacing) inputRef.current?.focus();
  }, [replacing]);

  return (
    <SettingField label={label} hint={hint} error={shownError}>
      {({ aria, error: invalid }) => (showDots ? (
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ maxWidth: 480 }}>
          <TextField
            variant="standard"
            value={DOTS}
            disabled
            fullWidth
            inputProps={{ 'aria-label': label }}
          />
          {!locked && (
            <Link
              component="button"
              type="button"
              underline="hover"
              onClick={() => setReplacing(true)}
              aria-label={t('common:connectionCard.replaceLabel', { name: label })}
              sx={{ fontSize: 12, whiteSpace: 'nowrap' }}
            >
              {t('common:connectionCard.replace')}
            </Link>
          )}
        </Stack>
      ) : (
        <TextField
          variant="standard"
          type="password"
          autoComplete="new-password"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={addressChanged}
          error={invalid}
          fullWidth
          inputRef={inputRef}
          InputProps={{ readOnly: locked }}
          inputProps={{ 'aria-label': label, ...aria }}
          sx={{ maxWidth: 480 }}
        />
      ))}
    </SettingField>
  );
}

export interface ConnectionSwitchFieldProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The card's `locked`. */
  locked?: boolean;
}

/** A switch of a connection, left of its label on one line, across both columns. */
export function ConnectionSwitchField({ label, hint, checked, onChange, locked = false }: ConnectionSwitchFieldProps) {
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ gridColumn: '1 / -1', mb: 1 }}>
      <FormControlLabel
        sx={{ mr: 0 }}
        control={(
          <Switch
            size="small"
            checked={checked}
            disabled={locked}
            onChange={(event) => onChange(event.target.checked)}
          />
        )}
        label={<Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>{label}</Typography>}
      />
      {hint && <InfoHint text={hint} />}
    </Stack>
  );
}

/** One line under the fields: what a save did, or why it was refused. */
export function ConnectionNotice({ tone, children }: { tone: 'success' | 'error'; children: React.ReactNode }) {
  return (
    <Typography
      role={tone === 'error' ? 'alert' : 'status'}
      sx={{ fontSize: 12, color: tone === 'error' ? 'kanap.danger' : 'kanap.text.secondary' }}
    >
      {children}
    </Typography>
  );
}

/** The cause of a failed test: `errors:<code>` when the server sent one, else its English message. */
export function connectionTestCause(
  t: (key: string, options?: Record<string, unknown>) => string,
  code: string | undefined,
  message: string | undefined,
  fallback: string,
): string {
  if (code) {
    const translated = t(`errors:${code}`, { defaultValue: message || fallback });
    if (typeof translated === 'string' && translated.trim()) return translated;
  }
  return message || fallback;
}

export default ConnectionCard;

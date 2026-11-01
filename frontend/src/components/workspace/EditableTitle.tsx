import React from 'react';
import { Box, FormHelperText, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';
import { taskDetailTypography } from '../../pages/tasks/theme/taskDetailTokens';

/** Marks the pencil so the resting and hover rules can show or hide it. */
const CUE_CLASS = 'editable-title-cue';

/** Font of the resting title and of the field. Defaults to the workspace title. */
export type EditableTitleTypography = {
  fontSize: NonNullable<React.CSSProperties['fontSize']>;
  fontWeight?: React.CSSProperties['fontWeight'];
  lineHeight?: React.CSSProperties['lineHeight'];
  letterSpacing?: React.CSSProperties['letterSpacing'];
};

const workspaceTitleTypography: EditableTitleTypography = taskDetailTypography.title;

type EditableTitleDisplayProps = {
  canEdit: boolean;
  /** The text is the empty-title placeholder: dashed underline and pencil stay visible. */
  placeholder?: boolean;
  /** A stand-in title (a contact shown by its email): secondary color, no empty-title cue. */
  muted?: boolean;
  onEdit: () => void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  /** Resting size. Callers on a page header pass that header's type scale. */
  typography?: EditableTitleTypography;
  children: React.ReactNode;
};

/** Strength of the light blue of an empty title to give, fill and border. */
function emptyTint(theme: Theme) {
  return theme.palette.mode === 'dark' ? { fill: 0.16, border: 0.4 } : { fill: 0.08, border: 0.25 };
}

function titleColor(theme: Theme, placeholder: boolean, muted: boolean) {
  if (placeholder) return theme.palette.kanap.text.tertiary;
  if (muted) return theme.palette.kanap.text.secondary;
  return 'inherit';
}

/**
 * The resting record title. Read only, it is plain text. An empty title keeps a dashed
 * underline and a pencil. A saved title shows that pencil, and a hover background, only
 * while the pointer is over it or the keyboard is on it.
 */
export function EditableTitleDisplay({
  canEdit,
  placeholder = false,
  muted = false,
  onEdit,
  buttonRef,
  typography = workspaceTitleTypography,
  children,
}: EditableTitleDisplayProps) {
  const { t } = useTranslation();
  const text = (
    <Box
      component="span"
      sx={(theme) => ({
        // The saved title keeps a transparent border so naming an empty record does not shift the line.
        borderBottom: !canEdit
          ? undefined
          : `1px ${placeholder ? 'dashed' : 'solid'} ${placeholder ? theme.palette.kanap.border.default : 'transparent'}`,
      })}
    >
      {children}
    </Box>
  );

  if (!canEdit) {
    return (
      <Typography
        component="span"
        sx={(theme) => ({
          ...typography,
          display: 'inline',
          color: titleColor(theme, placeholder, muted),
        })}
      >
        {text}
      </Typography>
    );
  }

  return (
    <Box
      component="button"
      type="button"
      ref={buttonRef}
      tabIndex={0}
      aria-label={t('common:buttons.editTitle')}
      onClick={onEdit}
      onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onEdit();
        } else if (event.key === ' ') {
          // Space activates on keyup, like a button: opening on keydown would type the space into the field.
          event.preventDefault();
        }
      }}
      onKeyUp={(event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === ' ') {
          event.preventDefault();
          onEdit();
        }
      }}
      sx={(theme) => ({
        ...typography,
        display: 'inline-block',
        maxWidth: '100%',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
        color: titleColor(theme, placeholder, muted),
        textAlign: 'left',
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        verticalAlign: 'baseline',
        cursor: 'text',
        appearance: 'none',
        bgcolor: 'transparent',
        border: 0,
        outline: 'none',
        borderRadius: '4px',
        px: '4px',
        py: '1px',
        mx: '-4px',
        my: '-1px',
        transition: 'background-color 120ms ease',
        '&:hover, &:focus': {
          bgcolor: theme.palette.kanap.bg.hover,
          outline: 'none',
        },
        '& .editable-title-cue': {
          display: placeholder ? 'inline-block' : 'none',
          marginLeft: '6px',
          verticalAlign: 'middle',
          position: 'relative',
          top: '-1px',
        },
        '&:hover .editable-title-cue, &:focus .editable-title-cue': {
          display: 'inline-block',
        },
      })}
    >
      {text}
      <EditOutlinedIcon className={CUE_CLASS} sx={{ fontSize: '14px !important', color: 'kanap.text.tertiary' }} />
    </Box>
  );
}

export type EditableTitleProps = {
  /**
   * Opens in typing state at mount: the title is the field the person came to fill (a new record).
   * While the title is still empty, a committed name stays in the field until the caller's `value`
   * arrives (the record is created), or a refusal comes back under it.
   */
  autoEdit?: boolean;
  canEdit: boolean;
  /** While typing an empty title: the light blue field of a title still to give. */
  emphasizeEmpty?: boolean;
  /** A refusal shown under the title. Hidden while a non-empty replacement is being typed. */
  error?: string | null;
  fallback: string;
  maxLength?: number;
  /** Fired on each keystroke, so the caller can drop a refusal that the draft has answered. */
  onDraftChange?: (draft: string) => void;
  /** Escape in the empty field opened by `autoEdit`: the person leaves without naming anything. */
  onCancel?: () => void;
  onSave?: (nextTitle: string) => void;
  requiredMessage?: string;
  /** Resting size. Callers on a page header pass that header's type scale. */
  typography?: EditableTitleTypography;
  value: string;
};

/** Click-to-edit record title used by the workspace shell and the task header. */
export default function EditableTitle({
  autoEdit = false,
  canEdit,
  emphasizeEmpty = false,
  error,
  fallback,
  maxLength,
  onDraftChange,
  onCancel,
  onSave,
  requiredMessage,
  typography = workspaceTitleTypography,
  value,
}: EditableTitleProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState(() => autoEdit && canEdit);
  const [draft, setDraft] = React.useState(value);
  const [emptyError, setEmptyError] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  // Enter, Escape and the blur that follows all end the edit: only the first one counts.
  const closing = React.useRef(false);
  const pendingFocus = React.useRef(false);
  // A title still to give (`autoEdit` on an empty value): the name sent to the caller, kept in the
  // field until the value arrives. The blur that follows an Enter does not send it twice.
  const pendingTitle = autoEdit && !value;
  const submitted = React.useRef<string | null>(null);

  React.useEffect(() => {
    // The caller's value arrived for the name sent: the title rests, and the focus goes to it.
    if (!editing || submitted.current === null || !value) return;
    submitted.current = null;
    closing.current = true;
    pendingFocus.current = true;
    setEditing(false);
  }, [editing, value]);

  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  React.useEffect(() => {
    if (editing || !pendingFocus.current) return;
    pendingFocus.current = false;
    buttonRef.current?.focus();
  }, [editing]);

  const open = () => {
    closing.current = false;
    pendingFocus.current = false;
    setDraft(value);
    setEmptyError(false);
    setEditing(true);
  };

  const finish = (focusButton: boolean) => {
    if (closing.current) return;
    const trimmed = draft.trim();
    if (pendingTitle) {
      // Nothing to send while empty: the field stays open for the name.
      if (trimmed && trimmed !== submitted.current) {
        submitted.current = trimmed;
        onSave?.(trimmed);
      }
      return;
    }
    if (!trimmed && requiredMessage) {
      setEmptyError(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    if (trimmed && trimmed !== value) onSave?.(trimmed);
    setEmptyError(false);
    closing.current = true;
    pendingFocus.current = focusButton;
    setEditing(false);
  };

  const cancel = () => {
    if (pendingTitle) {
      if (!draft.trim()) onCancel?.();
      else {
        // A typed name is dropped first; a second Escape leaves.
        submitted.current = null;
        setDraft('');
        onDraftChange?.('');
      }
      return;
    }
    closing.current = true;
    pendingFocus.current = true;
    setDraft(value);
    setEmptyError(false);
    setEditing(false);
  };

  // The field's own empty-commit message wins, so a refusal left over from Create is not repeated under it.
  const ownMessage = editing && emptyError && requiredMessage ? requiredMessage : null;
  // A refusal of a title still to give stays under the name it refused, until the person types.
  const externalMessage = error && (pendingTitle || !(editing && draft.trim())) ? error : null;
  const message = ownMessage || externalMessage;
  const messageNode = message
    ? <FormHelperText error role={ownMessage ? 'alert' : undefined} sx={{ mt: 0.5 }}>{message}</FormHelperText>
    : null;

  if (!editing) {
    return (
      <>
        <EditableTitleDisplay
          canEdit={canEdit}
          placeholder={!value}
          onEdit={open}
          buttonRef={buttonRef}
          typography={typography}
        >
          {value || fallback}
        </EditableTitleDisplay>
        {messageNode}
      </>
    );
  }

  return (
    <>
      <Box
        component="input"
        ref={inputRef}
        value={draft}
        aria-label={t('common:buttons.editTitle')}
        aria-invalid={emptyError || undefined}
        {...(maxLength ? { maxLength } : {})}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          const next = event.target.value;
          setDraft(next);
          setEmptyError(false);
          submitted.current = null;
          onDraftChange?.(next);
        }}
        onBlur={() => finish(false)}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
        placeholder={pendingTitle ? fallback : undefined}
        autoFocus
        sx={(theme) => ({
          font: 'inherit',
          fontSize: typography.fontSize,
          fontWeight: typography.fontWeight,
          lineHeight: typography.lineHeight,
          letterSpacing: typography.letterSpacing,
          color: 'inherit',
          bgcolor: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
          outline: 'none',
          p: 0,
          m: 0,
          // The underline spills below the line, which keeps the height of the resting title.
          mb: '-1px',
          width: '100%',
          '&::placeholder': { color: theme.palette.kanap.text.tertiary, opacity: 1 },
          // The look of a task title still to give (TaskWorkspacePage `titleBarSx`), plain once a
          // character is typed. The box keeps its size, so the text does not move. On the dark
          // background the same blue needs about twice the strength to show.
          ...(emphasizeEmpty
            ? {
              bgcolor: draft ? 'transparent' : alpha(theme.palette.info.main, emptyTint(theme).fill),
              border: `1px solid ${draft ? 'transparent' : alpha(theme.palette.info.main, emptyTint(theme).border)}`,
              borderBottomColor: draft ? theme.palette.kanap.border.default : alpha(theme.palette.info.main, emptyTint(theme).border),
              borderRadius: draft ? 0 : '6px',
              px: 1,
              py: 0.25,
              // The padding and border spill over the line: the title line keeps its height, so
              // the header does not move and the actions stay centred on it.
              my: '-3px',
              boxSizing: 'border-box',
              transition: 'border-color 120ms ease, background-color 120ms ease',
            }
            : {}),
        })}
      />
      {messageNode}
    </>
  );
}

import React, { useCallback, useContext, useEffect, useRef } from 'react';
import { Box, Button, Snackbar, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';

/** A confirmation with no Undo leaves after this long. */
export const NOTICE_MS = 4000;
/** A confirmation that can be undone leaves after this long. */
export const NOTICE_UNDO_MS = 8000;

export type NotifyOptions = {
  message: string;
  /**
   * Puts back what the action removed. The notice then offers Undo and stays
   * {@link NOTICE_UNDO_MS}. Called at most once.
   */
  undo?: () => void | Promise<void>;
  /** Teal check for a completed action, neutral mark for a piece of information. */
  tone?: 'success' | 'info';
};

type Notice = {
  id: number;
  message: string;
  undo?: () => void | Promise<void>;
  tone: 'success' | 'info';
};

type NotifyFn = (options: NotifyOptions) => void;

const NotifyContext = React.createContext<NotifyFn | null>(null);

const noopNotify: NotifyFn = () => undefined;

/** The notice appears and leaves at once. A fade would keep an empty status on screen. */
function Hold({ in: open, children }: { in?: boolean; children?: React.ReactElement }) {
  return open ? children ?? null : null;
}

/**
 * The app's one confirmation. Screens call {@link useNotify}; they do not render a Snackbar.
 * Outside the provider (a test, a public page) the call does nothing.
 */
export function useNotify(): NotifyFn {
  return useContext(NotifyContext) ?? noopNotify;
}

/**
 * One notice at a time, bottom centre, under dialogs. A new call replaces the one on screen.
 * Mounted once, in the layout.
 */
export function NotifyProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('common');
  const [notice, setNotice] = React.useState<Notice | null>(null);
  const idRef = useRef(0);
  const noticeRef = useRef<Notice | null>(null);
  const undoneId = useRef<number | null>(null);
  noticeRef.current = notice;

  const notify = useCallback<NotifyFn>((options) => {
    const message = options.message.trim();
    if (!message) return;
    idRef.current += 1;
    setNotice({
      id: idRef.current,
      message,
      undo: options.undo,
      tone: options.tone ?? 'success',
    });
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const ms = notice.undo ? NOTICE_UNDO_MS : NOTICE_MS;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, ms);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const handleUndo = () => {
    const current = noticeRef.current;
    if (!current?.undo || undoneId.current === current.id) return;
    undoneId.current = current.id;
    const undo = current.undo;
    setNotice((shown) => (shown?.id === current.id ? null : shown));
    void Promise.resolve(undo()).catch(() => undefined);
  };

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <Snackbar
        open={!!notice}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        TransitionComponent={Hold}
        transitionDuration={0}
        onClose={(_, reason) => {
          if (reason === 'clickaway') return;
          setNotice(null);
        }}
        // Under dialogs and menus (modal), above the page, the bar and the drawers.
        sx={{ zIndex: (theme) => theme.zIndex.modal - 1 }}
      >
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 1,
            maxWidth: 'min(440px, calc(100vw - 48px))',
            bgcolor: 'kanap.bg.primary',
            color: 'kanap.text.primary',
            border: '1px solid',
            borderColor: 'kanap.border.default',
            borderRadius: '8px',
            boxShadow: 1,
          }}
        >
          {notice?.tone === 'info' ? (
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary', flexShrink: 0 }} />
          ) : (
            <CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'kanap.teal', flexShrink: 0 }} />
          )}
          <Typography sx={{ fontSize: 13, fontWeight: 400, lineHeight: 1.4, flex: 1 }}>
            {notice?.message}
          </Typography>
          {notice?.undo && (
            <Button
              variant="text"
              size="small"
              onClick={handleUndo}
              sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.teal', minWidth: 0, px: 0.5, flexShrink: 0 }}
            >
              {t('buttons.undo')}
            </Button>
          )}
        </Box>
      </Snackbar>
    </NotifyContext.Provider>
  );
}

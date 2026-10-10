import React from 'react';
import { Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KanapDialog } from '../components/design';
import { namesInSentence } from '../components/finance/heldChoices';
import type { LineType } from '../constants/lineTypeUsage';
import { axisRequiredFor, type AnalyticsAxes } from './useAnalyticsAxes';

/** Marks a dimension's field on the line's Properties panel, for the focus after « Stay ». */
export const ANALYTICS_AXIS_FIELD_ATTR = 'data-analytics-axis';

type Options = {
  scope: LineType;
  /** The line of the route (its id or reference); another line starts a new visit. */
  lineId: string | null | undefined;
  /** The user may change the line. */
  canEdit: boolean;
  /** The page's dimensions (enabled ones apply to the line's type). */
  axes: Pick<AnalyticsAxes, 'enabled' | 'label'>;
  /** The values shown on the line, pending edits included, by dimension. */
  values: () => Record<string, string | null | undefined>;
  /** Holds the Properties panel. */
  root: React.RefObject<HTMLElement | null>;
};

type Asking = { names: string[]; firstAxisId: string };

/**
 * Leaving an OPEX or CAPEX line the user changed during this visit while a dimension required for
 * its type has no value asks first (lot D2). Reading a line, or a line nobody touched, never asks.
 *
 * - `noteChange()`: the user changed a field of the line shown;
 * - `isBusy()`: leaving now would ask (the page's leave guard);
 * - `confirm()`: asks; true when the user leaves anyway. « Stay » (or closing the dialog) keeps
 *   the line and focuses the first missing field, opening the Properties panel
 *   (`drawerOpenRequest` for the workspace shell);
 * - `dialog`: rendered by the page.
 *
 * A question left unanswered (the page goes, another line opens) closes as « Stay »: the move that
 * asked does not happen, and the app's leave lock (`confirmLeave`) is released.
 */
export function useRequiredDimensionsLeave({ scope, lineId, canEdit, axes, values, root }: Options) {
  const { t, i18n } = useTranslation(['ops']);
  const locale = i18n.resolvedLanguage || i18n.language || 'en';
  const changedLine = React.useRef<string | null>(null);
  const latest = React.useRef({ scope, lineId, canEdit, axes, values, root });
  latest.current = { scope, lineId, canEdit, axes, values, root };
  const [asking, setAsking] = React.useState<Asking | null>(null);
  const [drawerOpenRequest, setDrawerOpenRequest] = React.useState(0);
  // The answer of the question shown, if any.
  const pending = React.useRef<((leave: boolean) => void) | null>(null);
  const settle = React.useCallback((leave: boolean, close = true) => {
    const resolve = pending.current;
    pending.current = null;
    if (close) setAsking(null);
    resolve?.(leave);
  }, []);

  // Another line: a new visit, nothing changed yet, and a question still shown stays unanswered.
  React.useEffect(() => {
    changedLine.current = null;
    settle(false);
  }, [lineId, settle]);
  // The page goes: the move that asked does not happen.
  React.useEffect(() => () => settle(false, false), [settle]);

  const noteChange = React.useCallback(() => {
    changedLine.current = latest.current.lineId ?? null;
  }, []);

  const missing = React.useCallback(() => {
    const { scope: lineType, lineId: id, canEdit: editable, axes: dimensions, values: shown } = latest.current;
    if (!editable || !id || changedLine.current !== id) return [];
    const current = shown();
    return dimensions.enabled.filter((axis) => axisRequiredFor(axis, lineType) && !current[axis.id]);
  }, []);

  const isBusy = React.useCallback(() => missing().length > 0, [missing]);

  const confirm = React.useCallback((): Promise<boolean> => {
    const lacking = missing();
    if (lacking.length === 0) return Promise.resolve(true);
    // A second move while the question shows (a double click) stays.
    if (pending.current) return Promise.resolve(false);
    const { axes: dimensions } = latest.current;
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setAsking({ names: lacking.map((axis) => dimensions.label(axis)), firstAxisId: lacking[0].id });
    });
  }, [missing]);

  const focusField = React.useCallback((axisId: string) => {
    setDrawerOpenRequest((n) => n + 1);
    // The panel may open on the next render, and the dialog gives the focus back as it closes.
    let tries = 0;
    const attempt = () => {
      const input = latest.current.root.current
        ?.querySelector<HTMLElement>(`[${ANALYTICS_AXIS_FIELD_ATTR}="${axisId}"] input`);
      if (input) {
        input.focus();
        return;
      }
      tries += 1;
      if (tries < 20) window.setTimeout(attempt, 25);
    };
    window.setTimeout(attempt, 0);
  }, []);

  const stay = React.useCallback(() => {
    if (!asking) return;
    settle(false);
    focusField(asking.firstAxisId);
  }, [asking, settle, focusField]);

  // Leaving ends the visit: a next line still loading (the route's line not shown yet) never asks again.
  const leave = React.useCallback(() => {
    changedLine.current = null;
    settle(true);
  }, [settle]);

  const count = asking?.names.length ?? 0;
  const dialog = asking ? (
    <KanapDialog
      open
      title={t(`${scope}.editor.requiredLeaveTitle`, { count })}
      onClose={stay}
      onSave={stay}
      saveLabel={t(`${scope}.editor.requiredLeaveStay`)}
      saveAutoFocus
      showCancel={false}
      secondaryActions={(
        <Button variant="action" onClick={leave}>
          {t(`${scope}.editor.requiredLeaveConfirm`)}
        </Button>
      )}
    >
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
        {t(`${scope}.editor.requiredLeaveMessage`, { count, names: namesInSentence(locale, asking.names) })}
      </Typography>
    </KanapDialog>
  ) : null;

  return { noteChange, isBusy, confirm, dialog, drawerOpenRequest };
}

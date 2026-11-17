import React, { useState } from 'react';
import { Box, Link, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { ActionLink, Line, Section, type LineAction } from './ImportMatchesView';
import type { ImportLookalike, ImportLookalikeChoice } from './csv.types';

// The sentences are the budget file's, where the rows that look like a stored record were first shown
// (lot I2 of 26.11.9); the applications share them (lot I3).
const K = 'operations.budgetFile.';
const L = `${K}lookalikes.`;

/** The rows listed at once; the others unfold on a click. */
const SHOWN_LOOKALIKES = 10;
/** Where the reference goes in a row's sentence, so it can be a link. */
const REF_MARK = '⁣ref⁣';

/** The choices of a row: small toggles at the density of the line's links, kept together. */
const LOOKALIKE_CHOICES_SX = {
  flexShrink: 0,
  whiteSpace: 'nowrap',
  '& .MuiToggleButton-root': {
    py: '1px',
    px: 1,
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.4,
    textTransform: 'none',
    color: 'kanap.text.secondary',
    borderColor: 'kanap.border.default',
  },
} as const;

type Action = 'ignore' | 'create' | 'update';

/** A row of the file that looks like a stored record: a budget line, an application. */
export type LookalikeRow = {
  line: number;
  name: string;
  /** Reference, name and state empty when the record is gone since the check the person chose on. */
  target: { ref: string; name: string; state: string };
  outcome: 'ignored' | 'created' | 'updated';
  updatable: boolean;
  fields?: string[];
};

export type LookalikeRows<R extends LookalikeRow> = {
  lines: R[];
  /** Every row's target by its line in the file: what a choice for all rows sends. */
  targets: Record<string, unknown>;
  count: number;
  ignored: number;
  created: number;
  updated: number;
};

/** The choices this view reads and writes; a parent's list may hold others (matches undone), kept as they are. */
type RowChoice = { kind: 'lookalike'; line: number; action: Action };
type AllChoice = { kind: 'lookalikes'; action: Action };

const isRowChoice = (choice: { kind: string }): choice is RowChoice => choice.kind === 'lookalike';
const isAllChoice = (choice: { kind: string }): choice is AllChoice => choice.kind === 'lookalikes';

const actionOf = (outcome: LookalikeRow['outcome']): Action => (outcome === 'ignored' ? 'ignore' : outcome === 'created' ? 'create' : 'update');

/** "Update APP-n" for a row of an applications import: the application by its id, and its state at the check. */
export function applicationUpdateChoice(look: ImportLookalike): ImportLookalikeChoice {
  return { kind: 'lookalike', line: look.line, action: 'update', id: look.target.id, state: look.target.state };
}

/** Why a row looks like an existing application, in the person's words (`t` of the `ops` namespace or prefixed). */
export function applicationLookalikeReason(look: ImportLookalike, t: (key: string) => string): string | null {
  if (look.reason === 'name_accents') return t(`ops:${L}reasonNameAccents`);
  if (look.reason === 'close_name') return t(`ops:${L}reasonCloseName`);
  return null;
}

/**
 * The rows of a file that look like a stored record, left out unless the person chooses (lots I2 and
 * I3 of 26.11.9): one line each with the record by its reference, its reason in a tooltip, its three
 * choices as a selection (read only: what becomes of it, in words); above them the counts and the
 * choices for all rows. A choice for all rows sets every row; a row chosen after changes alone.
 * Every choice hands the whole new list to `onChoices`, which checks the file again with it.
 */
export default function ImportLookalikesView<R extends LookalikeRow, C extends { kind: string }>({
  lookalikes,
  title,
  choices,
  updateChoice,
  onChoices,
  choicesDisabled = false,
  reasonText,
  targetUrl,
  fieldName,
  changedLines,
  refusedLines,
}: {
  lookalikes: LookalikeRows<R>;
  title: string;
  /** The choices the check followed, the whole list: the view changes its own and keeps the others. */
  choices: readonly C[];
  /** The "Update" choice of a row: its record and its state at the check. */
  updateChoice: (look: R) => C;
  /** Absent, the rows are read only. */
  onChoices?: (choices: C[]) => void;
  /** A check is running: the choices wait for it. */
  choicesDisabled?: boolean;
  reasonText: (look: R) => string | null;
  /** The address of a row's record, or null when the person may not open it. */
  targetUrl: (look: R) => string | null;
  /** A field an update changes, as the screen names it. */
  fieldName: (field: string) => string;
  /** Rows whose record changed since the check: shown as errors, and "Update" may be chosen again. */
  changedLines?: ReadonlySet<number>;
  /** Rows in error, not compared with their record: no "nothing changes" for them. */
  refusedLines?: ReadonlySet<number>;
}) {
  const { t } = useTranslation('ops');
  const [unfolded, setUnfolded] = useState(false);
  // The choice for all rows; `ignore`, the default, when none was made.
  const allAction = (choices as ReadonlyArray<{ kind: string }>).find(isAllChoice)?.action ?? 'ignore';
  // A record gone since the check (no reference) is never offered to update, as the budget file's.
  const canUpdate = (look: R) => look.updatable && look.target.ref !== '';
  const updatable = lookalikes.lines.filter(canUpdate);
  const act = (label: string, next: () => C[]): LineAction | null => (
    onChoices ? { label, onClick: () => onChoices(next()), disabled: choicesDisabled } : null
  );
  const chooseRow = (look: R, action: Action): C[] => {
    const rest = choices.filter((choice) => !(isRowChoice(choice) && choice.line === look.line));
    // Left out is the default: a row's "Leave out" is sent only to override the choice for all rows.
    if (action === 'ignore') return allAction !== 'ignore' ? [...rest, { kind: 'lookalike', line: look.line, action: 'ignore' } as unknown as C] : rest;
    if (action === 'create') return [...rest, { kind: 'lookalike', line: look.line, action: 'create' } as unknown as C];
    return [...rest, updateChoice(look)];
  };
  const chooseAll = (action: Action): C[] => {
    // A choice for all rows sets every row, their own choices included: the last gesture counts. "Update all"
    // leaves a row it cannot update as it is.
    const rest = choices.filter((choice) => !isAllChoice(choice) && !isRowChoice(choice));
    const kept = action === 'update'
      ? lookalikes.lines
        .filter((look) => !canUpdate(look) && look.outcome === 'created')
        .map((look) => ({ kind: 'lookalike', line: look.line, action: 'create' }) as unknown as C)
      : [];
    // Each row's record as the check shows it, every row included: a record changed in between is refused, not updated blind.
    return [...rest, ...kept, { kind: 'lookalikes', action, targets: lookalikes.targets } as unknown as C];
  };
  const present = (actions: Array<LineAction | null>): LineAction[] => actions.filter((entry): entry is LineAction => entry !== null);
  // Each choice for all rows, while a row is not in its state.
  const headActions = present([
    lookalikes.created < lookalikes.count ? act(t(`${L}createAll`), () => chooseAll('create')) : null,
    updatable.some((look) => look.outcome !== 'updated') ? act(t(`${L}updateAll`), () => chooseAll('update')) : null,
    lookalikes.created + lookalikes.updated > 0 ? act(t(`${L}ignoreAll`), () => chooseAll('ignore')) : null,
  ]);
  const folded = !unfolded && lookalikes.lines.length > SHOWN_LOOKALIKES;
  const shown = folded ? lookalikes.lines.slice(0, SHOWN_LOOKALIKES) : lookalikes.lines;
  const rest = lookalikes.count - shown.length;

  const row = (look: R) => {
    const stale = !!changedLines?.has(look.line);
    const gone = look.target.ref === '';
    // A record gone since the check: the row by its line and name only.
    const label = gone
      ? t(`${K}row`, { line: look.line, message: look.name })
      : t(`${L}row`, { line: look.line, name: look.name, ref: look.target.ref, target: look.target.name });
    const [before, after] = gone
      ? [label, undefined]
      : t(`${L}row`, { line: look.line, name: look.name, ref: REF_MARK, target: look.target.name }).split(REF_MARK);
    const url = gone ? null : targetUrl(look);
    const ref = url
      ? <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover">{look.target.ref}</Link>
      : look.target.ref;
    const current = actionOf(look.outcome);
    const reason = reasonText(look);
    const fields = look.outcome === 'updated' && look.fields && look.fields.length > 0
      ? t(`${L}fields`, { fields: look.fields.map((field) => fieldName(field)).join(', ') })
      : null;
    // An update the check read as changing nothing says so on its row.
    const noChange = look.outcome === 'updated' && !refusedLines?.has(look.line) && look.fields?.length === 0
      ? <Typography component="span" sx={{ fontSize: 12, lineHeight: 1.4, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}>{t(`${L}noChange`, { ref: look.target.ref })}</Typography>
      : null;
    const choose = (value: Action | null) => {
      if (!onChoices) return;
      // A click on the choice shown changes nothing, except Update on a record changed since the check: it reads the record again.
      if (value === null) {
        if (stale && current === 'update') onChoices(chooseRow(look, 'update'));
        return;
      }
      onChoices(chooseRow(look, value));
    };
    const toggles = [
      <ToggleButton key="ignore" value="ignore">{t(`${L}ignore`)}</ToggleButton>,
      <ToggleButton key="create" value="create">{t(`${L}create`)}</ToggleButton>,
      ...(canUpdate(look) ? [<ToggleButton key="update" value="update">{t(`${L}update`, { ref: look.target.ref })}</ToggleButton>] : []),
    ];
    const outcome = look.outcome === 'ignored'
      ? t(`${L}outcomeIgnored`)
      : look.outcome === 'created' ? t(`${L}outcomeCreated`) : t(`${L}outcomeUpdated`, { ref: look.target.ref });
    return (
      <Line
        key={`la-${look.line}`}
        danger={stale}
        tooltip={fields && reason ? <>{reason}<br />{fields}</> : (fields ?? reason ?? undefined)}
        under={onChoices ? (
          <>
            <ToggleButtonGroup
              size="small"
              exclusive
              color="primary"
              value={current}
              disabled={choicesDisabled}
              aria-label={label}
              onChange={(_event, value: Action | null) => choose(value)}
              sx={LOOKALIKE_CHOICES_SX}
            >
              {toggles}
            </ToggleButtonGroup>
            {noChange}
          </>
        ) : undefined}
        after={!onChoices && noChange ? noChange : undefined}
      >
        {after === undefined ? label : <>{before}{ref}{after}</>}
        {/* Read only (the card approved or refused, the load done): what becomes of the row, in words. */}
        {!onChoices && <Box component="span" sx={{ color: stale ? 'inherit' : 'kanap.text.secondary' }}>{` · ${outcome}`}</Box>}
      </Line>
    );
  };

  return (
    <Section title={title}>
      <Line
        muted
        text={t(`${L}counts`, { ignored: lookalikes.ignored, created: lookalikes.created, updated: lookalikes.updated })}
        actions={headActions}
      />
      {shown.map(row)}
      {folded ? (
        <Box><ActionLink onClick={() => setUnfolded(true)}>{t(`${K}andMoreInline`, { count: lookalikes.count - shown.length })}</ActionLink></Box>
      ) : rest > 0 && <Line muted text={t(`${K}andMore`, { count: rest })} />}
    </Section>
  );
}

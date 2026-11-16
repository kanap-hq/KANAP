import React from 'react';
import { Box, Button, Tooltip, Typography } from '@mui/material';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useTranslation } from 'react-i18next';
import type { CsvImportMatch, CsvImportRefusedProposal } from './csv.types';

// The sentences are the budget file's, where the matches were first shown (lot I1 of 26.11.9).
const K = 'operations.budgetFile.';

export type LineAction = { label: string; onClick: () => void; disabled?: boolean };

/** An action of a report line: a small text link, kept on one row. */
export function ActionLink({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      onClick={onClick}
      disabled={disabled}
      sx={{ p: 0, minWidth: 0, fontSize: 12, fontWeight: 400, textTransform: 'none', lineHeight: 1.4, whiteSpace: 'nowrap', '&:hover': { bgcolor: 'transparent', textDecoration: 'underline' } }}
    >
      {children}
    </Button>
  );
}

/** One line of an import's report, with its actions kept together after it (lot I1 and the D14 touches of 26.11.9). */
export function Line({ text, children, danger, muted, kad, tooltip, action, actions, after, under }: {
  text?: string;
  children?: React.ReactNode;
  danger?: boolean;
  muted?: boolean;
  /** Proposed by Kad: the accessible name of its mark, also said in the tooltip. */
  kad?: string;
  tooltip?: React.ReactNode;
  action?: LineAction;
  /** Several actions, after the line. */
  actions?: LineAction[];
  /** Controls or a short state after the line, kept together on one row with it when they fit. */
  after?: React.ReactNode;
  /** Controls on their own row under the line, indented, so that a line and its controls read as one group. */
  under?: React.ReactNode;
}) {
  const body = (
    <Typography
      sx={{
        fontSize: 13,
        lineHeight: 1.45,
        color: danger ? 'kanap.danger' : muted ? 'kanap.text.secondary' : 'kanap.text.primary',
        overflowWrap: 'anywhere',
      }}
    >
      {children ?? text}
      {kad && (
        <Box component="span" role="img" aria-label={kad} sx={{ display: 'inline-flex', verticalAlign: '-2px', ml: 0.5, color: 'kanap.text.tertiary' }}>
          <AutoAwesomeOutlinedIcon sx={{ fontSize: 13 }} />
        </Box>
      )}
    </Typography>
  );
  const title = kad && tooltip ? <>{kad}<br />{tooltip}</> : (tooltip ?? kad);
  const links = actions ?? (action ? [action] : []);
  // A line's controls may wrap under its text: its tooltip opens above it, and lets the pointer
  // through, so that it never covers an action (lot I3 of 26.11.9, correctifs G).
  const controls = !!under || links.length > 0 || !!after;
  const shown = title
    ? <Tooltip title={title} placement={controls ? 'top-start' : 'bottom-start'} disableInteractive>{body}</Tooltip>
    : body;
  if (under) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', rowGap: 0.25, mt: 0.75 }}>
        {shown}
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25, pl: 4 }}>{under}</Box>
      </Box>
    );
  }
  if (links.length === 0 && !after) return shown;
  // The actions of a line stay together on one row: after the text when they fit, else under it.
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1.5, rowGap: 0.25 }}>
      {shown}
      {links.length > 0 && (
        <Box sx={{ display: 'inline-flex', alignItems: 'baseline', columnGap: 1.5, whiteSpace: 'nowrap' }}>
          {links.map((link) => <ActionLink key={link.label} onClick={link.onClick} disabled={link.disabled}>{link.label}</ActionLink>)}
        </Box>
      )}
      {after && <Box sx={{ display: 'inline-flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 1, rowGap: 0.25 }}>{after}</Box>}
    </Box>
  );
}

/** A section of an import's report: its title, then its lines. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{title}</Typography>
      {hint && <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 0.25 }}>{hint}</Typography>}
      {children}
    </Box>
  );
}

/** The fold of the matches: a count, which unfolds into one line per match. */
export function FoldToggle({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant="text"
      size="small"
      aria-expanded={open}
      onClick={onToggle}
      startIcon={<KeyboardArrowRightIcon sx={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms' }} />}
      sx={{
        alignSelf: 'flex-start',
        p: 0,
        minWidth: 0,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        textTransform: 'none',
        color: 'kanap.text.tertiary',
        '& .MuiButton-startIcon': { ml: 0, mr: 0.25, '& svg': { fontSize: 16 } },
        '&:hover': { bgcolor: 'transparent', color: 'kanap.text.secondary' },
      }}
    >
      {label}
    </Button>
  );
}

type Match = Pick<CsvImportMatch, 'column' | 'name' | 'value' | 'target' | 'ref' | 'origin' | 'reason' | 'lines' | 'count' | 'undoable'>;
type Refused = Pick<CsvImportRefusedProposal, 'column' | 'name' | 'value' | 'target' | 'reason' | 'lines' | 'count'>;
/** A match the person undid: its column and value, and how it was found when the screen kept it. */
export type UndoneMatch = { column: string; value: string; name?: string | null; origin?: CsvImportMatch['origin'] };

/**
 * The matches of an import's check (lot I3 of 26.11.9): the values of the file found beyond case, as
 * one folded count that unfolds into one line per match ("Supplier: Societe Generale → SUP-3 Société
 * Générale"), the file's lines in a tooltip (with "Catalog version" for a version found by a prefix
 * rule), Kad's proposals marked, each with its Undo when it can be
 * undone; then the matches undone, each with its way back (correctifs I), as the budget file's check
 * lists them; then the proposals of Kad the import refused. The budget file's check, the card of any
 * import and the import dialogs show it alike. Nothing when there is no match, no undone match and no refusal.
 */
export default function ImportMatchesView({
  matches,
  matchesTotal,
  refusedProposals,
  refusedTotal,
  columnName,
  open,
  onToggle,
  onUndo,
  undone = [],
  onRedo,
  disabled = false,
}: {
  /** The first matches; `matchesTotal` all of them, when the list was cut. */
  matches: readonly Match[];
  matchesTotal?: number;
  refusedProposals: readonly Refused[];
  refusedTotal?: number;
  /** A column as the screen names it (a dimension by its name): never its technical name. */
  columnName: (column: string, name?: string | null) => string;
  open: boolean;
  onToggle: () => void;
  /** Undo a match: absent, the matches are read only. */
  onUndo?: (entry: Match) => void;
  /** The matches undone on this check, listed with their way back while `onRedo` is given. */
  undone?: readonly UndoneMatch[];
  /** Match an undone value again: absent, the matches undone are not listed. */
  onRedo?: (entry: UndoneMatch) => void;
  /** A check is running: Undo waits for it. */
  disabled?: boolean;
}) {
  const { t } = useTranslation('ops');
  const undoneShown = onRedo ? undone : [];
  if (matches.length === 0 && undoneShown.length === 0 && refusedProposals.length === 0) return null;
  const linesOf = (entry: { lines: number[]; count: number }): string => {
    const extra = entry.count - entry.lines.length;
    const lines = extra > 0 ? `${entry.lines.join(', ')} ${t(`${K}andMoreInline`, { count: extra })}` : entry.lines.join(', ');
    return t(`${K}matching.lines`, { count: entry.count, lines });
  };
  // The record with its reference before its name, as a line that looks like a stored one names it.
  const record = (entry: { target: string; ref?: string | null }) => (entry.ref ? `${entry.ref} ${entry.target}` : entry.target);
  // A supplier found by the application's publisher says so after its column.
  const columnOf = (entry: { column: string; name?: string | null; origin?: CsvImportMatch['origin'] }) => (entry.origin === 'editor'
    ? t(`${K}matching.byEditor`, { column: columnName(entry.column, entry.name) })
    : columnName(entry.column, entry.name));
  const allMatches = Math.max(matchesTotal ?? 0, matches.length);
  const allRefused = Math.max(refusedTotal ?? 0, refusedProposals.length);
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {matches.length > 0 && (
        <FoldToggle open={open} onToggle={onToggle} label={t(`${K}matching.count`, { count: allMatches })} />
      )}
      {open && matches.map((entry) => (
        <Line
          key={`mt-${entry.column}-${entry.value}`}
          text={t(`${K}matching.match`, {
            dimension: columnOf(entry),
            value: entry.value,
            target: record(entry),
          })}
          kad={entry.origin === 'model' ? t(`${K}matching.byKad`) : undefined}
          tooltip={entry.reason === 'version' ? <>{t(`${K}matching.catalogVersion`)}<br />{linesOf(entry)}</> : linesOf(entry)}
          action={onUndo && entry.undoable ? { label: t(`${K}matching.undo`), onClick: () => onUndo(entry), disabled } : undefined}
        />
      ))}
      {open && allMatches > matches.length && <Line text={t(`${K}andMore`, { count: allMatches - matches.length })} />}
      {/* A match undone stays listed, folded or not, even when no match is left: the way back to it. */}
      {undoneShown.map((entry) => (
        <Line
          key={`un-${entry.column}-${entry.value}`}
          text={t(`${K}dimensionValues`, { dimension: columnOf(entry), names: entry.value })}
          action={{ label: t(`${K}matching.redo`), onClick: () => onRedo?.(entry), disabled }}
        />
      ))}
      {refusedProposals.map((entry) => (
        <Line
          key={`rp-${entry.column}-${entry.value}`}
          muted
          text={t(entry.reason === 'disabled' ? `${K}matching.refusedDisabled` : `${K}matching.refusedMissing`, {
            dimension: columnName(entry.column, entry.name),
            value: entry.value,
            target: entry.target,
          })}
          kad={t(`${K}matching.byKad`)}
          tooltip={linesOf(entry)}
        />
      ))}
      {allRefused > refusedProposals.length && <Line muted text={t(`${K}andMore`, { count: allRefused - refusedProposals.length })} />}
    </Box>
  );
}

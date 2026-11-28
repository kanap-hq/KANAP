import React from 'react';
import { Box, Radio, Switch, TextField, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useAuth } from '../../auth/AuthContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { AmountMeasure } from '../../components/finance/roundPeriod';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { useSettingsAutosave, type SettingsAutosave } from '../../components/settings/useSettingsAutosave';
import { BUDGET_COLUMNS_QUERY_KEY, useBudgetColumns, type BudgetColumnView } from '../../hooks/useBudgetColumns';
import { autosaveErrorMessage } from '../../hooks/useAutosave';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import {
  BudgetColumnsPatch,
  BudgetColumnsSettings,
  updateBudgetColumns,
} from '../../services/budgetColumns';
import { loadNamespace } from '../../i18n';

/** The server's limit on a column name, in characters (code points). */
const MAX_NAME_LENGTH = 40;
const P = 'operations.budgetColumnsSettings';
/** Control and invisible format characters (zero width, bidi marks, BOM), refused like the server does. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
/** Names compare like the server compares them: composed form, case folded. */
const fold = (name: string) => name.normalize('NFC').toLowerCase();

/** English product name of a column, by its label key, or '' while the English texts are not loaded. */
export type EnglishColumnName = (labelKey: string) => string;

/** Draft of the page: names as typed, flags and default as chosen. */
export type BudgetColumnsDraft = {
  labels: Record<AmountMeasure, string>;
  enabled: Record<AmountMeasure, boolean>;
  group_spread: Record<AmountMeasure, boolean>;
  default_column: AmountMeasure;
};

/** The name as the server stores it: trimmed, inner spaces collapsed, blank = the standard name. */
export function normalizeColumnName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, ' ');
  return name === '' ? null : name;
}

export function draftFromSettings(settings: BudgetColumnsSettings): BudgetColumnsDraft {
  const labels = {} as Record<AmountMeasure, string>;
  for (const { measure } of AMOUNT_COLUMNS) labels[measure] = settings.labels[measure] ?? '';
  return {
    labels,
    enabled: { ...settings.enabled },
    group_spread: { ...settings.group_spread },
    default_column: settings.default_column,
  };
}

export type DraftErrors = {
  /** Per column: a name problem, in plain words. */
  names: Partial<Record<AmountMeasure, string>>;
  /** A problem with the whole set (nothing shown, hidden default). */
  form: string | null;
};

/**
 * The server's rules, checked first with translated messages. A column without a name of its own
 * goes by its standard name: the translated one the user sees and the English one the server checks.
 */
export function validateBudgetColumnsDraft(
  draft: BudgetColumnsDraft,
  t: TFunction,
  englishName: EnglishColumnName = () => '',
): DraftErrors {
  const names: DraftErrors['names'] = {};
  const earlier: Array<{ measure: AmountMeasure; custom: boolean; names: string[] }> = [];
  for (const { measure, labelKey } of AMOUNT_COLUMNS) {
    const custom = normalizeColumnName(draft.labels[measure]);
    if (custom && CONTROL_OR_FORMAT.test(custom)) {
      names[measure] = t(`${P}.errors.controlCharacters`);
      continue;
    }
    if (custom && Array.from(custom).length > MAX_NAME_LENGTH) {
      names[measure] = t(`${P}.errors.tooLong`, { max: MAX_NAME_LENGTH });
      continue;
    }
    const own = custom ? [custom] : [t(labelKey), englishName(labelKey)].filter(Boolean);
    for (const other of earlier) {
      const clash = own.find((name) => other.names.some((n) => fold(n) === fold(name)));
      if (clash) {
        // The error goes on a name the user typed, the later one when both are typed.
        names[custom || !other.custom ? measure : other.measure] = t(`${P}.errors.duplicate`, { name: clash });
        break;
      }
    }
    earlier.push({ measure, custom: !!custom, names: own });
  }
  let form: string | null = null;
  if (!AMOUNT_COLUMNS.some(({ measure }) => draft.enabled[measure])) form = t(`${P}.errors.allHidden`);
  else if (!draft.enabled[draft.default_column]) form = t(`${P}.errors.defaultHidden`);
  return { names, form };
}

const headSx = { textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.75, whiteSpace: 'nowrap' } as const;
const cellSx = { px: 1, py: 0.75, fontSize: 13, color: 'kanap.text.primary', verticalAlign: 'top' } as const;
const controlCellSx = { ...cellSx, py: 0.25 } as const;
const headInfoSx = { fontSize: 13, color: 'kanap.text.tertiary', verticalAlign: 'middle', ml: 0.5 } as const;

/** A header with its explanation one hover away, the same info icon as the spread panel of the budget tab. */
function HeadWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <Box component="th" sx={headSx}>
      {label}
      <Tooltip title={info}>
        {/* aria-hidden off: SvgIcon hides itself from assistive technology by default. */}
        <InfoOutlinedIcon tabIndex={0} role="img" aria-hidden={false} aria-label={info} sx={headInfoSx} />
      </Tooltip>
    </Box>
  );
}


/** A choice of the page: a flag of a column, or the default column. */
type ChoiceField = `enabled.${AmountMeasure}` | `group_spread.${AmountMeasure}` | 'default_column';
/** Choices shown before the server has them: being sent, or refused by the checks and kept with their error. */
type Overlay = Partial<Record<ChoiceField, boolean | AmountMeasure>>;

function withOverlay(draft: BudgetColumnsDraft, overlay: Overlay): BudgetColumnsDraft {
  const next: BudgetColumnsDraft = { ...draft, enabled: { ...draft.enabled }, group_spread: { ...draft.group_spread } };
  for (const [field, value] of Object.entries(overlay) as Array<[ChoiceField, boolean | AmountMeasure]>) {
    if (field === 'default_column') next.default_column = value as AmountMeasure;
    else {
      const [map, measure] = field.split('.') as ['enabled' | 'group_spread', AmountMeasure];
      next[map][measure] = value as boolean;
    }
  }
  return next;
}

function without(overlay: Overlay, field: ChoiceField): Overlay {
  const next = { ...overlay };
  delete next[field];
  return next;
}

const errorLineSx = { fontSize: 12, color: 'kanap.danger', mt: 0.25, maxWidth: 220, whiteSpace: 'normal' } as const;

type ColumnRowProps = {
  column: BudgetColumnView;
  draft: BudgetColumnsDraft;
  readOnly: boolean;
  autosave: SettingsAutosave;
  /** The refusal of a name typed for the column, or null when the server would take it. */
  nameErrorOf: (measure: AmountMeasure, typed: string) => string | null;
  /** The refusal of a choice of this row, kept under it until another change. */
  choiceError: (field: ChoiceField) => string | null;
  choose: (field: ChoiceField, value: boolean | AmountMeasure) => void;
  send: (patch: BudgetColumnsPatch) => Promise<void>;
};

/** One column of the table: its name, saved as it is typed, and its three choices, saved when chosen. */
function ColumnRow({ column, draft, readOnly, autosave, nameErrorOf, choiceError, choose, send }: ColumnRowProps) {
  const { t } = useTranslation(['ops', 'common']);
  const { measure } = column;
  const savedLabel = column.customLabel ?? '';
  const name = useFieldDraft(savedLabel);
  const productName = t(column.labelKey);
  const nameError = normalizeColumnName(name.draft) === (column.customLabel ?? null) ? null : nameErrorOf(measure, name.draft);
  const shownName = column.label;
  const errorOf = (field: ChoiceField) => {
    const error = choiceError(field);
    return error ? <Typography role="alert" sx={errorLineSx}>{error}</Typography> : null;
  };

  const onName = (value: string) => {
    name.setDraft(value);
    const label = normalizeColumnName(value);
    // A refused name, or the stored one again: nothing to send, the stored name stays.
    const refused = label !== (column.customLabel ?? null) && nameErrorOf(measure, value);
    autosave.type(`labels.${measure}`, refused || label === (column.customLabel ?? null)
      ? null
      : () => send({ labels: { [measure]: label } }));
  };

  return (
    <Box component="tr" data-testid={`budget-column-row-${column.position}`}>
      <Box component="td" sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums', color: 'kanap.text.secondary', width: 64 }}>
        {column.position}
      </Box>
      <Box component="td" sx={{ ...controlCellSx, minWidth: 240 }}>
        <TextField
          variant="standard"
          size="small"
          value={name.draft}
          placeholder={productName}
          onChange={(e) => onName(e.target.value)}
          onFocus={name.onFocus}
          onBlur={() => {
            name.onBlur();
            autosave.commit();
          }}
          error={!!nameError}
          InputProps={{ readOnly }}
          inputProps={{ 'aria-label': t(`${P}.nameOf`, { position: column.position }) }}
          sx={{ width: 240 }}
        />
        {nameError && (
          <Typography sx={{ fontSize: 12, color: 'kanap.danger', mt: 0.25 }}>{nameError}</Typography>
        )}
        {/* Where the column shows under its technical name. */}
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>
          {t(`${P}.inFiles`, { name: measure })}
        </Typography>
      </Box>
      <Box component="td" sx={controlCellSx}>
        <Switch
          size="small"
          checked={draft.enabled[measure]}
          onChange={(e) => choose(`enabled.${measure}`, e.target.checked)}
          disabled={readOnly}
          inputProps={{ 'aria-label': t(`${P}.shownOf`, { column: shownName }) }}
        />
        {errorOf(`enabled.${measure}`)}
      </Box>
      <Box component="td" sx={controlCellSx}>
        <Switch
          size="small"
          checked={draft.group_spread[measure]}
          onChange={(e) => choose(`group_spread.${measure}`, e.target.checked)}
          disabled={readOnly}
          inputProps={{ 'aria-label': t(`${P}.followsOf`, { column: shownName }) }}
        />
      </Box>
      <Box component="td" sx={controlCellSx}>
        <Radio
          size="small"
          name="budget-default-column"
          value={measure}
          checked={draft.default_column === measure}
          onChange={() => choose('default_column', measure)}
          disabled={readOnly}
          inputProps={{ 'aria-label': t(`${P}.defaultOf`, { column: shownName }) }}
        />
        {draft.default_column === measure && errorOf('default_column')}
      </Box>
    </Box>
  );
}

/**
 * Budget columns: each change is saved on its own, a name as it is typed, a choice when it is
 * made. A change the server would refuse is never sent: it stays on screen with its reason, and the
 * stored setting stays. A refused choice goes back to the stored value at the next change.
 */
export default function BudgetColumnsSettingsPage() {
  const { t, i18n } = useTranslation(['ops', 'common']);
  // The server checks names against the English product names, whatever the viewer's language:
  // the English texts of the page are loaded on demand like any other namespace.
  const [englishReady, setEnglishReady] = React.useState(() => i18n.hasResourceBundle('en', 'ops'));
  React.useEffect(() => {
    if (englishReady) return undefined;
    let live = true;
    loadNamespace('en', 'ops').then(
      () => { if (live) setEnglishReady(true); },
      () => undefined,
    );
    return () => { live = false; };
  }, [englishReady]);
  const englishName = React.useCallback<EnglishColumnName>((labelKey) => {
    if (!englishReady) return '';
    const key = labelKey.replace(/^ops:/, '');
    return i18n.exists(key, { lng: 'en', ns: 'ops' }) ? i18n.getFixedT('en', 'ops')(key) : '';
  }, [englishReady, i18n]);
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('budget_ops', 'admin');
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const saved = budgetColumns.settings;
  const autosave = useSettingsAutosave();

  const [overlay, setOverlay] = React.useState<Overlay>({});
  const [refused, setRefused] = React.useState<{ field: ChoiceField; error: string } | null>(null);
  const draft = React.useMemo(() => withOverlay(draftFromSettings(saved), overlay), [saved, overlay]);
  // What the server holds once the choices being sent land, without a refused one.
  const accepted = React.useMemo(
    () => withOverlay(draftFromSettings(saved), refused ? without(overlay, refused.field) : overlay),
    [saved, overlay, refused],
  );

  const send = React.useCallback(async (patch: BudgetColumnsPatch) => {
    const next = await updateBudgetColumns(patch);
    queryClient.setQueryData(BUDGET_COLUMNS_QUERY_KEY, next);
    void queryClient.invalidateQueries({ queryKey: BUDGET_COLUMNS_QUERY_KEY });
  }, [queryClient]);

  const nameErrorOf = React.useCallback((measure: AmountMeasure, typed: string): string | null => {
    const before = validateBudgetColumnsDraft(accepted, t, englishName).names;
    const after = validateBudgetColumnsDraft({ ...accepted, labels: { ...accepted.labels, [measure]: typed } }, t, englishName).names;
    // A clash with a stored name is the typed name's fault, whichever row comes first.
    return after[measure] ?? Object.entries(after).find(([other]) => other !== measure && !before[other as AmountMeasure])?.[1] ?? null;
  }, [accepted, t, englishName]);

  const choose = (field: ChoiceField, value: boolean | AmountMeasure) => {
    // A choice refused before goes back to the stored value once another one changes.
    const base = refused && refused.field !== field ? without(overlay, refused.field) : overlay;
    const next: Overlay = { ...base, [field]: value };
    const form = validateBudgetColumnsDraft(withOverlay(draftFromSettings(saved), next), t, englishName).form;
    if (form) {
      setOverlay(next);
      setRefused({ field, error: form });
      autosave.choose(field, null);
      return;
    }
    const wasRefused = refused?.field === field;
    setRefused(null);
    if (wasRefused && readChoice(draftFromSettings(saved), field) === value) {
      // Back to the stored value before anything was sent.
      setOverlay(without(next, field));
      autosave.choose(field, null);
      return;
    }
    setOverlay(next);
    const patch: BudgetColumnsPatch = field === 'default_column'
      ? { default_column: value as AmountMeasure }
      : { [field.split('.')[0]]: { [field.split('.')[1]]: value } };
    autosave.choose(field, async () => {
      try {
        await send(patch);
      } finally {
        // Landed: the stored setting shows it. Refused by the server: the stored value is back.
        setOverlay((current) => (current[field] === value ? without(current, field) : current));
      }
    });
  };

  // Not loaded: the standard values on screen would not be the tenant's, so nothing is offered.
  const loadFailed = !!budgetColumns.error;
  const readOnly = !canEdit;
  const serverError = canEdit && autosave.error ? autosaveErrorMessage(autosave.error, t, t(`${P}.errors.saveFailed`)) : null;

  return (
    <SettingsPage
      title={t(`${P}.title`)}
      status={autosave.status}
      readOnly={readOnly}
      loading={!budgetColumns.ready}
      error={loadFailed ? t(`${P}.loadError`) : undefined}
    >
      <Box sx={{ overflowX: 'auto', mt: 2 }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' }, '& tbody td': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={headSx}>{t(`${P}.column`)}</Box>
              <Box component="th" sx={headSx}>{t(`${P}.name`)}</Box>
              <HeadWithInfo label={t(`${P}.shown`)} info={t(`${P}.helpHidden`)} />
              <HeadWithInfo label={t(`${P}.follows`)} info={t(`${P}.helpFollows`)} />
              <HeadWithInfo label={t(`${P}.default`)} info={t(`${P}.helpDefault`)} />
            </Box>
          </Box>
          <Box component="tbody">
            {budgetColumns.all.map((column) => (
              <ColumnRow
                key={column.measure}
                column={column}
                draft={draft}
                readOnly={readOnly}
                autosave={autosave}
                nameErrorOf={nameErrorOf}
                choiceError={(field) => (refused?.field === field ? refused.error : null)}
                choose={choose}
                send={send}
              />
            ))}
          </Box>
        </Box>
      </Box>
      {serverError && (
        <Typography role="alert" sx={{ fontSize: 13, color: 'kanap.danger', mt: 1.5 }}>{serverError}</Typography>
      )}
    </SettingsPage>
  );
}

function readChoice(draft: BudgetColumnsDraft, field: ChoiceField): boolean | AmountMeasure {
  if (field === 'default_column') return draft.default_column;
  const [map, measure] = field.split('.') as ['enabled' | 'group_spread', AmountMeasure];
  return draft[map][measure];
}

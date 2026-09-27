import React from 'react';
import { Alert, Box, Button, Paper, Radio, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { AmountMeasure } from '../../components/finance/roundPeriod';
import { BUDGET_COLUMNS_QUERY_KEY, useBudgetColumns } from '../../hooks/useBudgetColumns';
import {
  BudgetColumnsPatch,
  BudgetColumnsSettings,
  updateBudgetColumns,
} from '../../services/budgetColumns';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import enOps from '../../locales/en/ops.json';

/** The server's limit on a column name, in characters (code points). */
const MAX_NAME_LENGTH = 40;
const P = 'operations.budgetColumnsSettings';
/** Control and invisible format characters (zero width, bidi marks, BOM), refused like the server does. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
/** Names compare like the server compares them: composed form, case folded. */
const fold = (name: string) => name.normalize('NFC').toLowerCase();

/** The English product name of a column: the server checks names against it, whatever the viewer's language. */
function englishName(labelKey: string): string {
  let node: unknown = enOps;
  for (const part of labelKey.replace(/^ops:/, '').split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  return typeof node === 'string' ? node : '';
}

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
export function validateBudgetColumnsDraft(draft: BudgetColumnsDraft, t: TFunction): DraftErrors {
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

/** Only what changed against the saved setting; empty when nothing did. */
export function buildBudgetColumnsPatch(saved: BudgetColumnsSettings, draft: BudgetColumnsDraft): BudgetColumnsPatch {
  const patch: BudgetColumnsPatch = {};
  for (const { measure } of AMOUNT_COLUMNS) {
    const label = normalizeColumnName(draft.labels[measure]);
    if (label !== (saved.labels[measure] ?? null)) patch.labels = { ...patch.labels, [measure]: label };
    if (draft.enabled[measure] !== saved.enabled[measure]) patch.enabled = { ...patch.enabled, [measure]: draft.enabled[measure] };
    if (draft.group_spread[measure] !== saved.group_spread[measure]) {
      patch.group_spread = { ...patch.group_spread, [measure]: draft.group_spread[measure] };
    }
  }
  if (draft.default_column !== saved.default_column) patch.default_column = draft.default_column;
  return patch;
}

const headSx = { textAlign: 'left', fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', px: 1, py: 0.75, whiteSpace: 'nowrap' } as const;
const cellSx = { px: 1, py: 0.75, fontSize: 13, color: 'kanap.text.primary', verticalAlign: 'top' } as const;
const controlCellSx = { ...cellSx, py: 0.25 } as const;
const helpSx = { fontSize: 12, color: 'kanap.text.tertiary', lineHeight: 1.5 } as const;
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

export default function BudgetColumnsSettingsPage() {
  const { t } = useTranslation(['ops', 'common']);
  const { hasLevel } = useAuth();
  const canEdit = hasLevel('budget_ops', 'admin');
  const queryClient = useQueryClient();
  const budgetColumns = useBudgetColumns();
  const saved = budgetColumns.settings;

  const [draft, setDraft] = React.useState<BudgetColumnsDraft>(() => draftFromSettings(saved));
  const [savedFlash, setSavedFlash] = React.useState(false);
  // Follow the stored setting when it loads or a save lands.
  React.useEffect(() => { setDraft(draftFromSettings(saved)); }, [saved]);

  const errors = React.useMemo(() => validateBudgetColumnsDraft(draft, t), [draft, t]);
  const patch = React.useMemo(() => buildBudgetColumnsPatch(saved, draft), [saved, draft]);
  const dirty = Object.keys(patch).length > 0;
  const valid = !errors.form && Object.keys(errors.names).length === 0;

  const mutation = useMutation({
    mutationFn: (next: BudgetColumnsPatch) => updateBudgetColumns(next),
    onSuccess: (next) => {
      queryClient.setQueryData(BUDGET_COLUMNS_QUERY_KEY, next);
      void queryClient.invalidateQueries({ queryKey: BUDGET_COLUMNS_QUERY_KEY });
      setSavedFlash(true);
    },
  });
  React.useEffect(() => {
    if (!savedFlash) return undefined;
    const timer = window.setTimeout(() => setSavedFlash(false), 1500);
    return () => window.clearTimeout(timer);
  }, [savedFlash]);

  const update = (change: (prev: BudgetColumnsDraft) => BudgetColumnsDraft) => {
    mutation.reset();
    setSavedFlash(false);
    setDraft(change);
  };
  const setFlag = (map: 'enabled' | 'group_spread', measure: AmountMeasure, value: boolean) =>
    update((prev) => ({ ...prev, [map]: { ...prev[map], [measure]: value } }));

  const busy = mutation.isPending;
  // Not loaded: the standard values on screen would not be the tenant's, so nothing is offered.
  const loadFailed = !!budgetColumns.error;
  const readOnly = !canEdit || busy || !budgetColumns.ready || loadFailed;
  const serverError = mutation.error ? getApiErrorMessage(mutation.error, t, t(`${P}.errors.saveFailed`)) : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t(`${P}.title`)} breadcrumbTitle={t(`${P}.title`)} />
      <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 720 }}>
        {t(`${P}.subtitle`)}
      </Typography>

      {!canEdit && <Alert severity="info" sx={{ maxWidth: 720 }}>{t('operations.budgetAdminOnly')}</Alert>}

      {loadFailed ? (
        <Typography role="alert" sx={{ fontSize: 13, color: 'error.main' }}>{t(`${P}.loadError`)}</Typography>
      ) : (
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 880 }}>
          <Box sx={{ overflowX: 'auto' }}>
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th': { borderBottom: '1px solid', borderColor: 'kanap.border.default' }, '& tbody td': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={headSx}>{t(`${P}.column`)}</Box>
                  <Box component="th" sx={headSx}>{t(`${P}.name`)}</Box>
                  <Box component="th" sx={headSx}>{t(`${P}.shown`)}</Box>
                  <HeadWithInfo label={t(`${P}.follows`)} info={t(`${P}.helpFollows`)} />
                  <HeadWithInfo label={t(`${P}.default`)} info={t(`${P}.helpDefault`)} />
                </Box>
              </Box>
              <Box component="tbody">
                {budgetColumns.all.map((column) => {
                  const { measure } = column;
                  const productName = t(column.labelKey);
                  const nameError = errors.names[measure];
                  const shownName = normalizeColumnName(draft.labels[measure]) ?? productName;
                  return (
                    <Box component="tr" key={measure} data-testid={`budget-column-row-${column.position}`}>
                      <Box component="td" sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums', color: 'kanap.text.secondary', width: 64 }}>
                        {column.position}
                      </Box>
                      <Box component="td" sx={{ ...controlCellSx, minWidth: 240 }}>
                        <TextField
                          variant="standard"
                          size="small"
                          value={draft.labels[measure]}
                          placeholder={productName}
                          onChange={(e) => {
                            const value = e.target.value;
                            update((prev) => ({ ...prev, labels: { ...prev.labels, [measure]: value } }));
                          }}
                          error={!!nameError}
                          InputProps={{ readOnly }}
                          inputProps={{ 'aria-label': t(`${P}.nameOf`, { position: column.position }) }}
                          sx={{ width: 240 }}
                        />
                        {nameError && (
                          <Typography sx={{ fontSize: 12, color: 'error.main', mt: 0.25 }}>{nameError}</Typography>
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
                          onChange={(e) => setFlag('enabled', measure, e.target.checked)}
                          disabled={readOnly}
                          inputProps={{ 'aria-label': t(`${P}.shownOf`, { column: shownName }) }}
                        />
                      </Box>
                      <Box component="td" sx={controlCellSx}>
                        <Switch
                          size="small"
                          checked={draft.group_spread[measure]}
                          onChange={(e) => setFlag('group_spread', measure, e.target.checked)}
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
                          onChange={() => update((prev) => ({ ...prev, default_column: measure }))}
                          disabled={readOnly}
                          inputProps={{ 'aria-label': t(`${P}.defaultOf`, { column: shownName }) }}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          </Box>

          <Stack spacing={0.5} sx={{ mt: 1.5, maxWidth: 720 }}>
            <Typography sx={helpSx}>{t(`${P}.nameHint`)}</Typography>
            <Typography sx={helpSx}>{t(`${P}.helpHidden`)}</Typography>
          </Stack>

          {canEdit && errors.form && (
            <Typography role="alert" sx={{ fontSize: 13, color: 'error.main', mt: 1.5 }}>{errors.form}</Typography>
          )}
          {canEdit && serverError && (
            <Alert severity="error" sx={{ mt: 1.5 }}>{serverError}</Alert>
          )}

          {canEdit && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
              <Button
                variant="contained"
                onClick={() => mutation.mutate(patch)}
                disabled={!dirty || !valid || readOnly}
              >
                {t('common:buttons.save')}
              </Button>
              <Button
                variant="action"
                onClick={() => update(() => draftFromSettings(saved))}
                disabled={!dirty || busy}
              >
                {t('common:buttons.reset')}
              </Button>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                {busy ? t('common:status.saving', 'Saving…') : savedFlash ? t('common:status.saved', 'Saved') : ''}
              </Typography>
            </Stack>
          )}
        </Paper>
      )}
    </Box>
  );
}

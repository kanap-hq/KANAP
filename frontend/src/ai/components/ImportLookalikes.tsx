import React from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { useTranslation } from 'react-i18next';
import type { AiImportMapping } from '../aiTypes';
import type { BudgetFileSentence } from '../../components/finance/budgetFile';
import { checkSentence } from '../../components/finance/budgetFileText';
import { useAuth } from '../../auth/AuthContext';
import { buildEntityUrl } from '../utils/entityUrls';

/** The lookalikes listed at once; more unfold on a click. */
const SHOWN_LOOKALIKES = 10;

/** Stands for the reference in its sentence, which is split around it to make the reference a link. */
const REF_MARK = '⁣';

export type ImportLookalikeList = {
  items: Array<{ line: number } & BudgetFileSentence>;
  /** How many the check found: the list holds the first ones. */
  count: number;
};

/**
 * The new rows of a budget file that look like an existing line or an earlier row, from the
 * import's check, while the card shows that check (until the import runs).
 */
export function importLookalikes(mapping: AiImportMapping | null | undefined): ImportLookalikeList | null {
  const run = mapping && !mapping.result ? mapping.validation : null;
  if (!run || run.report.kind !== 'budget_file' || !run.report.file) return null;
  const warnings = run.report.file.warnings;
  const items = warnings?.duplicates ?? [];
  if (items.length === 0) return null;
  return { items, count: Math.max(warnings.duplicatesCount ?? items.length, items.length) };
}

/** Their number, with the warning icon: on the card's summary line. */
export function ImportLookalikeCount({ count }: { count: number }) {
  const { t } = useTranslation(['common']);
  return (
    <Box
      component="span"
      role="img"
      aria-label={t('common:csv.warnings', { count })}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, color: 'warning.main', fontSize: 12, fontWeight: 500, flexShrink: 0 }}
    >
      <WarningAmberOutlined aria-hidden sx={{ fontSize: 14 }} />
      <span aria-hidden>{count}</span>
    </Box>
  );
}

/** One lookalike in the sentence of the import dialog; a line the person may open is a link. */
function LookalikeLine({ item, canOpen }: { item: ImportLookalikeList['items'][number]; canOpen: boolean }) {
  const { t } = useTranslation(['ops', 'errors']);
  const ref = item.code === 'BUDGET_FILE_LOOKS_LIKE_LINE' ? String(item.params?.ref ?? '') : '';
  const url = ref && canOpen ? buildEntityUrl('budget_lines', ref) : null;
  if (url) {
    const parts = checkSentence({ ...item, params: { ...item.params, ref: REF_MARK } }, t).split(REF_MARK);
    if (parts.length === 2) {
      return (
        <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'kanap.text.primary' }}>
          {parts[0]}
          <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover">{ref}</Link>
          {parts[1]}
        </Typography>
      );
    }
  }
  return <Typography sx={{ fontSize: 12, lineHeight: 1.5, color: 'kanap.text.primary' }}>{checkSentence(item, t)}</Typography>;
}

/**
 * The lookalikes of a budget file, before the card's actions: all of them when they are few, else
 * the first ones and "and n more", which shows the others the check kept.
 */
export function ImportLookalikeLines({ lookalikes }: { lookalikes: ImportLookalikeList }) {
  const { t } = useTranslation(['ops']);
  const { hasLevel } = useAuth();
  const [unfolded, setUnfolded] = React.useState(false);
  const canOpen = hasLevel('budget', 'reader');
  const folded = !unfolded && lookalikes.count > SHOWN_LOOKALIKES;
  const shown = folded ? lookalikes.items.slice(0, SHOWN_LOOKALIKES) : lookalikes.items;
  const rest = lookalikes.count - shown.length;
  return (
    <Stack spacing={0.25}>
      {shown.map((item, index) => <LookalikeLine key={`${item.line}-${index}`} item={item} canOpen={canOpen} />)}
      {rest > 0 && (folded ? (
        <Link
          component="button"
          type="button"
          underline="hover"
          onClick={() => setUnfolded(true)}
          sx={{ alignSelf: 'flex-start', fontSize: 12 }}
        >
          {t('ops:operations.budgetFile.andMoreInline', { count: rest })}
        </Link>
      ) : (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
          {t('ops:operations.budgetFile.andMore', { count: rest })}
        </Typography>
      ))}
    </Stack>
  );
}

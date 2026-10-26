import React from 'react';
import { Link, Stack, Typography } from '@mui/material';
import { Trans, useTranslation } from 'react-i18next';
import type { LineType } from '../../constants/lineTypeUsage';

/** A line next to this one after a change of type (`lineage` of the workspace's detail). */
export type LineageLine = { id: string; reference: string | null; nature: LineType };
/** A line next to this one that the person cannot read (data-scoped access): its reference alone, no link. */
export type HiddenLineageLine = { id: null; reference: string; nature: null; hidden: true };
export type LineLineageData = {
  predecessor: LineageLine | HiddenLineageLine | null;
  successor: (LineageLine & { from_year: number | null }) | (HiddenLineageLine & { from_year: null }) | null;
};

function isHidden(line: LineageLine | HiddenLineageLine): line is HiddenLineageLine {
  return (line as HiddenLineageLine).hidden === true;
}

const lineSx = { fontSize: 12, color: 'kanap.text.secondary', lineHeight: 1.5 } as const;

/**
 * "Follows BL-12 (OPEX line)" and "Replaced by BL-45 (CAPEX line) from 2026": the line this one
 * continues, and the one that continues it, after a change of type from a later year (lot M).
 * `onOpen` opens the other line (the page saves what is pending first). Nothing without either.
 * A line the person cannot read shows its reference alone ("Follows BL-12"), without a link.
 */
export default function LineLineage({ lineage, onOpen }: { lineage: LineLineageData | null | undefined; onOpen: (line: LineageLine) => void }) {
  const { t } = useTranslation('ops');
  const predecessor = lineage?.predecessor ?? null;
  const successor = lineage?.successor ?? null;
  if (!predecessor && !successor) return null;
  const link = (line: LineageLine) => (
    <Link
      component="button"
      type="button"
      underline="hover"
      onClick={() => onOpen(line)}
      sx={{ fontSize: 12, verticalAlign: 'baseline', fontFamily: 'inherit' }}
    />
  );
  const type = (line: LineageLine) => t(`shared.lineage.type.${line.nature}`);
  return (
    <Stack spacing={0.25} data-testid="line-lineage">
      {predecessor && isHidden(predecessor) && (
        <Typography sx={lineSx}>{t('shared.lineage.followsHidden', { reference: predecessor.reference })}</Typography>
      )}
      {predecessor && !isHidden(predecessor) && (
        <Typography sx={lineSx}>
          <Trans t={t} i18nKey="shared.lineage.follows" values={{ reference: predecessor.reference ?? '', type: type(predecessor) }} components={{ link: link(predecessor) }} />
        </Typography>
      )}
      {successor && isHidden(successor) && (
        <Typography sx={lineSx}>{t('shared.lineage.replacedByHidden', { reference: successor.reference })}</Typography>
      )}
      {successor && !isHidden(successor) && (
        <Typography sx={lineSx}>
          <Trans
            t={t}
            i18nKey={successor.from_year ? 'shared.lineage.replacedBy' : 'shared.lineage.replacedByNoYear'}
            values={{ reference: successor.reference ?? '', type: type(successor), year: successor.from_year ?? '' }}
            components={{ link: link(successor) }}
          />
        </Typography>
      )}
    </Stack>
  );
}

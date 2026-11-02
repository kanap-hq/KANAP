import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate } from '../lib/dateFormat';
import { attentionDotSx } from '../theme/formSx';

/**
 * `public/dev-build.json`, written by the maintainer's dev sync into the local dev image before
 * each rebuild (schema 1): main and the branches merged on top of it. Absent everywhere else.
 */
type DevBuildBranch = {
  name: string;
  label: string;
  state: string;
  pr: { number: number; state: string } | null;
};

export type DevBuild = {
  schema: 1;
  built_at: string;
  main: { date: string; pr: number | null };
  branches: DevBuildBranch[];
};

const isDevBuild = (value: unknown): value is DevBuild => {
  const build = value as DevBuild | null;
  return build?.schema === 1 && typeof build.main?.date === 'string' && Array.isArray(build.branches);
};

/**
 * The build description, or null. Only the dev server asks for it: without the file Vite answers
 * with the app page (text/html), which is read as "no build" without any console error.
 */
function useDevBuild(): DevBuild | null {
  const [build, setBuild] = React.useState<DevBuild | null>(null);
  React.useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    let active = true;
    fetch('/dev-build.json', { cache: 'no-store' })
      .then((res) => (res.ok && res.headers.get('content-type')?.includes('json') ? res.json() : null))
      .then((data: unknown) => { if (active && isDevBuild(data)) setBuild(data); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  return build;
}

const chipSx = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  flexShrink: 0,
  mr: 0.5,
  px: 1,
  height: 22,
  border: 1,
  borderColor: 'divider',
  borderRadius: 999,
  fontSize: 12,
  lineHeight: 1,
  whiteSpace: 'nowrap',
  color: 'text.secondary',
} as const;

const PR_STATE_KEYS: Record<string, string> = { open: 'devBuild.prOpen', merged: 'devBuild.prMerged', closed: 'devBuild.prClosed' };

/**
 * What the local dev stack runs, in the top bar: main with its date and last PR, plus the branches
 * merged on top. The tooltip lists the branches, those left out for a conflict included.
 */
export default function DevBuildIndicator() {
  const { t } = useTranslation('nav');
  const locale = useLocale();
  const build = useDevBuild();
  if (!build) return null;

  const when = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return { date: '', time: '' };
    return {
      date: formatShortDate(date, locale),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date),
    };
  };
  const branches = build.branches.filter((branch) => branch.state === 'in' || branch.state === 'conflit');
  const merged = branches.filter((branch) => branch.state === 'in').length;
  const hasConflict = branches.length > merged;
  const extra = merged > 0 ? ` + ${t('devBuild.branches', { count: merged })}` : '';
  const main = `${t('devBuild.main', when(build.main.date))}${build.main.pr ? ` (#${build.main.pr})` : ''}`;

  const details = (
    <Box sx={{ py: 0.25 }}>
      <Box>{t('devBuild.builtAt', when(build.built_at))}</Box>
      {branches.map((branch) => {
        const facts = [
          branch.state === 'conflit' ? t('devBuild.conflict') : null,
          branch.pr ? t(PR_STATE_KEYS[branch.pr.state] ?? 'devBuild.pr', { number: branch.pr.number }) : null,
        ].filter(Boolean).join(' · ');
        return (
          <Box key={branch.name} sx={{ mt: 0.75 }}>
            <Box>{branch.label || branch.name}</Box>
            {facts && <Box sx={{ opacity: 0.75 }}>{facts}</Box>}
          </Box>
        );
      })}
    </Box>
  );

  return (
    <Tooltip title={details} describeChild>
      <Box component="span" sx={chipSx} data-testid="dev-build-indicator">
        {hasConflict && <Box component="span" sx={attentionDotSx} />}
        {/* Below xl the section tabs need the room: "dev + 2", the rest in the tooltip. */}
        <Box component="span" sx={{ display: { xs: 'none', xl: 'inline' } }}>{`dev · ${main}${extra}`}</Box>
        <Box component="span" sx={{ display: { xs: 'inline', xl: 'none' } }}>{`dev${merged > 0 ? ` + ${merged}` : ''}`}</Box>
      </Box>
    </Tooltip>
  );
}

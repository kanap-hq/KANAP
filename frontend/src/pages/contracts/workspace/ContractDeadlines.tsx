import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { StatusDot } from '../../../components/design';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { fraction, type ContractSchedule, type ScheduleTimeline } from '../contractSchedule';

const pct = (value: number) => `${(value * 100).toFixed(3)}%`;

/**
 * The Deadlines section of a contract's overview: the state sentence, the timeline of its terms
 * and one line of facts. Orange marks urgency only (a deadline inside the decision window).
 */
export default function ContractDeadlines({ schedule }: { schedule: ContractSchedule | null }) {
  const { t } = useTranslation(['ops']);
  const theme = useTheme();
  const locale = useLocale();
  const date = (ymd: string | null | undefined) => formatShortDate(ymd, locale, { year: 'always' });
  const inDays = (days: number) => (days === 0 ? t('contracts.deadlines.today') : t('contracts.deadlines.inDays', { count: days }));

  if (!schedule) {
    return (
      <Stack spacing={1}>
        <RelationsSectionTitle>{t('contracts.deadlines.title')}</RelationsSectionTitle>
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('contracts.deadlines.noStart')}</Typography>
      </Stack>
    );
  }

  const { state } = schedule;
  let sentence: React.ReactNode;
  switch (state.kind) {
    case 'cancel':
      sentence = (
        <>
          {state.urgent && <StatusDot size={8} color={theme.palette.kanap.orange} />}
          <Box component="span" sx={{ fontWeight: 500 }}>{t('contracts.deadlines.cancelUntil', { date: date(state.deadline) })}</Box>
          <Box component="span" sx={{ color: 'kanap.text.secondary' }}>· {inDays(state.days)}</Box>
        </>
      );
      break;
    case 'renewed':
      sentence = (
        <>
          <Box component="span" sx={{ fontWeight: 500 }}>{t('contracts.deadlines.noticePassed', { date: date(state.renewedUntil) })}</Box>
          {state.nextDeadline && (
            <Box component="span" sx={{ color: 'kanap.text.secondary' }}>· {t('contracts.deadlines.nextDeadline', { date: date(state.nextDeadline) })}</Box>
          )}
        </>
      );
      break;
    case 'confirmed':
      sentence = (
        <>
          <Box component="span" sx={{ fontWeight: 500 }}>{t('contracts.deadlines.renewalConfirmed')}</Box>
          <Box component="span" sx={{ color: 'kanap.text.secondary' }}>· {t('contracts.deadlines.nextTerm', { start: date(state.nextStart), end: date(state.nextEnd) })}</Box>
        </>
      );
      break;
    case 'ends':
      sentence = (
        <>
          <Box component="span" sx={{ fontWeight: 500 }}>{t('contracts.deadlines.endsOn', { date: date(state.end) })}</Box>
          <Box component="span" sx={{ color: 'kanap.text.secondary' }}>· {t('contracts.deadlines.withoutRenewal')}</Box>
        </>
      );
      break;
    case 'expired':
      sentence = <Box component="span" sx={{ fontWeight: 500 }}>{t('contracts.deadlines.expiredOn', { date: date(state.end) })}</Box>;
      break;
    default:
      sentence = <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('contracts.deadlines.noDuration')}</Box>;
  }

  const facts: string[] = [];
  if (state.kind !== 'none') {
    const range = t('contracts.deadlines.fromTo', { start: date(schedule.termStart), end: date(schedule.termEnd) });
    const term = schedule.upcoming
      ? t('contracts.deadlines.termUpcoming', { number: schedule.termNumber })
      : state.kind === 'expired' || (schedule.lastTerm && schedule.renewals > 0)
        ? t('contracts.deadlines.termLast', { number: schedule.termNumber })
        : t('contracts.deadlines.termCurrent', { number: schedule.termNumber });
    facts.push(`${term} · ${range}`);
    if (schedule.renewals > 0) facts.push(t('contracts.deadlines.renewedTimes', { count: schedule.renewals, date: date(schedule.startDate) }));
  }
  facts.push(schedule.noticeMonths > 0 ? t('contracts.deadlines.notice', { count: schedule.noticeMonths }) : t('contracts.deadlines.noNotice'));

  return (
    <Stack spacing={1.25}>
      <RelationsSectionTitle>{t('contracts.deadlines.title')}</RelationsSectionTitle>
      <Box data-testid="contract-deadline-state" sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: 13, color: 'kanap.text.primary' }}>
        {sentence}
      </Box>
      {schedule.timeline && <TermsTimeline timeline={schedule.timeline} urgent={state.kind === 'cancel' && state.urgent} />}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: '18px', rowGap: '4px', fontSize: 12, color: 'kanap.text.secondary' }}>
        {facts.map((fact) => <span key={fact}>{fact}</span>)}
      </Box>
    </Stack>
  );
}

function TermsTimeline({ timeline, urgent }: { timeline: ScheduleTimeline; urgent: boolean }) {
  const { t } = useTranslation(['ops']);
  const theme = useTheme();
  const locale = useLocale();
  const k = theme.palette.kanap;
  const at = (ymd: string) => fraction(timeline, ymd);
  const width = (start: string, end: string) => Math.max(0, at(end) - at(start));
  // The span of a term runs to the day after its end.
  const nextDay = (ymd: string) => new Date(Date.parse(`${ymd}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const deadlineColor = urgent ? k.orange : k.text.secondary;

  const segmentLabel = (number: number, kind: string) => (
    kind === 'current' ? t('contracts.timeline.termCurrent', { number })
      : kind === 'projected' ? t('contracts.timeline.termProjected', { number })
        : kind === 'next' ? t('contracts.timeline.termNext', { number })
        : kind === 'upcoming' ? t('contracts.timeline.termUpcoming', { number })
          : t('contracts.timeline.term', { number })
  );

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Box
        role="img"
        aria-label={t('contracts.timeline.label')}
        sx={{ position: 'relative', height: 104, minWidth: 560, my: '4px' }}
      >
        {timeline.window && (
          <Box
            title={t('contracts.timeline.window')}
            sx={{
              position: 'absolute', top: 24, height: 34, borderRadius: '4px',
              left: pct(at(timeline.window.start)), width: pct(width(timeline.window.start, timeline.window.end)),
              bgcolor: urgent ? alpha(k.orange, 0.16) : k.bg.hover,
            }}
          />
        )}
        {timeline.segments.map((segment) => {
          const current = segment.kind === 'current' || segment.kind === 'upcoming';
          const projected = segment.kind === 'projected';
          const next = segment.kind === 'next';
          const label = segmentLabel(segment.number, segment.kind);
          return (
            <Box
              key={segment.number}
              title={`${label} · ${formatShortDate(segment.start, locale, { year: 'always' })} – ${formatShortDate(segment.end, locale, { year: 'always' })}`}
              sx={{
                position: 'absolute', top: 30, height: 22, borderRadius: '4px', px: '6px',
                left: `calc(${pct(at(segment.start))} + 1px)`, width: `calc(${pct(width(segment.start, nextDay(segment.end)))} - 2px)`,
                display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 11,
                bgcolor: projected || next ? 'transparent' : current ? k.text.secondary : k.border.strong,
                border: projected ? `1px dashed ${k.text.secondary}` : next ? `1px solid ${k.text.secondary}` : 'none',
                color: current ? k.bg.primary : k.text.secondary,
              }}
            >
              {label}
            </Box>
          );
        })}
        <Marker left={at(timeline.today)} color={k.text.primary} label={t('contracts.timeline.today')} position="top" />
        {timeline.deadline && (
          <Marker
            left={at(timeline.deadline)}
            color={deadlineColor}
            dashed
            label={t('contracts.timeline.deadline', { date: formatShortDate(timeline.deadline, locale, { year: 'always' }) })}
            position="bottom"
          />
        )}
        {timeline.years.map((year) => (
          <Box
            key={year}
            sx={{ position: 'absolute', bottom: 0, left: pct(at(year)), transform: 'translateX(-50%)', fontSize: 11, color: k.text.tertiary, whiteSpace: 'nowrap' }}
          >
            {year.slice(0, 4)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function Marker({ left, color, label, position, dashed = false }: { left: number; color: string; label: string; position: 'top' | 'bottom'; dashed?: boolean }) {
  // A label near the right edge sits on the left of its line.
  const flip = left > 0.8;
  return (
    <Box sx={{ position: 'absolute', top: 14, bottom: 38, left: pct(left), width: 0, borderLeft: `1px ${dashed ? 'dashed' : 'solid'} ${color}` }}>
      <Box
        component="span"
        sx={{
          position: 'absolute', whiteSpace: 'nowrap', fontSize: 11, color,
          ...(position === 'top' ? { top: -14 } : { bottom: -16 }),
          ...(flip ? { right: 4 } : { left: 4 }),
        }}
      >
        {label}
      </Box>
    </Box>
  );
}

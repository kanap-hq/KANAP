import type { TFunction } from 'i18next';
import type { IncidentStatus } from '../../../api/endpoints/incidents';
import { longFormSurfaceFieldSx } from '../../../theme/formSx';

/** Lifecycle order; the status control only moves forward, backward moves go through Reopen. */
export const INCIDENT_STATUS_FLOW: IncidentStatus[] = ['open', 'in_progress', 'resolved', 'closed'];

export function isIncidentLocked(status: IncidentStatus): boolean {
  return status === 'closed' || status === 'cancelled';
}

export function isForwardStatusMove(from: IncidentStatus, to: IncidentStatus): boolean {
  if (from === to) return true;
  const fromIndex = INCIDENT_STATUS_FLOW.indexOf(from);
  const toIndex = INCIDENT_STATUS_FLOW.indexOf(to);
  return fromIndex >= 0 && toIndex > fromIndex;
}

export function incidentSeverityLabel(t: TFunction, severity: string | null | undefined): string {
  return severity ? t(`enums.incidentSeverity.${severity}`, { defaultValue: severity }) : '';
}

export function incidentStatusLabel(t: TFunction, status: string | null | undefined): string {
  return status ? t(`enums.incidentStatus.${status}`, { defaultValue: status }) : '';
}

/** Detected → resolved duration as "3d 4h", "2h 15m" or "45m". */
export function formatIncidentDuration(t: TFunction, from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const daysLabel = t('workspace.incident.duration.days', { count: days });
  const hoursLabel = t('workspace.incident.duration.hours', { count: hours });
  const minutesLabel = t('workspace.incident.duration.minutes', { count: minutes });
  if (days > 0) return `${daysLabel} ${hoursLabel}`;
  if (hours > 0) return `${hoursLabel} ${minutesLabel}`;
  return minutesLabel;
}

export function incidentInitials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export const incidentSectionLabelSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  mb: 1,
  display: 'block',
} as const;

/** Long-form composer surface: the shared one without its min height / max width. */
export const incidentComposerSx = [
  longFormSurfaceFieldSx,
  { maxWidth: 'none', '& .MuiInputBase-root': { minHeight: 0 } },
] as const;

/** The journal of one incident (`IncidentJournalTab`), by uuid. */
export function incidentEntriesQueryKey(incidentId: string) {
  return ['incident-entries', incidentId] as const;
}

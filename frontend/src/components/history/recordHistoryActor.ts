import type { Translate } from '../../lib/audit/auditLogLabels';

/**
 * Who wrote an entry of a record's History tab and what the entry did, in words (`admin`
 * namespace, `auditLogs.*`). Kept apart from `recordHistoryText.ts`, whose value formatters load
 * the i18n instance, so that the chat's tool results can name a history entry as the tab does.
 */

export type RecordHistoryActorKind = 'user' | 'system' | 'import' | 'assistant';
export type RecordHistoryActor = { kind: RecordHistoryActorKind; name: string | null };

/**
 * The event of the record itself: Created, Updated or Deleted. A child's technical action is never
 * shown (its title or its event line says what happened); an unknown action keeps the audit log's
 * own label, and a missing history label falls back to it.
 */
export function historyActionText(action: string, t: Translate): string {
  const code = String(action ?? '').trim().toLowerCase();
  if (!code) return '';
  const historyLabel = t(`auditLogs.history.actions.${code}`, { defaultValue: '' });
  if (historyLabel && historyLabel !== `auditLogs.history.actions.${code}`) return historyLabel;
  return t(`auditLogs.actions.${code}`, { defaultValue: action });
}

export function historyActorText(actor: RecordHistoryActor, t: Translate): string {
  switch (actor.kind) {
    case 'system':
      return t('auditLogs.sources.system');
    case 'import':
      return t('auditLogs.sources.import');
    case 'assistant':
      return actor.name
        ? t('auditLogs.history.actors.assistantFor', { name: actor.name })
        : t('auditLogs.history.actors.assistant');
    case 'user':
    default:
      return actor.name || t('auditLogs.history.actors.unknown');
  }
}

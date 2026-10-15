export const STATUS_ENABLED = 'enabled' as const;
export const STATUS_DISABLED = 'disabled' as const;

export const STATUS_VALUES = [STATUS_ENABLED, STATUS_DISABLED] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

export const isStatusEnabled = (status: unknown): status is typeof STATUS_ENABLED =>
  String(status).toLowerCase() === STATUS_ENABLED;

export const isStatusDisabled = (status: unknown): status is typeof STATUS_DISABLED =>
  String(status).toLowerCase() === STATUS_DISABLED;

export const normalizeStatus = (status: unknown): StatusValue =>
  isStatusDisabled(status) ? STATUS_DISABLED : STATUS_ENABLED;

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function deriveStatusFromDisabledAt(disabledAt: string | Date | null | undefined, asOf: Date = new Date()): StatusValue {
  const date = parseDate(disabledAt);
  if (!date) return STATUS_ENABLED;
  return date.getTime() <= asOf.getTime() ? STATUS_DISABLED : STATUS_ENABLED;
}

export function normalizeDisabledAtInput(value: string | Date | null | undefined): string | null {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

/**
 * The lifecycle a form sends. Disabled with no end of validity is "disable now" (the lifecycle
 * switch turned off): the status goes alone and the server sets the end of validity from its own
 * clock. Otherwise the end of validity decides the status.
 */
export function lifecyclePayload(
  status: StatusValue,
  disabledAt: string | Date | null | undefined,
): { status: StatusValue; disabled_at?: string | null } {
  const disabled_at = normalizeDisabledAtInput(disabledAt);
  if (status === STATUS_DISABLED && !disabled_at) return { status: STATUS_DISABLED };
  return { status: deriveStatusFromDisabledAt(disabled_at), disabled_at };
}

/** Whether two lifecycles are the same: the status and the end of validity, as instants. */
export function sameLifecycle(
  a: { status: unknown; disabled_at: string | Date | null | undefined },
  b: { status: unknown; disabled_at: string | Date | null | undefined },
): boolean {
  return normalizeStatus(a.status) === normalizeStatus(b.status)
    && normalizeDisabledAtInput(a.disabled_at) === normalizeDisabledAtInput(b.disabled_at);
}

/**
 * The patch a status menu sends, or null when the choice changes nothing. Choosing the status
 * shown sends nothing, so a future end of validity stays. Disabled goes alone: the server ends
 * the record now, on its own clock, or keeps an end already passed. Enabled clears the end.
 */
export function statusChoicePatch(
  next: StatusValue,
  current: { status: unknown; disabled_at: string | Date | null | undefined },
): { status: StatusValue; disabled_at?: null } | null {
  if (next === normalizeStatus(current.status) && next === deriveStatusFromDisabledAt(current.disabled_at)) return null;
  return next === STATUS_DISABLED ? { status: STATUS_DISABLED } : { status: STATUS_ENABLED, disabled_at: null };
}

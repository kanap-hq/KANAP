/**
 * The field of a budget line a refusal of the server is about, by the server's English message
 * (`item-write.util.ts`, `item-analytics.util.ts`): the screen says it under that field rather than
 * at the top of the page.
 */

/** A refusal about the account (the write gate's, and the in-place change of type's own). */
const ACCOUNT_REFUSALS = [
  /^Account is required\.$/,
  /^Account not found\.$/,
  /^Selected account does not belong to the paying company's Chart of Accounts/,
  /^This account is for (OPEX|CAPEX) lines only\./,
  /^Choose an account, or leave the field as it is\.$/,
];
export const isAccountRefusal = (message: string) => ACCOUNT_REFUSALS.some((pattern) => pattern.test(message));

const COMPANY_REFUSALS = [/^Paying company is required\.$/, /^Paying company not found\.$/];
const COST_CENTER_REFUSALS = [/^Cost center not found\.$/, /^Choose a cost center, not a group\.$/, /^This cost center is disabled\.$/];
const PLACEMENT_REFUSAL = 'This company or cost center is not part of your access.';

type Refused = { response?: { data?: { message?: unknown } } };

/** "Plant is for CAPEX lines only. Choose a value for OPEX lines.": a value of the other type (`notApplicableValueMessage`). */
const VALUE_OF_OTHER_TYPE = /^(.+) is for (?:OPEX|CAPEX) lines only\. Choose a value for (?:OPEX|CAPEX) lines\.$/;

const messageOf = (error: unknown): unknown => (error as Refused | null)?.response?.data?.message;

/** The name of the dimension value a refusal names, or null when it names none. */
export function refusedValueName(error: unknown): string | null {
  const message = messageOf(error);
  return typeof message === 'string' ? VALUE_OF_OTHER_TYPE.exec(message)?.[1] ?? null : null;
}

/**
 * The key of the field a refusal of a line write names (`account`, `paying_company`,
 * `cost_center`, `dimension:<id>`), or null when it names none. A refused place is the cost
 * center's when the line has one, else the company's. A dimension is found by its name in the
 * message (`The Menu dimension is required.`), or by the name of its value the line holds
 * (`values`, the line's values as the lookup reads them) when the message names the value.
 */
export function lineRefusalField(
  error: unknown,
  line: { cost_center_id: string; analytics_values?: Readonly<Record<string, string | null>> },
  axes: ReadonlyArray<{ id: string; name: string | null }>,
  values: ReadonlyArray<{ id: string; name: string }> = [],
): string | null {
  const message = messageOf(error);
  if (typeof message !== 'string') return null;
  const valueName = refusedValueName(error);
  if (valueName) {
    const held = Object.entries(line.analytics_values ?? {})
      .find(([, id]) => !!id && values.some((value) => value.id === id && value.name === valueName));
    return held ? `dimension:${held[0]}` : null;
  }
  if (isAccountRefusal(message)) return 'account';
  if (COMPANY_REFUSALS.some((pattern) => pattern.test(message))) return 'paying_company';
  if (COST_CENTER_REFUSALS.some((pattern) => pattern.test(message))) return 'cost_center';
  if (message === PLACEMENT_REFUSAL) return line.cost_center_id ? 'cost_center' : 'paying_company';
  const lower = message.toLowerCase();
  const axis = axes.find((candidate) => !!candidate.name?.trim() && lower.includes(`the ${candidate.name.trim().toLowerCase()} dimension`));
  return axis ? `dimension:${axis.id}` : null;
}

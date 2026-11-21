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

/**
 * The key of the field a refusal of a line write names (`account`, `paying_company`,
 * `cost_center`, `dimension:<id>`), or null when it names none. A refused place is the cost
 * center's when the line has one, else the company's. A dimension is found by its name in the
 * message (`The Menu dimension is required.`).
 */
export function lineRefusalField(
  error: unknown,
  line: { cost_center_id: string },
  axes: ReadonlyArray<{ id: string; name: string | null }>,
): string | null {
  const message = (error as Refused | null)?.response?.data?.message;
  if (typeof message !== 'string') return null;
  if (isAccountRefusal(message)) return 'account';
  if (COMPANY_REFUSALS.some((pattern) => pattern.test(message))) return 'paying_company';
  if (COST_CENTER_REFUSALS.some((pattern) => pattern.test(message))) return 'cost_center';
  if (message === PLACEMENT_REFUSAL) return line.cost_center_id ? 'cost_center' : 'paying_company';
  const lower = message.toLowerCase();
  const axis = axes.find((candidate) => !!candidate.name?.trim() && lower.includes(`the ${candidate.name.trim().toLowerCase()} dimension`));
  return axis ? `dimension:${axis.id}` : null;
}

/**
 * The account as lists, filters and forms show it: "6110 - Software", or the
 * number alone when the account has no name. The budget list computes the
 * same text (`accountDisplayText` in the API, `budget-list.config.ts`).
 */
export function accountDisplayText(accountNumber: unknown, accountName: unknown): string {
  const name = accountName == null ? '' : String(accountName);
  return name === '' ? String(accountNumber) : `${accountNumber} - ${name}`;
}

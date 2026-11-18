/**
 * The imports of the V1 dialog that read a blank cell as "keep the stored value" and `-` as "clear it"
 * (D21 of 26.11.9, lot I4): the dialog says so beside its title. The users and data access imports
 * do not follow the rule yet (lot I6), nor do the chart of accounts templates, which replace.
 */
const CLEARING_RULE_ENDPOINT = new RegExp(
  '^/(?:suppliers|contacts|companies|departments|contracts|cost-centers|accounts|chart-of-accounts/[^/]+/accounts'
    + '|analytics-categories|business-processes|working-day-profiles|technologies/(?:asset|application)-links)$',
);

/** Whether the import of `endpoint` (the list's endpoint, `/suppliers`) follows the clearing rule. */
export function importFollowsClearingRule(endpoint: string): boolean {
  return CLEARING_RULE_ENDPOINT.test(String(endpoint ?? '').split('?')[0].replace(/\/+$/, ''));
}

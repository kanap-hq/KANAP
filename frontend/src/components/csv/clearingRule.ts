/**
 * The imports that read a blank cell as "keep the stored value" and `-` as "clear it" (D21 of 26.11.9:
 * lot I4 for the V1 dialog, lot I6 for the V2 dialog and the users): the dialog says so beside its
 * title. The data access import sets each person's whole list and the chart of accounts templates
 * replace: they have no cell to keep.
 */
const CLEARING_RULE_ENDPOINT = new RegExp(
  '^/(?:suppliers|contacts|companies|departments|contracts|cost-centers|accounts|chart-of-accounts/[^/]+/accounts'
    + '|analytics-categories|business-processes|working-day-profiles|technologies/(?:asset|application)-links'
    + '|applications|assets|tasks|incidents|portfolio/(?:projects|requests)|users)$',
);

/** Whether the import of `endpoint` (the list's endpoint, `/suppliers`) follows the clearing rule. */
export function importFollowsClearingRule(endpoint: string): boolean {
  return CLEARING_RULE_ENDPOINT.test(String(endpoint ?? '').split('?')[0].replace(/\/+$/, ''));
}

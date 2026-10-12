/** A small aggregate response for tests that exercise real grid requests and links. */
export function budgetFooterFixture(measures: Array<{ id: string }> = [], amount = 10) {
  const values = Object.fromEntries(measures.map(({ id }) => [id, amount]));
  const total = { keys: [] as string[], count: 1, values, unknown: {} };
  return { data: {
    total,
    groups: [{ ...total, keys: ['opex'] }],
    others: null,
    groupCount: 1,
    reportingCurrency: 'EUR',
  } };
}

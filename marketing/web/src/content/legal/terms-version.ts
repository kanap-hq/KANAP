/**
 * The version of the general terms of sale (`sales` in fr.ts and en.ts) that the Enterprise
 * Support form sends when the visitor accepts them. It must equal GTC_VERSION in
 * `backend/src/billing/terms.ts` (the backend refuses any other version; a backend spec checks
 * they match): bump both whenever the `sales` text changes.
 */
export const GTC_VERSION = '2026-10-12';

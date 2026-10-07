import type { TFunction } from 'i18next';

/** EU member states (ISO 3166-1 alpha-2). The backend keeps its own copy in billing-profile.util.ts. */
export const EU_COUNTRY_CODES: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

export function isEuCountry(code: string | null | undefined): boolean {
  return !!code && EU_COUNTRY_CODES.includes(code.trim().toUpperCase());
}

/**
 * "Complete the invoicing information before subscribing: company, email." from the
 * field keys the API returns in `invoice_missing_fields` or a BILLING_PROFILE_INCOMPLETE error.
 */
export function invoiceProfileIncompleteMessage(missing: readonly string[], t: TFunction): string {
  const fields = missing
    .map((key) => t(`admin:planSelection.invoiceFields.${key}`, { defaultValue: key }))
    .join(', ');
  return t('admin:planSelection.profile.incomplete', { fields });
}

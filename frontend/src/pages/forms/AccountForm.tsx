import { z } from 'zod';
import type { TFunction } from 'i18next';
import { STATUS_DISABLED, STATUS_ENABLED, STATUS_VALUES, StatusValue, deriveStatusFromDisabledAt, normalizeDisabledAtInput } from '../../constants/status';
import { ACCOUNT_NATURES, type AccountNature } from '../../constants/accountNature';

const optStr = (schema = z.string()) =>
  z.preprocess((v) => {
    if (v === '' || v == null) return null;
    const result = schema.safeParse(v);
    return result.success ? result.data : null;
  }, z.string().nullable());

const optInt = () =>
  z.preprocess((v) => {
    if (v === '' || v == null) return null;
    const num = Number(v);
    return isNaN(num) ? null : num;
  }, z.number().int().nullable());

const optDateTime = () =>
  z.preprocess((v) => {
    if (v === '' || v == null) return null;
    return typeof v === 'string' ? v : null;
  }, z.string().datetime().nullable());

/** "Used for": 'opex', 'capex', or null (empty) for both. */
const optNature = () =>
  z.preprocess((v) => (v === '' || v == null ? null : v), z.enum(ACCOUNT_NATURES).nullable());

export function createAccountFormSchema(t: TFunction) {
  return z.object({
    account_number: z.number().int().min(1, t('master-data:formSchemas.account.accountNumberRequired')),
    account_name: z.string().min(1, t('master-data:formSchemas.account.accountNameRequired')),
    native_name: optStr(),
    description: optStr(),
    consolidation_account_number: optInt(),
    consolidation_account_name: optStr(),
    consolidation_account_description: optStr(),
    nature: optNature(),
    status: z.enum(STATUS_VALUES).default(STATUS_ENABLED),
    disabled_at: optDateTime(),
  });
}

/** @deprecated Use createAccountFormSchema(t) for i18n support */
export const accountFormSchema = createAccountFormSchema(((key: string) => key) as unknown as TFunction);

export type AccountFormValues = z.infer<typeof accountFormSchema>;
export type AccountInput = {
  account_number: number;
  account_name: string;
  description?: string | null;
  consolidation_account_number?: number | null;
  consolidation_account_name?: string | null;
  consolidation_account_description?: string | null;
  nature?: AccountNature | null;
  status: StatusValue;
  disabled_at?: string | null;
};

function normalizeEmptyToNull<T extends Record<string, any>>(obj: T): T {
  const out: any = Array.isArray(obj) ? [] : {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v === '') out[k] = null;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = normalizeEmptyToNull(v as any);
    else out[k] = v;
  });
  return out;
}

// Note: UI form removed; this file now only exports schema and types.
export { normalizeEmptyToNull };

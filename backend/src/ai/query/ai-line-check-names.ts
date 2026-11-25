import { BUDGET_LINE_CHECKS, type BudgetLineCheck } from '../../spend/budget-line-checks';
import { AI_SCREEN_LANGUAGES, type AiScreenLanguage } from '../ai-unread-families';

/**
 * The names of the budget line checks (`to_check`) as the "To check" column of the budget list
 * shows them, copied from `frontend/src/locales/<lang>/ops.json` (`shared.*`, compared by
 * `ai-line-check-names.spec.ts`). Kad and the MCP server read them next to the codes
 * (`to_check_names`, a group's `key_name`, `value_names` of the filter values), in the person's
 * language, so that an answer names a check as the screen does and never quotes its code.
 */
export const BUDGET_LINE_CHECK_LABEL_KEYS: Record<BudgetLineCheck, string> = {
  quantity_price: 'shared.quantityPrice',
  coa_mismatch: 'shared.accountOutsideChart',
};

export const BUDGET_LINE_CHECK_LABELS: Record<AiScreenLanguage, Record<BudgetLineCheck, string>> = {
  en: { quantity_price: 'Quantity and price', coa_mismatch: 'Account not in the company\'s chart' },
  fr: { quantity_price: 'Quantité et prix', coa_mismatch: 'Compte hors du plan de la société' },
  de: { quantity_price: 'Menge und Preis', coa_mismatch: 'Konto nicht im Kontenplan des Unternehmens' },
  es: { quantity_price: 'Cantidad y precio', coa_mismatch: 'Cuenta fuera del plan de la empresa' },
};

const isCheck = (code: string): code is BudgetLineCheck => (BUDGET_LINE_CHECKS as readonly string[]).includes(code);

/** Several checks named in one language, in the order given: "Quantité et prix, Compte hors du plan de la société". */
function namesIn(codes: readonly string[], language: AiScreenLanguage): string {
  return codes.map((code) => (isCheck(code) ? BUDGET_LINE_CHECK_LABELS[language][code] : code)).join(', ');
}

/** One check by its name on screen, in the person's language, or in the four languages ("en: …; fr: …") when it is not known. */
export function budgetLineCheckName(code: string, language: AiScreenLanguage | null): string {
  if (language) return namesIn([code], language);
  return AI_SCREEN_LANGUAGES.map((lang) => `${lang}: ${namesIn([code], lang)}`).join('; ');
}

/** The names of a line's `to_check`, in the same order and form (null when it fails none). */
export function budgetLineCheckNames(codes: readonly string[] | null, language: AiScreenLanguage | null): string[] | null {
  return codes?.length ? codes.map((code) => budgetLineCheckName(code, language)) : null;
}

/** The name of a group key of `to_check` (the codes joined by ", "), null for the lines that fail none. */
export function budgetLineCheckKeyName(key: string | null, language: AiScreenLanguage | null): string | null {
  if (key == null || key === '') return null;
  const codes = key.split(', ');
  if (language) return namesIn(codes, language);
  return AI_SCREEN_LANGUAGES.map((lang) => `${lang}: ${namesIn(codes, lang)}`).join('; ');
}

import { de } from './email-locales/de';
import { en, type EmailStrings } from './email-locales/en';
import { es } from './email-locales/es';
import { fr } from './email-locales/fr';

const NO_BREAK_SPACE = '\u00a0';
const NARROW_NO_BREAK_SPACE = '\u202f';

/** French typography, as the application applies it (`frontend/src/i18n/formatters.ts`). */
export function frenchSpacing(value: string): string {
  return value
    .replace(/« /g, `«${NO_BREAK_SPACE}`)
    .replace(/ »/g, `${NO_BREAK_SPACE}»`)
    .replace(/ :/g, `${NO_BREAK_SPACE}:`)
    .replace(/ ([;!?])/g, `${NARROW_NO_BREAK_SPACE}$1`);
}

/** Every text of a locale through `format`: the texts only, never the values put into them. */
function formatTexts<T>(value: T, format: (text: string) => string): T {
  if (typeof value === 'string') return format(value) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, formatTexts(inner, format)]),
  ) as T;
}

const locales = {
  en,
  fr: formatTexts(fr, frenchSpacing),
  de,
  es,
} as const satisfies Record<string, EmailStrings>;

export type SupportedEmailLocale = keyof typeof locales;

export function resolveEmailLocale(raw: string | null | undefined): SupportedEmailLocale {
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase()
    .split(/[-;,]/)[0]
    .trim();

  if (normalized in locales) {
    return normalized as SupportedEmailLocale;
  }

  return 'en';
}

export function getEmailStrings(locale: string | null | undefined): EmailStrings {
  return locales[resolveEmailLocale(locale)] ?? locales.en;
}

export function interpolate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ''));
}

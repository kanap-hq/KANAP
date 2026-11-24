import type { CsvLanguage } from '../common/csv-sheet/types';

/**
 * The screen's names of an application's fixed values (not tenant catalogs), per language: the
 * export writes them (`applications-csv.service.ts`) and Kad reads them next to the codes
 * (`ai/ai-code-names.ts`, whose spec checks them against the screens' words).
 */
export const APPLICATION_FIXED_LABELS: Record<string, Record<string, Record<CsvLanguage, string>>> = {
  classification_review_state: {
    incomplete: { en: 'To complete', fr: 'À compléter', de: 'Zu vervollständigen', es: 'Por completar' },
    stale: { en: 'Review needed', fr: 'À revoir', de: 'Erneut prüfen', es: 'Por revisar' },
    reviewed: { en: 'Reviewed', fr: 'Revu', de: 'Geprüft', es: 'Revisado' },
  },
  users_mode: {
    manual: { en: 'Manual', fr: 'Manuel', de: 'Manuell', es: 'Manual' },
    // The screen offers "Derived" and "Manual" only; both derived modes read as "Derived".
    it_users: { en: 'Derived', fr: 'Dérivé', de: 'Abgeleitet', es: 'Derivado' },
    headcount: { en: 'Derived', fr: 'Dérivé', de: 'Abgeleitet', es: 'Derivado' },
  },
};

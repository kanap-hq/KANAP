import { describe, expect, it } from 'vitest';
import i18n from '../i18n';

const localeFiles = import.meta.glob<{ default: Record<string, unknown> }>('./fr/*.json', { eager: true });

function strings(tree: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof tree === 'string') return [[path.join('.'), tree]];
  if (!tree || typeof tree !== 'object') return [];
  return Object.entries(tree as Record<string, unknown>).flatMap(([key, value]) => strings(value, [...path, key]));
}

// Glossary: an IT asset is "actif". Refuse the English word in French values.
// {{asset}} is an interpolation name, not a displayed word, so placeholders are removed first.
const ENGLISH_ASSET = /\bassets?\b/i;
const INTERPOLATION = /\{\{[^}]+\}\}/g;

describe('French glossary term for an asset', () => {
  it('does not use the English word assets in French values', () => {
    const offenders = Object.entries(localeFiles).flatMap(([file, module]) =>
      strings(module.default)
        .filter(([, text]) => ENGLISH_ASSET.test(text.replace(INTERPOLATION, '')))
        .map(([key, text]) => `${file} ${key}: ${text}`),
    );
    expect(offenders).toEqual([]);
  });

  it('names actifs in the empty chat', () => {
    expect(i18n.t('ai:workspace.empty.subtitle', { lng: 'fr' })).toBe(
      "Posez n'importe quelle question sur vos tâches, projets, actifs ou documents.",
    );
  });
});

describe('included model usage indicator', () => {
  it.each([
    [
      'fr',
      'Limite mensuelle atteinte. Réinitialisation le 12.03.2026.',
      'Limite mensuelle atteinte.',
      'Configurer votre propre fournisseur',
      '1 message restant ce mois-ci',
      '4 messages restants ce mois-ci',
    ],
    [
      'de',
      'Monatliches Limit erreicht. Wird am 12.03.2026 zurückgesetzt.',
      'Monatliches Limit erreicht.',
      'Eigenen Anbieter konfigurieren',
      'Noch 1 Nachricht in diesem Monat',
      'Noch 4 Nachrichten in diesem Monat',
    ],
    [
      'es',
      'Límite mensual alcanzado. Se restablece el 12.03.2026.',
      'Límite mensual alcanzado.',
      'Configurar su propio proveedor',
      '1 mensaje restante este mes',
      '4 mensajes restantes este mes',
    ],
  ])('words the indicator in %s', (lng, limitReached, cta, openSettings, one, other) => {
    const resetDate = '12.03.2026';
    expect(i18n.t('ai:usageIndicator.limitReached', { lng, resetDate })).toBe(limitReached);
    expect(i18n.t('ai:usageIndicator.limitReachedCta', { lng })).toBe(cta);
    expect(i18n.t('ai:usageIndicator.openSettings', { lng })).toBe(openSettings);
    expect(i18n.t('ai:usageIndicator.remaining', { lng, count: 1 })).toBe(one);
    expect(i18n.t('ai:usageIndicator.remaining', { lng, count: 4 })).toBe(other);
  });
});

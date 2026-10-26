import type { CsvLanguage } from '../common/csv-sheet';
import { ENVIRONMENTS, type EnvironmentValue } from './services/assets-base.service';

/**
 * The environment names the asset screen shows (`it:enums.environment`), one map per language.
 * The same words as the Applications export of a technology.
 */
export const ASSET_ENVIRONMENT_LABELS: Record<CsvLanguage, Record<EnvironmentValue, string>> = {
  en: { prod: 'Prod', pre_prod: 'Pre-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
  fr: { prod: 'Prod', pre_prod: 'Pré-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Bac à sable' },
  de: { prod: 'Prod', pre_prod: 'Pre-Prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
  es: { prod: 'Prod', pre_prod: 'Pre-prod', qa: 'QA', test: 'Test', dev: 'Dev', sandbox: 'Sandbox' },
};

const CODE_BY_LABEL = new Map<string, EnvironmentValue>();
for (const code of ENVIRONMENTS) {
  CODE_BY_LABEL.set(code, code);
  for (const labels of Object.values(ASSET_ENVIRONMENT_LABELS)) {
    CODE_BY_LABEL.set(labels[code].toLocaleLowerCase('und'), code);
  }
}

/** The name written in a file of `language`. An unknown code stays as stored. */
export function assetEnvironmentLabel(code: string, language: CsvLanguage): string {
  return ASSET_ENVIRONMENT_LABELS[language][code as EnvironmentValue] ?? code;
}

/**
 * The code a cell names: the stored code, or the name the screen shows in any language.
 * Null when the cell matches neither.
 */
export function assetEnvironmentCode(value: unknown): EnvironmentValue | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return CODE_BY_LABEL.get(text.toLocaleLowerCase('und')) ?? null;
}

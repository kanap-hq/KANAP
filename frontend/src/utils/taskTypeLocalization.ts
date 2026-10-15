import i18n from '../i18n';
import type { CatalogLocale } from '../services/itOpsSettings';
import { localizeCatalogItem, type CatalogDefaults, type DefaultCopy } from './catalogLocalization';

// The task types every tenant starts with, as the backend seeds them (DEFAULT_TASK_TYPES in
// backend/src/portfolio/portfolio-task-type.entity.ts). A type that still carries its code and the
// shipped English text is shown in the user's language; a renamed or added type shows its own text.
const TASK_TYPE_SOURCE: Record<string, DefaultCopy> = {
  task: { label: 'Task', description: 'Standard task or work item' },
  bug: { label: 'Bug', description: 'Software defect or error' },
  problem: { label: 'Problem', description: 'Operational issue requiring investigation' },
  incident: { label: 'Incident', description: 'Service disruption or security event' },
};

const TASK_TYPE_DEFAULTS: CatalogDefaults = {
  source: TASK_TYPE_SOURCE,
  translated: (locale, code) => {
    const value = i18n.getResource(locale, 'common', `taskTypes.${code}`) as Partial<DefaultCopy> | undefined;
    return value && typeof value.label === 'string' ? { label: value.label, description: value.description } : undefined;
  },
};

export type TaskTypeLike = { name: string; code?: string | null; description?: string | null };

/** The task type as shown in `locale`: name and description translated while they are the shipped ones. */
export function localizeTaskType<T extends TaskTypeLike>(type: T, locale: CatalogLocale): T {
  const localized = localizeCatalogItem(
    { code: type.code ?? '', label: type.name, description: type.description ?? undefined },
    locale,
    type.code ? TASK_TYPE_DEFAULTS : undefined,
  );
  if (localized.label === type.name && (localized.description ?? null) === (type.description ?? null)) return type;
  return { ...type, name: localized.label, ...(type.description == null ? {} : { description: localized.description ?? type.description }) };
}

/** The name of a task type as shown in `locale` (null and empty names stay as they are). */
export function taskTypeLabel(name: string, code: string | null | undefined, locale: CatalogLocale): string;
export function taskTypeLabel(name: string | null | undefined, code: string | null | undefined, locale: CatalogLocale): string | null | undefined;
export function taskTypeLabel(name: string | null | undefined, code: string | null | undefined, locale: CatalogLocale) {
  if (!name) return name;
  return localizeTaskType({ name, code }, locale).name;
}

/** Whether `name` is the shipped English name of the type `code`: the name is then shown in each user's language. */
export function keepsShippedName(name: string, code: string | null | undefined): boolean {
  const source = code ? TASK_TYPE_SOURCE[code] : undefined;
  return !!source && source.label === name;
}

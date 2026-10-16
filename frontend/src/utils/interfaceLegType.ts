import type { TFunction } from 'i18next';

/** An interface step type (extract, transform, load, direct) in the reader's language; an unknown value as stored. */
export function legTypeLabel(t: TFunction, legType: string | null | undefined): string {
  if (!legType) return '';
  return t(`it:enums.legType.${legType}`, { defaultValue: legType });
}

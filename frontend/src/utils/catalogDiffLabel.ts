import type { TFunction } from 'i18next';
import { shippedCodeForLabel } from './itOpsCatalogDefaults';

const LIFECYCLE: Record<string, string> = {
  proposed: 'Proposed',
  active: 'Active',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

function codeOf(table: Record<string, string>, value: string): string | null {
  const wanted = value.trim().toLowerCase();
  for (const [code, label] of Object.entries(table)) {
    if (code.toLowerCase() === wanted || label.toLowerCase() === wanted) return code;
  }
  return null;
}

function translated(t: TFunction, key: string, fallback: string): string {
  const value = t(key, { defaultValue: '' });
  if (typeof value === 'string' && value.trim() && value !== key) return value;
  return fallback;
}

/**
 * A preview difference in the screen language. Shipped catalogue labels
 * (asset type, lifecycle, domain) are translated. A tenant's own wording,
 * a name or a free value stays as stored.
 */
export function catalogDiffLabel(
  field: string,
  value: string | null | undefined,
  t: TFunction,
): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (field === 'status') {
    const code = codeOf(LIFECYCLE, raw);
    return code ? translated(t, `common:statuses.${code}`, raw) : raw;
  }
  if (field === 'kind') {
    const code = shippedCodeForLabel('serverKinds', raw);
    return code ? translated(t, `it:catalogDefaults.serverKinds.${code}`, raw) : raw;
  }
  if (field === 'domain') {
    const code = shippedCodeForLabel('domains', raw);
    return code ? translated(t, `it:catalogDefaults.domains.${code}`, raw) : raw;
  }
  return raw;
}

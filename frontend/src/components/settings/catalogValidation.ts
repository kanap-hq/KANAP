/** Write-time rules mirrored from the server: names are the visible identity of catalog values. */
export type CatalogRow = { code?: string; label?: string; localId?: string };
export type CatalogIssue = 'nameRequired' | 'nameExists' | 'nameMatchesCode' | 'noComma';

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

/**
 * Issues keyed by row index. A list with issues must not be sent. A row of `skipCodes` (managed by
 * the server) is not checked itself, but its name stays taken: the server keeps it in the list.
 */
export function catalogListIssues(rows: CatalogRow[], options: { forbidComma?: boolean; skipCodes?: Set<string> } = {}): Map<number, CatalogIssue> {
  const issues = new Map<number, CatalogIssue>();
  const names = new Map<string, number>();
  const codes = new Map<string, number>();
  rows.forEach((row, index) => { const code = normalize(row.code); if (code) codes.set(code, index); });
  rows.forEach((row, index) => {
    const skipped = !!options.skipCodes?.has(normalize(row.code));
    const name = normalize(row.label);
    if (!name) { if (!skipped) issues.set(index, 'nameRequired'); return; }
    if (!skipped && options.forbidComma && /[,;]/.test(name)) { issues.set(index, 'noComma'); return; }
    const owner = names.get(name);
    if (owner !== undefined) { issues.set(index, 'nameExists'); issues.set(owner, 'nameExists'); return; }
    names.set(name, index);
    const codeOwner = codes.get(name);
    if (!skipped && codeOwner !== undefined && codeOwner !== index) issues.set(index, 'nameMatchesCode');
  });
  return issues;
}

/**
 * The issues above, and two values the person sees with the same name in their language (a name
 * typed as another value's translation): `shown` gives the name a row displays.
 */
export function catalogEditorIssues<T extends CatalogRow>(rows: T[], shown: (row: T) => string, options: { forbidComma?: boolean; skipCodes?: Set<string> } = {}): Map<number, CatalogIssue> {
  const issues = catalogListIssues(rows, options);
  const owners = new Map<string, number>();
  rows.forEach((row, index) => {
    const name = normalize(shown(row));
    if (!name) return;
    const owner = owners.get(name);
    if (owner === undefined) { owners.set(name, index); return; }
    for (const at of [owner, index]) if (!issues.has(at)) issues.set(at, 'nameExists');
  });
  return issues;
}

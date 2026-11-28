/**
 * Copies onto `target` the fields of `data` that `fields` names, when given. Any other key of a
 * request body (`id`, `tenant_id`, `is_system`, `code`) is left out: a settings value changes
 * only through the fields its screen edits.
 */
export function assignFields<T extends object>(target: T, data: object, fields: ReadonlyArray<keyof T & string>): void {
  for (const field of fields) {
    const value = (data as Record<string, unknown>)[field];
    if (value !== undefined) (target as Record<string, unknown>)[field] = value;
  }
}

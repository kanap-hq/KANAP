/** A process row from `GET /business-processes/lookup`. */
export type BusinessProcessLookupOption = {
  id: string;
  name: string;
  status?: string | null;
  /** Names from the top of the tree, joined by ` › `. The name alone at the top. */
  path?: string | null;
};

/** The option list: the path ("Parent › Child"), the name when the lookup has no path. */
export function businessProcessOptionLabel(option: { name?: string | null; path?: string | null }): string {
  return option.path ?? option.name ?? '';
}

/**
 * Tooltip of a chip or a chosen name. The path, when it says more than the name
 * (a sub-process). A process at the top of the tree has nothing further to say.
 */
export function businessProcessPathTitle(
  option: { name?: string | null; path?: string | null } | null | undefined,
): string | undefined {
  if (!option?.path || option.path === option.name) return undefined;
  return option.path;
}

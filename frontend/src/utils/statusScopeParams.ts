/** The list address parameter of the Show scope (`?statusScope=all`); absent: the list's default scope. */
export const STATUS_SCOPE_PARAM = 'statusScope';

/**
 * Map a grid status scope onto list request params.
 *
 * The grid and the prev/next navigation must scope their requests identically: the
 * navigation asks the same `/summary/ids` endpoint for the ordered id list, and when the
 * two disagree the item page walks a different set from the one on screen. Both call this.
 *
 * `enabled` / `disabled` / `invited` map onto a `status` value; `all` cannot, because the
 * list endpoints only accept the enabled and disabled status values, so it is expressed as
 * `includeDisabled`. Anything unknown contributes nothing, leaving the endpoint default.
 */
export function statusScopeParams(scope: string | null | undefined): Record<string, string> {
  if (scope === 'enabled' || scope === 'disabled' || scope === 'invited') {
    return { status: scope };
  }
  if (scope === 'all') {
    return { includeDisabled: '1' };
  }
  return {};
}

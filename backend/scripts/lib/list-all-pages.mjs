// Reads every page of a list the sample data loader walks (budget lines of
// both natures, working-day calendars).
//
// The API pages with `page` and `limit` (`parsePagination` in
// backend/src/common/pagination.ts). `offset` is ignored, so a loop that
// advances an offset reads the first page on every call. Once that page
// holds a full `limit` rows, the loop never ends and memory fills up.
//
// This walk sends `page=1, 2, …` with a fixed `limit`. It stops when a page
// comes back short, or once `total` is reached when the answer carries one.
// A hard page cap ends a server that ignores paging, so the walk cannot run
// without bound.

/** Rows asked on each page. The list cap is 1000; 200 is the loader's page. */
export const LIST_PAGE_SIZE = 200;

/**
 * Full pages read at most. Fifty pages is 10 000 rows, past the sample set
 * (a few hundred budget lines). Past this the pages already read are returned:
 * a server that repeats a full page stops here.
 */
export const LIST_PAGE_CAP = 50;

// Same list keys as `items()` in fixtures/fromage-co/setup-tenant.mjs.
const LIST_KEYS = ['items', 'agent_definitions', 'profiles', 'actions'];

/** Rows of one list answer: a bare array, or the first known list key. */
function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of LIST_KEYS) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

/** `total` when the answer carries a finite number, otherwise null. */
function totalOf(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const total = payload.total;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

function pagedRoute(route, page) {
  const sep = String(route).includes('?') ? '&' : '?';
  return `${route}${sep}limit=${LIST_PAGE_SIZE}&page=${page}`;
}

/**
 * `apiGet(route)` resolves to one list answer. Returns `(route) => rows`,
 * the pages of that route in order.
 */
export function listAllPages(apiGet) {
  return async function listRoute(route) {
    const all = [];
    for (let page = 1; page <= LIST_PAGE_CAP; page += 1) {
      const payload = await apiGet(pagedRoute(route, page));
      const rows = rowsOf(payload);
      all.push(...rows);
      if (rows.length < LIST_PAGE_SIZE) return all;
      const total = totalOf(payload);
      if (total != null && all.length >= total) return all;
    }
    return all;
  };
}

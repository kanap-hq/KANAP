import { isUuid } from './ai-entity-reference.util';

/**
 * The record pages of the families that have no business reference to cite (`APP-8`, `PRJ-12` and
 * the like open their page from the chat text): the path of the page and the right its route asks
 * for (`frontend/src/components/ProtectedRoute.tsx`). Keep in line with `frontend/src/App.tsx`.
 */
export const AI_PAGE_ROUTES: Readonly<Record<string, { path: (id: string) => string; resource: string }>> = {
  contracts: { path: (id) => `/ops/contracts/${id}`, resource: 'contracts' },
  companies: { path: (id) => `/master-data/companies/${id}`, resource: 'companies' },
  suppliers: { path: (id) => `/master-data/suppliers/${id}`, resource: 'suppliers' },
  contacts: { path: (id) => `/master-data/contacts/${id}`, resource: 'contacts' },
  departments: { path: (id) => `/master-data/departments/${id}`, resource: 'departments' },
  business_processes: { path: (id) => `/master-data/business-processes/${id}`, resource: 'business_processes' },
  accounts: { path: (id) => `/master-data/accounts/${id}`, resource: 'accounts' },
  analytics_categories: { path: (id) => `/master-data/analytics/${id}`, resource: 'analytics' },
  locations: { path: (id) => `/it/locations/${id}`, resource: 'locations' },
  connections: { path: (id) => `/it/connections/${id}`, resource: 'infrastructure' },
  // The Roles screen has no page per role: a role opens the screen.
  roles: { path: () => '/admin/roles', resource: 'users' },
  // A row of Admin › Data access names a person: it opens the screen.
  data_access: { path: () => '/admin/data-access', resource: 'users' },
};

/** The sentence the read tools give about `page_url` (chat and MCP share the descriptions). */
export const AI_PAGE_URL_NOTE = 'A record without a business reference (contract, company, supplier, contact, department, business process, account, analytics value, site, connection, role, data access row) carries `page_url`, the address of its page in KANAP, when the user can open that page: an absolute address over MCP when the workspace address is configured on the server, otherwise a path from the workspace address.';

export type AiPageUrlOptions = {
  /** The rights, among `resources`, the user holds at reader level. */
  readableResources: (resources: string[]) => Promise<ReadonlySet<string>>;
  /** The workspace origin for absolute addresses (MCP), or null for paths; asked only when a link is set. */
  origin: () => Promise<string | null>;
};

type LinkableItem = { type?: unknown; id?: unknown; page_url?: unknown; metadata?: unknown };

function asItem(value: unknown): LinkableItem | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LinkableItem : null;
}

/** The records of a read tool's result: list items, the record of a detail or context, its linked records. */
function resultItems(result: unknown): LinkableItem[] {
  const root = asItem(result) as Record<string, unknown> | null;
  if (!root) return [];
  const items: LinkableItem[] = [];
  const push = (value: unknown) => {
    const item = asItem(value);
    if (item) items.push(item);
  };
  if (Array.isArray(root.items)) root.items.forEach(push);
  push(root.entity);
  if (Array.isArray(root.related)) {
    for (const group of root.related) {
      const groupItems = (asItem(group) as Record<string, unknown> | null)?.items;
      if (Array.isArray(groupItems)) groupItems.forEach(push);
    }
  }
  return items;
}

function absolute(origin: string | null, path: string): string {
  return origin && path.startsWith('/') ? `${origin}${path}` : path;
}

/**
 * Sets `page_url` on the records of a read tool's result (`query_entities`, `get_entity_detail`,
 * `get_entity_context`, `search_all`) whose family is in `AI_PAGE_ROUTES`, when the user holds the
 * right of that page; never otherwise. With an `origin` (MCP), the addresses are absolute, the
 * `page_url` of the vulnerabilities included. Changes the result in place and returns it.
 */
export async function withAiPageUrls<T>(result: T, options: AiPageUrlOptions): Promise<T> {
  const items = resultItems(result);
  const linkable = items.filter((item) =>
    typeof item.type === 'string'
    && Object.prototype.hasOwnProperty.call(AI_PAGE_ROUTES, item.type)
    && typeof item.id === 'string'
    && isUuid(item.id));
  const links: Array<{ holder: LinkableItem; path: string }> = [];
  if (linkable.length > 0) {
    const resources = [...new Set(linkable.map((item) => AI_PAGE_ROUTES[item.type as string].resource))];
    const readable = await options.readableResources(resources);
    for (const item of linkable) {
      const route = AI_PAGE_ROUTES[item.type as string];
      if (readable.has(route.resource)) links.push({ holder: item, path: route.path(item.id as string) });
    }
  }
  // The links the vulnerabilities already carry (`ai-vulnerabilities.query.ts`), in the item's
  // metadata and in a detail's data: made absolute with the others.
  const withMetadata = items.map((item) => asItem(item.metadata)).filter((value): value is LinkableItem => value !== null);
  const data = asItem((asItem(result) as Record<string, unknown> | null)?.data);
  const carried = (data ? [...withMetadata, data] : withMetadata).filter((holder) => typeof holder.page_url === 'string');
  if (links.length === 0 && carried.length === 0) return result;
  const origin = await options.origin();
  for (const { holder, path } of links) holder.page_url = absolute(origin, path);
  for (const holder of carried) holder.page_url = absolute(origin, holder.page_url as string);
  return result;
}


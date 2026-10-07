import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { decodeNumericHtmlEntities } from '../../common/html-entities';
import { resolveHtmlContentSource } from '../../common/html-to-markdown';
import { openValidatedFetch } from '../../common/pinned-fetch';
import { Features } from '../../config/features';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiSettingsService } from '../ai-settings.service';
import { normalizeGlpiPathname } from './glpi-url';
import {
  GlpiConnectionOverrides,
  GlpiDocument,
  GlpiReferenceItem,
  GlpiSession,
  GlpiTestResult,
  GlpiTicket,
  GlpiTicketFollowup,
  GlpiTicketFollowupWriteResult,
  GlpiTicketListScope,
  GlpiTicketUpdateFields,
  GlpiTicketUpdateResult,
  GlpiTicketUserAssociation,
  GlpiTicketGroupAssociation,
  GlpiAssignableGroup,
  GlpiCategory,
  GlpiTechnician,
} from './glpi.types';

const GLPI_TIMEOUT_MS = 10_000;
const GLPI_MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const GLPI_PAGE_SIZE = 50;
// Tree catalogs (categories/entities) are fetched via the plain item-list endpoint
// (no search engine), so larger pages are cheap; the row cap bounds pathological trees.
const GLPI_TREE_PAGE_SIZE = 200;
const GLPI_TREE_CACHE_TTL_MS = 10 * 60 * 1000;
const GLPI_TREE_MAX_ROWS = 20_000;
// Assignable-group catalogue handed to the desk agent as routing targets: bounded so the
// planner prompt stays small, refreshed lazily.
const GLPI_ASSIGNABLE_GROUPS_MAX = 200;
const GLPI_ASSIGNABLE_GROUPS_CACHE_TTL_MS = 5 * 60 * 1000;
// Technician catalogue handed to the desk agent as named routing targets: the active
// members of the assignable groups, bounded the same way as the group catalogue.
const GLPI_TECHNICIANS_MAX = 200;
const GLPI_MAX_INTERNAL_NOTE_CHARS = 4000;
const GLPI_MAX_PUBLIC_REPLY_CHARS = 12000;

type GlpiReferenceCatalogKind = 'category' | 'entity' | 'group' | 'technician';

type ResolvedGlpiSettings = {
  baseUrl: string;
  userToken: string;
  appToken: string | null;
};

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function decodeGlpiPlainTextField(value: string | null): string | null {
  return value == null ? null : decodeNumericHtmlEntities(value);
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const normalized = textOrNull(value);
  if (!normalized) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException('GLPI URL must be a valid HTTP(S) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('GLPI URL must use http:// or https://.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('GLPI URL must not include embedded credentials.');
  }

  parsed.search = '';
  parsed.hash = '';
  const normalizedPath = normalizeGlpiPathname(parsed.pathname);
  parsed.pathname = normalizedPath === '/' ? '/' : `${normalizedPath}/`;
  return parsed.toString();
}

function stringifyGlpiValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return textOrNull(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stringifyGlpiValue(item))
      .filter((item): item is string => !!item);
    return items.length > 0 ? items.join(', ') : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return textOrNull(record.completename)
      ?? textOrNull(record.name)
      ?? textOrNull(record.label)
      ?? textOrNull(record.value)
      ?? null;
  }
  return null;
}

function parseNumericGlpiValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>;
    return parseNumericGlpiValue(record.id ?? record.value ?? null);
  }
  return null;
}

function parseBooleanGlpiValue(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>;
    return parseBooleanGlpiValue(record.id ?? record.value ?? record.name ?? null);
  }
  return false;
}

function referenceSearchItemType(kind: GlpiReferenceCatalogKind): 'ITILCategory' | 'Entity' | 'Group' {
  switch (kind) {
    case 'category':
      return 'ITILCategory';
    case 'group':
      return 'Group';
    default:
      return 'Entity';
  }
}

function normalizePlainTicketFollowup(value: string, opts?: { maxChars?: number; label?: string }): string {
  const maxChars = opts?.maxChars ?? GLPI_MAX_INTERNAL_NOTE_CHARS;
  const label = opts?.label ?? 'GLPI followup';
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new BadRequestException(`${label} content is required.`);
  }
  if (normalized.length > maxChars) {
    throw new BadRequestException(`${label} content exceeds the allowed length.`);
  }
  if (/<[^>]+>/.test(normalized) || /javascript:/i.test(normalized)) {
    throw new BadRequestException(`${label} content must be plain text and cannot contain HTML or scripts.`);
  }
  return normalized;
}

function decodeFilenameComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeHtmlAttribute(value: string): string {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, '\'')
    .replace(/&#38;/gi, '&')
    .replace(/&#34;/gi, '"')
    .replace(/&#60;/gi, '<')
    .replace(/&#62;/gi, '>')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function extractImageTargets(html: string | null): string[] {
  if (!html) {
    return [];
  }

  const seen = new Set<string>();
  const results: string[] = [];
  const regex = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const rawTarget = decodeHtmlAttribute(String(match[2] || '').trim());
    if (!rawTarget || seen.has(rawTarget)) {
      continue;
    }
    seen.add(rawTarget);
    results.push(rawTarget);
  }
  return results;
}

function parseContentRangeTotal(value: string | null): number | null {
  const match = String(value || '').match(/\/(\d+)\s*$/);
  if (!match?.[1]) {
    return null;
  }
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) ? total : null;
}

function normalizeGlpiDate(value: unknown): string | null {
  return textOrNull(value);
}

function parseGlpiDateMs(value: unknown): number | null {
  const text = textOrNull(value);
  if (!text) {
    return null;
  }
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const normalized = Date.parse(text.replace(' ', 'T'));
  return Number.isFinite(normalized) ? normalized : null;
}

function formatGlpiSearchDate(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('GLPI ticket list horizon must be a valid timestamp.');
  }
  return new Date(parsed).toISOString().slice(0, 19).replace('T', ' ');
}

function parsePositiveInteger(value: unknown): number | null {
  const parsed = parseNumericGlpiValue(value);
  return parsed && parsed > 0 ? parsed : null;
}

function glpiTicketUserRole(value: unknown): GlpiTicketUserAssociation['role'] {
  const numeric = parseNumericGlpiValue(value);
  if (numeric === 1) {
    return 'requester';
  }
  if (numeric === 2) {
    return 'assigned';
  }
  if (numeric === 3) {
    return 'observer';
  }
  const label = stringifyGlpiValue(value)?.toLowerCase() ?? '';
  if (label.includes('requester') || label.includes('demandeur')) {
    return 'requester';
  }
  if (label.includes('assign') || label.includes('technician') || label.includes('attrib')) {
    return 'assigned';
  }
  if (label.includes('observer') || label.includes('watcher') || label.includes('observateur')) {
    return 'observer';
  }
  return 'unknown';
}

function compareGlpiDatesDesc(a: GlpiTicketFollowup, b: GlpiTicketFollowup): number {
  const aTime = a.date ? Date.parse(a.date.replace(' ', 'T')) : Number.NaN;
  const bTime = b.date ? Date.parse(b.date.replace(' ', 'T')) : Number.NaN;
  const aValue = Number.isFinite(aTime) ? aTime : 0;
  const bValue = Number.isFinite(bTime) ? bTime : 0;
  if (bValue !== aValue) {
    return bValue - aValue;
  }
  return b.id - a.id;
}

function isLikelyJsonPayload(contentType: string | null, raw: string): boolean {
  const normalized = String(contentType || '').toLowerCase();
  const text = String(raw || '').trim();
  return normalized.includes('application/json') || text.startsWith('{') || text.startsWith('[');
}

@Injectable()
export class GlpiService {
  private readonly logger = new Logger(GlpiService.name);
  // Parent maps of tree catalogs, keyed by GLPI instance + acting account (visibility
  // is account-scoped) + itemtype. Refreshed lazily every GLPI_TREE_CACHE_TTL_MS.
  private readonly treeParentCache = new Map<string, { expiresAt: number; parents: Map<number, number | null> }>();
  private readonly assignableGroupsCache = new Map<string, { expiresAt: number; groups: GlpiAssignableGroup[] }>();
  private readonly categoriesCache = new Map<string, { expiresAt: number; categories: GlpiCategory[] }>();
  private readonly techniciansCache = new Map<string, { expiresAt: number; technicians: GlpiTechnician[]; truncated: boolean }>();

  constructor(
    private readonly settingsService: AiSettingsService,
    private readonly cipher: AiSecretCipherService,
  ) {}

  async initSession(
    tenantId: string,
    manager: EntityManager,
    overrides?: GlpiConnectionOverrides,
  ): Promise<GlpiSession> {
    const settings = await this.resolveSettings(tenantId, manager, overrides);
    const payload = await this.requestJson(
      this.buildUrl(settings.baseUrl, 'apirest.php/initSession'),
      {
        headers: this.buildInitHeaders(settings.userToken, settings.appToken),
      },
    );
    const sessionToken = textOrNull((payload as Record<string, unknown>)?.session_token);
    if (!sessionToken) {
      throw new BadRequestException('GLPI did not return a session token.');
    }

    const baseSession: GlpiSession = {
      baseUrl: settings.baseUrl,
      sessionToken,
      appToken: settings.appToken,
      agentUserId: null,
    };
    return { ...baseSession, agentUserId: await this.resolveSessionUserId(baseSession) };
  }

  // The GLPI users_id behind the user token, used so the agent can add ITSELF (and only
  // itself) as a ticket actor. Best-effort: a failure leaves agentUserId null and the
  // actor-add is simply skipped — it must never break a session or a note/reply write.
  private async resolveSessionUserId(session: GlpiSession): Promise<number | null> {
    try {
      const payload = await this.requestJson(
        this.buildUrl(session.baseUrl, 'apirest.php/getFullSession'),
        { headers: this.buildSessionHeaders(session) },
      );
      const sessionObject = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).session
        : null;
      const glpiId = sessionObject && typeof sessionObject === 'object'
        ? parseNumericGlpiValue((sessionObject as Record<string, unknown>).glpiID)
        : null;
      return glpiId && glpiId > 0 ? glpiId : null;
    } catch {
      return null;
    }
  }

  // Adds the agent's own GLPI user as a ticket actor — assignee (type 2) for a public
  // reply, observer (type 3) for an internal note. Own-user-only and additive (never
  // replaces a human actor); idempotent via a pre-check against existing actors.
  async addTicketUser(
    session: GlpiSession,
    ticketId: number,
    usersId: number,
    type: 2 | 3,
  ): Promise<{ added: boolean; alreadyPresent: boolean }> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    if (!Number.isInteger(usersId) || usersId <= 0) {
      throw new BadRequestException('GLPI ticket actor user id must be a positive integer.');
    }
    if (usersId !== session.agentUserId) {
      throw new BadRequestException('GLPI ticket actor writes are restricted to the agent\'s own user.');
    }
    if (type !== 2 && type !== 3) {
      throw new BadRequestException('GLPI ticket actor type must be assignee (2) or observer (3).');
    }
    const role = type === 2 ? 'assigned' : 'observer';
    const existing = await this.getTicketUsers(session, ticketId);
    if (existing.some((association) => association.user_id === usersId && association.role === role)) {
      return { added: false, alreadyPresent: true };
    }
    await this.requestJson(
      this.buildUrl(session.baseUrl, 'apirest.php/Ticket_User'),
      {
        method: 'POST',
        headers: this.buildSessionHeaders(session),
        body: JSON.stringify({ input: { tickets_id: ticketId, users_id: usersId, type } }),
      },
    );
    return { added: true, alreadyPresent: false };
  }

  // Adds a technician group as ASSIGNED on a ticket (Group_Ticket type 2). Additive:
  // existing technicians and groups are never removed. Restricted to groups that GLPI
  // flags as assignable, idempotent on the (ticket, group, assigned) triple.
  async addTicketGroup(
    session: GlpiSession,
    ticketId: number,
    groupsId: number,
  ): Promise<{ added: boolean; alreadyPresent: boolean; group: GlpiAssignableGroup }> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    if (!Number.isInteger(groupsId) || groupsId <= 0) {
      throw new BadRequestException('GLPI ticket group id must be a positive integer.');
    }
    const group = (await this.listAssignableGroups(session)).find((candidate) => candidate.id === groupsId);
    if (!group) {
      throw new BadRequestException('GLPI ticket group writes are restricted to assignable groups.');
    }
    const existing = await this.getTicketGroups(session, ticketId);
    if (existing.some((association) => association.group_id === groupsId && association.role === 'assigned')) {
      return { added: false, alreadyPresent: true, group };
    }
    await this.requestJson(
      this.buildUrl(session.baseUrl, 'apirest.php/Group_Ticket'),
      {
        method: 'POST',
        headers: this.buildSessionHeaders(session),
        body: JSON.stringify({ input: { tickets_id: ticketId, groups_id: groupsId, type: 2 } }),
      },
    );
    return { added: true, alreadyPresent: false, group };
  }

  // Groups a ticket can be assigned to (Group.is_assign = 1), sorted by full name and
  // bounded to GLPI_ASSIGNABLE_GROUPS_MAX. Cached per GLPI instance + acting account.
  async listAssignableGroups(session: GlpiSession): Promise<GlpiAssignableGroup[]> {
    return (await this.listAssignableGroupCatalogue(session)).slice(0, GLPI_ASSIGNABLE_GROUPS_MAX);
  }

  // Keep all assignable groups in the cache: the group prompt cap must not exclude
  // technicians whose only membership is in a group beyond that cap.
  private async listAssignableGroupCatalogue(session: GlpiSession): Promise<GlpiAssignableGroup[]> {
    const cacheKey = `${session.baseUrl}|${session.agentUserId ?? 'anon'}`;
    const now = Date.now();
    const cached = this.assignableGroupsCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.groups;
    }
    const rows = await this.listItemTypeRows(session, 'Group', GLPI_TREE_MAX_ROWS);
    const groups: GlpiAssignableGroup[] = [];
    for (const record of rows) {
      const id = parsePositiveInteger(record.id);
      if (!id || !parseBooleanGlpiValue(record.is_assign)) {
        continue;
      }
      const name = decodeGlpiPlainTextField(stringifyGlpiValue(record.name));
      const completename = decodeGlpiPlainTextField(stringifyGlpiValue(record.completename)) ?? name;
      groups.push({ id, name, completename });
    }
    groups.sort((left, right) => (left.completename ?? '').localeCompare(right.completename ?? '', undefined, { sensitivity: 'base' }));
    if (groups.length > GLPI_ASSIGNABLE_GROUPS_MAX) {
      this.logger.warn(`GLPI exposes ${groups.length} assignable groups; the agent routing catalogue keeps the first ${GLPI_ASSIGNABLE_GROUPS_MAX}.`);
    }
    this.assignableGroupsCache.set(cacheKey, { expiresAt: now + GLPI_ASSIGNABLE_GROUPS_CACHE_TTL_MS, groups });
    return groups;
  }

  // Keep the complete tree here: prompt limits apply after narrowing to the agent scope.
  async listCategories(session: GlpiSession): Promise<GlpiCategory[]> {
    const cacheKey = `${session.baseUrl}|${session.agentUserId ?? 'anon'}`;
    const cached = this.categoriesCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.categories;
    const rows = await this.listItemTypeRows(session, 'ITILCategory', GLPI_TREE_MAX_ROWS);
    const categories = rows.flatMap((record): GlpiCategory[] => {
      const id = parsePositiveInteger(record.id);
      if (!id) return [];
      const name = decodeGlpiPlainTextField(stringifyGlpiValue(record.name));
      return [{
        id, name,
        completename: decodeGlpiPlainTextField(stringifyGlpiValue(record.completename)) ?? name,
        parentId: parsePositiveInteger(record.itilcategories_id) ?? null,
      }];
    });
    categories.sort((left, right) => (left.completename ?? '').localeCompare(right.completename ?? '', undefined, { sensitivity: 'base' }) || left.id - right.id);
    this.categoriesCache.set(cacheKey, { expiresAt: Date.now() + GLPI_ASSIGNABLE_GROUPS_CACHE_TTL_MS, categories });
    return categories;
  }

  // Adds a named technician as ASSIGNED on a ticket (Ticket_User type 2). Additive:
  // existing technicians and groups are never removed. Restricted to the technician
  // catalogue (active members of an assignable group), idempotent on the
  // (ticket, user, assigned) triple. Distinct from addTicketUser, which stays restricted
  // to the agent's own account for the ticket-actor feature.
  async addTicketTechnician(
    session: GlpiSession,
    ticketId: number,
    usersId: number,
  ): Promise<{ added: boolean; alreadyPresent: boolean; technician: GlpiTechnician }> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    if (!Number.isInteger(usersId) || usersId <= 0) {
      throw new BadRequestException('GLPI ticket technician id must be a positive integer.');
    }
    const catalogue = await this.listTechnicians(session);
    const technician = catalogue.technicians.find((candidate) => candidate.id === usersId);
    if (!technician) {
      throw new BadRequestException('GLPI ticket technician writes are restricted to technicians of an assignable group.');
    }
    const existing = await this.getTicketUsers(session, ticketId);
    if (existing.some((association) => association.user_id === usersId && association.role === 'assigned')) {
      return { added: false, alreadyPresent: true, technician };
    }
    await this.requestJson(
      this.buildUrl(session.baseUrl, 'apirest.php/Ticket_User'),
      {
        method: 'POST',
        headers: this.buildSessionHeaders(session),
        body: JSON.stringify({ input: { tickets_id: ticketId, users_id: usersId, type: 2 } }),
      },
    );
    return { added: true, alreadyPresent: false, technician };
  }

  // Users a ticket can be assigned to by name: the active, non-deleted members of the
  // assignable groups, excluding the agent's own account. Bounding the catalogue to real
  // technicians this way avoids depending on GLPI profile rights, and keeps the planner
  // prompt small. Cached per GLPI instance + acting account, like the group catalogue.
  async listTechnicians(session: GlpiSession): Promise<{ technicians: GlpiTechnician[]; truncated: boolean }> {
    const cacheKey = `${session.baseUrl}|${session.agentUserId ?? 'anon'}`;
    const now = Date.now();
    const cached = this.techniciansCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { technicians: cached.technicians, truncated: cached.truncated };
    }
    const groupIds = new Set((await this.listAssignableGroupCatalogue(session)).map((group) => group.id));
    if (groupIds.size === 0) {
      this.techniciansCache.set(cacheKey, { expiresAt: now + GLPI_ASSIGNABLE_GROUPS_CACHE_TTL_MS, technicians: [], truncated: false });
      return { technicians: [], truncated: false };
    }
    const memberIds = await this.listGroupMemberUserIds(session, groupIds);
    const technicians: GlpiTechnician[] = [];
    if (memberIds.size > 0) {
      for (const record of await this.listItemTypeRows(session, 'User', GLPI_TREE_MAX_ROWS)) {
        const id = parsePositiveInteger(record.id);
        if (!id || !memberIds.has(id)) {
          continue;
        }
        // The agent's own account is never a routing target: it registers itself as a
        // ticket actor through the ticket_actor_role feature, which is a different thing.
        if (session.agentUserId != null && id === session.agentUserId) {
          continue;
        }
        // Absent flags mean "active" / "not deleted": only an explicit value excludes.
        if (record.is_active != null && !parseBooleanGlpiValue(record.is_active)) {
          continue;
        }
        if (record.is_deleted != null && parseBooleanGlpiValue(record.is_deleted)) {
          continue;
        }
        const name = decodeGlpiPlainTextField(stringifyGlpiValue(record.name));
        const realname = decodeGlpiPlainTextField(stringifyGlpiValue(record.realname));
        const firstname = decodeGlpiPlainTextField(stringifyGlpiValue(record.firstname));
        const label = [realname, firstname].filter((part) => !!part && part.trim()).join(' ').trim() || (name ?? '').trim();
        if (!label) {
          continue;
        }
        technicians.push({ id, name, label });
      }
    }
    technicians.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }) || left.id - right.id);
    let truncated = false;
    if (technicians.length > GLPI_TECHNICIANS_MAX) {
      this.logger.warn(`GLPI exposes ${technicians.length} technicians in assignable groups; the agent routing catalogue keeps the first ${GLPI_TECHNICIANS_MAX}.`);
      technicians.length = GLPI_TECHNICIANS_MAX;
      truncated = true;
    }
    this.techniciansCache.set(cacheKey, { expiresAt: now + GLPI_ASSIGNABLE_GROUPS_CACHE_TTL_MS, technicians, truncated });
    return { technicians, truncated };
  }

  // Members of the given groups. The bare Group_User collection is the cheap path but a
  // restricted GLPI API profile often refuses it; the per-group sub-item endpoint (same
  // shape as Ticket/<id>/Group_Ticket) is the fallback. A failure of the fallback
  // propagates: the provider degrades to groups-only routing with an explicit warning.
  private async listGroupMemberUserIds(
    session: GlpiSession,
    groupIds: Set<number>,
  ): Promise<Set<number>> {
    const memberIds = new Set<number>();
    try {
      for (const record of await this.listItemTypeRows(session, 'Group_User', GLPI_TREE_MAX_ROWS)) {
        const groupId = parsePositiveInteger(record.groups_id);
        const userId = parsePositiveInteger(record.users_id);
        if (groupId && userId && groupIds.has(groupId)) {
          memberIds.add(userId);
        }
      }
      return memberIds;
    } catch (error: any) {
      this.logger.warn(`GLPI refused the Group_User listing (${String(error?.message ?? error)}); falling back to per-group membership reads.`);
    }
    for (const groupId of groupIds) {
      for (const row of await this.listItemTypeRows(session, `Group/${groupId}/Group_User`, GLPI_TREE_MAX_ROWS)) {
        const userId = parsePositiveInteger(row.users_id);
        if (userId) {
          memberIds.add(userId);
        }
      }
    }
    return memberIds;
  }

  async getTicketGroups(
    session: GlpiSession,
    ticketId: number,
  ): Promise<GlpiTicketGroupAssociation[]> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    // Raw ids only: labels come from the assignable-group catalogue, which is stable
    // regardless of how the GLPI version renders expanded dropdowns.
    const pageUrl = new URL(this.buildUrl(session.baseUrl, `apirest.php/Ticket/${ticketId}/Group_Ticket`));
    pageUrl.searchParams.set('expand_dropdowns', 'false');
    pageUrl.searchParams.set('get_hateoas', 'false');

    const payload = await this.requestJson(
      pageUrl.toString(),
      { headers: this.buildSessionHeaders(session) },
      { notFoundMessage: `GLPI ticket #${ticketId} groups were not found.` },
    );
    if (!Array.isArray(payload)) {
      throw new BadRequestException('GLPI ticket groups response was malformed.');
    }
    const seen = new Set<string>();
    return payload
      .map((item) => this.normalizeTicketGroupAssociation(item))
      .filter((item): item is GlpiTicketGroupAssociation => !!item)
      .filter((association) => {
        const key = `${association.group_id}:${association.role}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
  }

  async getTicket(
    session: GlpiSession,
    ticketId: number,
  ): Promise<GlpiTicket> {
    const payload = await this.requestJson(
      this.buildUrl(session.baseUrl, `apirest.php/Ticket/${ticketId}`),
      {
        headers: this.buildSessionHeaders(session),
      },
      { notFoundMessage: `GLPI ticket #${ticketId} was not found.` },
    );

    const record = this.expectRecord(payload, 'GLPI ticket');
    const resolvedTicketId = parseNumericGlpiValue(record.id) ?? ticketId;
    const contentHtml = textOrNull(resolveHtmlContentSource(String(record.content ?? '')));
    const name = textOrNull(record.name);
    return {
      id: resolvedTicketId,
      name: decodeGlpiPlainTextField(name),
      content_html: contentHtml,
      status: stringifyGlpiValue(record.status),
      priority: parseNumericGlpiValue(record.priority),
      urgency: stringifyGlpiValue(record.urgency),
      type: parseNumericGlpiValue(record.type),
      entity_id: parsePositiveInteger(record.entities_id),
      category_id: parsePositiveInteger(record.itilcategories_id),
      date: normalizeGlpiDate(record.date ?? record.date_creation ?? null),
      updated_date: normalizeGlpiDate(record.date_mod ?? record.date ?? record.date_creation ?? null),
      glpi_url: this.buildUrl(session.baseUrl, `front/ticket.form.php?id=${resolvedTicketId}`),
      image_targets: extractImageTargets(contentHtml),
    };
  }

  async searchTicketsForScope(
    session: GlpiSession,
    scope: GlpiTicketListScope,
  ): Promise<GlpiTicket[]> {
    const maxResults = Math.max(1, Math.min(Math.floor(scope.maxResults), 20));
    const isAllOpen = scope.mode === 'all_open';
    // new_tickets_only: created-after horizon is the scope bound and must be valid.
    const horizonMs = isAllOpen ? null : Date.parse(scope.createdAfter);
    if (!isAllOpen && (horizonMs == null || !Number.isFinite(horizonMs))) {
      throw new BadRequestException('GLPI ticket list requires a valid created-after horizon.');
    }
    // all_open: optional last-changed (date_mod, field 19) window bounds.
    const lastChangedBeforeMs = isAllOpen && scope.lastChangedBefore ? Date.parse(scope.lastChangedBefore) : null;
    const lastChangedAfterMs = isAllOpen && scope.lastChangedAfter ? Date.parse(scope.lastChangedAfter) : null;
    const searchUrl = new URL(this.buildUrl(session.baseUrl, 'apirest.php/search/Ticket'));
    searchUrl.searchParams.set('range', `0-${maxResults - 1}`);
    searchUrl.searchParams.set('get_hateoas', 'false');
    let criteriaIndex = 0;
    if (isAllOpen) {
      // Oldest-changed first so a cleanup agent sees the stalest tickets; field 19 = date_mod.
      searchUrl.searchParams.set('sort', '19');
      searchUrl.searchParams.set('order', 'ASC');
      // Open tickets only — GLPI's status field (12) uses the "notold" meta value
      // (not solved nor closed = New/Assigned/Planned/Pending); numeric comparisons
      // don't work on this dropdown. Status is revalidated per ticket after fetch.
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '12');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, 'equals');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, 'notold');
      criteriaIndex += 1;
      if (lastChangedBeforeMs != null && Number.isFinite(lastChangedBeforeMs)) {
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][link]`, 'AND');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '19');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, 'lessthan');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, formatGlpiSearchDate(scope.lastChangedBefore as string));
        criteriaIndex += 1;
      }
      if (lastChangedAfterMs != null && Number.isFinite(lastChangedAfterMs)) {
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][link]`, 'AND');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '19');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, 'morethan');
        searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, formatGlpiSearchDate(scope.lastChangedAfter as string));
        criteriaIndex += 1;
      }
    } else {
      const horizon = formatGlpiSearchDate(scope.createdAfter);
      searchUrl.searchParams.set('sort', '15');
      searchUrl.searchParams.set('order', 'DESC');
      // New-ticket polling is still bounded to currently open tickets. Exact
      // status subsets are rechecked after fetch until GLPI criteria pushdown is
      // widened beyond the portable open-status bound.
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '12');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, 'equals');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, 'notold');
      criteriaIndex += 1;
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][link]`, 'AND');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '15');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, 'morethan');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, horizon);
      criteriaIndex += 1;
    }
    // Recursive selection: when the expanded id set is provided, push down GLPI's
    // 'under' searchtype (root + descendants) and revalidate by set membership after
    // fetch; without a set, keep the historical exact-id behavior.
    const entityIdSet = scope.entityIds && scope.entityIds.length > 0 ? new Set(scope.entityIds) : null;
    const categoryIdSet = scope.categoryIds && scope.categoryIds.length > 0 ? new Set(scope.categoryIds) : null;
    if (scope.entityId) {
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][link]`, 'AND');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '80');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, entityIdSet ? 'under' : 'equals');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, String(scope.entityId));
      criteriaIndex += 1;
    }
    if (scope.categoryId) {
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][link]`, 'AND');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][field]`, '7');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][searchtype]`, categoryIdSet ? 'under' : 'equals');
      searchUrl.searchParams.set(`criteria[${criteriaIndex}][value]`, String(scope.categoryId));
      criteriaIndex += 1;
    }
    ['2', '1', '12', '15', '19', '80', '7'].forEach((field, index) => {
      searchUrl.searchParams.set(`forcedisplay[${index}]`, field);
    });

    const payload = await this.requestJson(
      searchUrl.toString(),
      {
        headers: this.buildSessionHeaders(session),
      },
    );
    const record = this.expectRecord(payload, 'GLPI ticket search');
    // GLPI omits the data key entirely when a search matches zero rows;
    // that is an empty result, not a malformed response.
    const totalCount = typeof record.totalcount === 'number' ? record.totalcount : Number(record.totalcount ?? Number.NaN);
    if (record.data == null && (totalCount === 0 || record.count === 0)) {
      return [];
    }
    if (!Array.isArray(record.data)) {
      throw new BadRequestException('GLPI ticket search response was malformed.');
    }

    const ticketIds = record.data.map((row, index) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new BadRequestException(`GLPI ticket search row ${index + 1} was malformed.`);
      }
      const rowRecord = row as Record<string, unknown>;
      const ticketId = parsePositiveInteger(rowRecord.id ?? rowRecord['2']);
      if (!ticketId) {
        throw new BadRequestException(`GLPI ticket search row ${index + 1} did not include a ticket id.`);
      }
      return ticketId;
    });

    const tickets: GlpiTicket[] = [];
    const seen = new Set<number>();
    for (const ticketId of ticketIds) {
      if (seen.has(ticketId)) {
        continue;
      }
      seen.add(ticketId);
      const ticket = await this.getTicket(session, ticketId);
      if (isAllOpen) {
        // Revalidate the full ticket after fetch: still open, and within the
        // last-changed window (the search index can lag the live record).
        const statusCode = Number(String(ticket.status ?? '').trim());
        if (!Number.isFinite(statusCode) || statusCode < 1 || statusCode >= 5) {
          continue;
        }
        const modMs = parseGlpiDateMs(ticket.updated_date ?? ticket.date);
        if (lastChangedBeforeMs != null && (modMs == null || modMs >= lastChangedBeforeMs)) {
          continue;
        }
        if (lastChangedAfterMs != null && (modMs == null || modMs <= lastChangedAfterMs)) {
          continue;
        }
      } else {
        const createdMs = parseGlpiDateMs(ticket.date);
        if (createdMs == null || horizonMs == null || createdMs < horizonMs) {
          continue;
        }
      }
      if (scope.entityId) {
        const entityOk = entityIdSet
          ? ticket.entity_id != null && entityIdSet.has(ticket.entity_id)
          : ticket.entity_id === scope.entityId;
        if (!entityOk) {
          continue;
        }
      }
      if (scope.categoryId) {
        const categoryOk = categoryIdSet
          ? ticket.category_id != null && categoryIdSet.has(ticket.category_id)
          : ticket.category_id === scope.categoryId;
        if (!categoryOk) {
          continue;
        }
      }
      tickets.push(ticket);
      if (tickets.length >= maxResults) {
        break;
      }
    }
    return tickets;
  }

  async searchReferenceCatalog(
    session: GlpiSession,
    input: { kind: GlpiReferenceCatalogKind; query?: string | null; limit: number },
  ): Promise<GlpiReferenceItem[]> {
    return (await this.searchReferenceCatalogPage(session, input)).items;
  }

  // Same search, plus the catalogue size when GLPI already knows it: the cached
  // group/technician catalogues count their own matches, and the GLPI search API
  // returns `totalcount`. Callers that only need the page use
  // `searchReferenceCatalog` above.
  async searchReferenceCatalogPage(
    session: GlpiSession,
    input: { kind: GlpiReferenceCatalogKind; query?: string | null; limit: number },
  ): Promise<{ items: GlpiReferenceItem[]; total?: number }> {
    const limit = Math.max(1, Math.min(Math.floor(input.limit), 50));
    const query = textOrNull(input.query);
    if (input.kind === 'group') {
      // Only groups a ticket can be assigned to; served from the bounded cached catalogue
      // so the picker and the agent see the same list.
      const needle = query?.toLowerCase() ?? null;
      const matches = (await this.listAssignableGroups(session))
        .filter((group) => !needle
          || String(group.id) === needle
          || (group.completename ?? group.name ?? '').toLowerCase().includes(needle));
      return {
        total: matches.length,
        items: matches
          .slice(0, limit)
          .map((group) => ({ id: group.id, name: group.name, completename: group.completename })),
      };
    }
    if (input.kind === 'technician') {
      // Named technicians: served from the same bounded cached catalogue the agent sees,
      // so the picker and the planner never disagree. No GLPI user search is issued.
      const needle = query?.toLowerCase() ?? null;
      const matches = (await this.listTechnicians(session)).technicians
        .filter((technician) => !needle
          || String(technician.id) === needle
          || technician.label.toLowerCase().includes(needle));
      return {
        total: matches.length,
        items: matches
          .slice(0, limit)
          .map((technician) => ({ id: technician.id, name: technician.name, completename: technician.label })),
      };
    }
    const itemType = referenceSearchItemType(input.kind);
    const searchUrl = new URL(this.buildUrl(session.baseUrl, `apirest.php/search/${itemType}`));
    searchUrl.searchParams.set('range', `0-${limit - 1}`);
    searchUrl.searchParams.set('get_hateoas', 'false');
    searchUrl.searchParams.set('sort', '1');
    searchUrl.searchParams.set('order', 'ASC');
    // Common GLPI search fields: 2=id, 1=name. Some versions expose
    // completename as a named field; the normalizer accepts both shapes.
    ['2', '1', 'completename'].forEach((field, index) => {
      searchUrl.searchParams.set(`forcedisplay[${index}]`, field);
    });
    if (query) {
      const numericQuery = /^\d+$/.test(query);
      searchUrl.searchParams.set('criteria[0][field]', numericQuery ? '2' : '1');
      searchUrl.searchParams.set('criteria[0][searchtype]', numericQuery ? 'equals' : 'contains');
      searchUrl.searchParams.set('criteria[0][value]', query);
    }

    const payload = await this.requestJson(
      searchUrl.toString(),
      { headers: this.buildSessionHeaders(session) },
    );
    const record = this.expectRecord(payload, `GLPI ${itemType} search`);
    const totalCount = typeof record.totalcount === 'number' ? record.totalcount : Number(record.totalcount ?? Number.NaN);
    const total = Number.isFinite(totalCount) && totalCount >= 0 ? Math.floor(totalCount) : undefined;
    if (record.data == null && (totalCount === 0 || record.count === 0)) {
      return { items: [], ...(total === undefined ? {} : { total }) };
    }
    if (!Array.isArray(record.data)) {
      throw new BadRequestException(`GLPI ${itemType} search response was malformed.`);
    }
    const seen = new Set<number>();
    const items: GlpiReferenceItem[] = [];
    for (const row of record.data) {
      const item = this.normalizeReferenceCatalogItem(row);
      if (!item || seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      items.push(item);
      if (items.length >= limit) {
        break;
      }
    }
    return { items, ...(total === undefined ? {} : { total }) };
  }

  // Expand tree-catalog root ids to root + all descendants, roots first. Backs
  // recursive category/entity targeting.
  async listReferenceSubtreeIds(
    session: GlpiSession,
    kind: GlpiReferenceCatalogKind,
    rootIds: number[],
  ): Promise<number[]> {
    const roots = Array.from(new Set(rootIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (roots.length === 0) {
      return [];
    }
    // Technicians are a flat catalogue: there is no subtree to expand.
    if (kind === 'technician') {
      return roots;
    }
    const parents = await this.treeParentMap(session, kind);
    const childrenByParent = new Map<number, number[]>();
    for (const [id, parentId] of parents) {
      if (parentId == null) {
        continue;
      }
      const list = childrenByParent.get(parentId);
      if (list) {
        list.push(id);
      } else {
        childrenByParent.set(parentId, [id]);
      }
    }
    const ids: number[] = [];
    const visited = new Set<number>();
    const queue = [...roots];
    while (queue.length > 0) {
      const id = queue.shift() as number;
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      ids.push(id);
      const children = childrenByParent.get(id);
      if (children) {
        queue.push(...children);
      }
    }
    return ids;
  }

  private async treeParentMap(
    session: GlpiSession,
    kind: GlpiReferenceCatalogKind,
  ): Promise<Map<number, number | null>> {
    const itemType = referenceSearchItemType(kind);
    const cacheKey = `${session.baseUrl}|${session.agentUserId ?? 'anon'}|${itemType}`;
    const now = Date.now();
    const cached = this.treeParentCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.parents;
    }
    const parentField = itemType === 'ITILCategory' ? 'itilcategories_id' : itemType === 'Group' ? 'groups_id' : 'entities_id';
    const parents = new Map<number, number | null>();
    for (const record of await this.listItemTypeRows(session, itemType, GLPI_TREE_MAX_ROWS)) {
      const id = parsePositiveInteger(record.id);
      if (!id || parents.has(id)) {
        continue;
      }
      parents.set(id, parsePositiveInteger(record[parentField]) ?? null);
    }
    this.treeParentCache.set(cacheKey, { expiresAt: now + GLPI_TREE_CACHE_TTL_MS, parents });
    return parents;
  }

  // Pages through an item type or sub-item path under apirest.php, returning raw rows
  // deduplicated by id and bounded to maxRows. Also used for group memberships.
  private async listItemTypeRows(
    session: GlpiSession,
    itemType: string,
    maxRows: number,
  ): Promise<Array<Record<string, unknown>>> {
    const rows: Array<Record<string, unknown>> = [];
    const seen = new Set<number>();
    let offset = 0;
    let total: number | null = null;
    while ((total == null || offset < total) && rows.length < maxRows) {
      const end = offset + GLPI_TREE_PAGE_SIZE - 1;
      const pageUrl = new URL(this.buildUrl(session.baseUrl, `apirest.php/${itemType}`));
      pageUrl.searchParams.set('range', `${offset}-${end}`);
      pageUrl.searchParams.set('get_hateoas', 'false');
      pageUrl.searchParams.set('expand_dropdowns', 'false');

      const { response, raw } = await this.requestText(
        pageUrl.toString(),
        {
          headers: this.buildSessionHeaders(session),
        },
      );
      const payload = this.safeParseJson(raw, {
        requestUrl: pageUrl.toString(),
        responseUrl: response.url || pageUrl.toString(),
        contentType: response.headers.get('content-type'),
        status: response.status,
      });
      const mappedError = this.extractGlpiError(payload);
      if (!response.ok) {
        throw this.createHttpError(response.status, mappedError, `Unable to list the GLPI ${itemType} tree.`);
      }
      if (mappedError) {
        throw new BadRequestException(mappedError);
      }
      if (!Array.isArray(payload)) {
        throw new BadRequestException(`GLPI ${itemType} list response was malformed.`);
      }

      let newRows = 0;
      for (const row of payload) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
          continue;
        }
        const record = row as Record<string, unknown>;
        const id = parsePositiveInteger(record.id);
        if (!id || seen.has(id)) {
          continue;
        }
        seen.add(id);
        rows.push(record);
        newRows += 1;
      }

      total = parseContentRangeTotal(response.headers.get('content-range'));
      if (payload.length === 0 || newRows === 0 || (total == null && payload.length < GLPI_TREE_PAGE_SIZE)) {
        break;
      }
      offset += payload.length;
    }
    if (total != null && total > maxRows) {
      this.logger.warn(`GLPI ${itemType} list has ${total} rows; only the first ${maxRows} were read.`);
    }
    return rows;
  }

  async getTicketFollowups(
    session: GlpiSession,
    ticketId: number,
  ): Promise<GlpiTicketFollowup[]> {
    const results: GlpiTicketFollowup[] = [];
    const seenIds = new Set<number>();
    let offset = 0;
    let total: number | null = null;

    while (total == null || offset < total) {
      const end = offset + GLPI_PAGE_SIZE - 1;
      const pageUrl = new URL(this.buildUrl(session.baseUrl, `apirest.php/Ticket/${ticketId}/ITILFollowup`));
      pageUrl.searchParams.set('range', `${offset}-${end}`);
      pageUrl.searchParams.set('expand_dropdowns', 'true');
      pageUrl.searchParams.set('get_hateoas', 'false');
      pageUrl.searchParams.set('order', 'DESC');

      const { response, raw } = await this.requestText(
        pageUrl.toString(),
        {
          headers: this.buildSessionHeaders(session),
        },
      );
      const payload = this.safeParseJson(raw, {
        requestUrl: pageUrl.toString(),
        responseUrl: response.url || pageUrl.toString(),
        contentType: response.headers.get('content-type'),
        status: response.status,
      });
      const mappedError = this.extractGlpiError(payload);
      if (!response.ok) {
        throw this.createHttpError(response.status, mappedError, `Unable to fetch GLPI ticket #${ticketId} followups.`);
      }
      if (mappedError) {
        throw new BadRequestException(mappedError);
      }
      if (!Array.isArray(payload)) {
        throw new BadRequestException('GLPI ticket followups response was malformed.');
      }

      const pageItems = payload
        .map((item) => this.normalizeFollowup(item))
        .filter((item): item is GlpiTicketFollowup => !!item);
      let newItemCount = 0;
      for (const item of pageItems) {
        if (seenIds.has(item.id)) {
          continue;
        }
        seenIds.add(item.id);
        results.push(item);
        newItemCount += 1;
      }

      total = parseContentRangeTotal(response.headers.get('content-range'));
      if (payload.length === 0 || newItemCount === 0 || (total == null && payload.length < GLPI_PAGE_SIZE)) {
        break;
      }
      offset += payload.length;
    }

    return results.sort(compareGlpiDatesDesc);
  }

  async getTicketUsers(
    session: GlpiSession,
    ticketId: number,
  ): Promise<GlpiTicketUserAssociation[]> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    // Raw ids first: with expand_dropdowns=true GLPI replaces users_id by the login
    // string, so the numeric user id is simply not in that response and every row
    // would be dropped. The expanded read is a second, best-effort pass used only to
    // put a human label on each association row (joined on the association id).
    const payload = await this.requestTicketUserRows(session, ticketId, false);
    if (!Array.isArray(payload)) {
      throw new BadRequestException('GLPI ticket users response was malformed.');
    }
    const labelsByAssociationId = await this.readTicketUserLabels(session, ticketId);
    const associations = payload
      .map((item) => this.normalizeTicketUserAssociation(item, labelsByAssociationId))
      .filter((item): item is GlpiTicketUserAssociation => !!item);
    const seen = new Set<string>();
    return associations.filter((association) => {
      const key = `${association.user_id}:${association.role}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private async requestTicketUserRows(
    session: GlpiSession,
    ticketId: number,
    expandDropdowns: boolean,
  ): Promise<unknown> {
    const pageUrl = new URL(this.buildUrl(session.baseUrl, `apirest.php/Ticket/${ticketId}/Ticket_User`));
    pageUrl.searchParams.set('expand_dropdowns', expandDropdowns ? 'true' : 'false');
    pageUrl.searchParams.set('get_hateoas', 'false');
    return this.requestJson(
      pageUrl.toString(),
      { headers: this.buildSessionHeaders(session) },
      { notFoundMessage: `GLPI ticket #${ticketId} users were not found.` },
    );
  }

  // Best effort: a missing or unreadable expanded response just means null labels, and
  // the callers already fall back to "GLPI user <id>". Never fails the association read.
  private async readTicketUserLabels(
    session: GlpiSession,
    ticketId: number,
  ): Promise<Map<number, string>> {
    const labels = new Map<number, string>();
    let expanded: unknown;
    try {
      expanded = await this.requestTicketUserRows(session, ticketId, true);
    } catch {
      return labels;
    }
    if (!Array.isArray(expanded)) {
      return labels;
    }
    for (const item of expanded) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const associationId = parseNumericGlpiValue(record.id);
      if (!associationId) {
        continue;
      }
      const label = decodeGlpiPlainTextField(stringifyGlpiValue(record.users_id));
      // A GLPI version that did not expand the dropdown gives back the bare id: that is
      // not a label, so leave the row unlabelled rather than showing a number twice.
      if (!label || /^\d+$/.test(label)) {
        continue;
      }
      labels.set(associationId, label);
    }
    return labels;
  }

  async addTicketFollowup(
    session: GlpiSession,
    ticketId: number,
    content: string,
    opts?: { isPrivate?: boolean; allowPublic?: boolean },
  ): Promise<GlpiTicketFollowupWriteResult> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    const isPrivate = opts?.isPrivate !== false;
    if (!isPrivate && opts?.allowPublic !== true) {
      throw new BadRequestException('Only private/internal GLPI followups are allowed for agentic triage.');
    }
    const body = normalizePlainTicketFollowup(content, {
      maxChars: isPrivate ? GLPI_MAX_INTERNAL_NOTE_CHARS : GLPI_MAX_PUBLIC_REPLY_CHARS,
      label: isPrivate ? 'GLPI internal note' : 'GLPI public reply',
    });

    const payload = await this.requestJson(
      this.buildUrl(session.baseUrl, 'apirest.php/ITILFollowup'),
      {
        method: 'POST',
        headers: this.buildSessionHeaders(session),
        body: JSON.stringify({
          input: {
            itemtype: 'Ticket',
            items_id: ticketId,
            content: body,
            is_private: isPrivate ? 1 : 0,
          },
        }),
      },
    );

    const record = this.expectRecord(payload, 'GLPI followup creation');
    const id = parseNumericGlpiValue(record.id)
      ?? parseNumericGlpiValue((record as Record<string, unknown>).items_id)
      ?? null;
    if (!id) {
      throw new BadRequestException('GLPI followup creation response was malformed.');
    }
    return {
      id,
      ticket_id: ticketId,
      is_private: isPrivate,
      content_html: body,
    };
  }

  async updateTicketFields(
    session: GlpiSession,
    ticketId: number,
    fields: GlpiTicketUpdateFields,
  ): Promise<GlpiTicketUpdateResult> {
    if (!Number.isInteger(ticketId) || ticketId <= 0) {
      throw new BadRequestException('GLPI ticket id must be a positive integer.');
    }
    const input: Record<string, number> = {};
    const allowedFields: Array<keyof GlpiTicketUpdateFields> = ['type', 'priority', 'urgency', 'status', 'itilcategories_id'];
    for (const field of allowedFields) {
      const value = fields[field];
      if (value == null) {
        continue;
      }
      if (!Number.isInteger(value) || value <= 0) {
        throw new BadRequestException(`GLPI ticket field ${field} must be a positive integer.`);
      }
      input[field] = value;
    }
    const updatedFields = Object.keys(input);
    if (updatedFields.length === 0) {
      throw new BadRequestException('No supported GLPI ticket fields were provided for update.');
    }

    await this.requestJson(
      this.buildUrl(session.baseUrl, `apirest.php/Ticket/${ticketId}`),
      {
        method: 'PUT',
        headers: this.buildSessionHeaders(session),
        body: JSON.stringify({ input }),
      },
      { notFoundMessage: `GLPI ticket #${ticketId} was not found.` },
    );

    return {
      ticket_id: ticketId,
      updated_fields: updatedFields,
    };
  }

  async fetchDocument(
    session: GlpiSession,
    sourceUrl: string,
  ): Promise<GlpiDocument> {
    const resolvedUrl = this.resolveSameOriginUrl(session.baseUrl, sourceUrl);
    const requestUrl = this.resolveDocumentDownloadUrl(session.baseUrl, resolvedUrl) ?? resolvedUrl.toString();
    // The body is read inside the request, before its connection is released.
    return this.request(
      requestUrl,
      {
        headers: this.buildBinarySessionHeaders(session),
      },
      (response) => this.readDocumentResponse(response, requestUrl, resolvedUrl),
    );
  }

  private async readDocumentResponse(response: Response, requestUrl: string, resolvedUrl: URL): Promise<GlpiDocument> {
    const contentType = textOrNull(response.headers.get('content-type'));
    if (!response.ok) {
      const raw = await response.text();
      const payload = isLikelyJsonPayload(contentType, raw)
        ? this.safeParseJson(raw, {
            requestUrl,
            responseUrl: response.url || requestUrl,
            contentType,
            status: response.status,
          })
        : null;
      const mappedError = payload ? this.extractGlpiError(payload) : null;
      throw this.createHttpError(response.status, mappedError, `Unable to fetch GLPI image ${resolvedUrl.toString()}.`);
    }

    if (contentType?.toLowerCase().includes('text/html')) {
      throw new BadRequestException(
        `GLPI document download returned HTML instead of a file.`,
      );
    }

    if (isLikelyJsonPayload(contentType, '')) {
      const raw = await response.text();
      const payload = this.safeParseJson(raw, {
        requestUrl,
        responseUrl: response.url || requestUrl,
        contentType,
        status: response.status,
      });
      const mappedError = this.extractGlpiError(payload);
      if (mappedError) {
        throw new BadRequestException(mappedError);
      }
      throw new BadRequestException('GLPI document download returned JSON instead of a file.');
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > GLPI_MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('GLPI image exceeds the 20 MB inline image limit.');
    }

    const buffer = await this.readResponseBuffer(response, GLPI_MAX_DOCUMENT_BYTES);
    if (buffer.length === 0) {
      throw new BadRequestException('GLPI image is empty.');
    }

    const mimeType = textOrNull(response.headers.get('content-type'))?.split(';')[0]?.trim().toLowerCase()
      || 'application/octet-stream';

    return {
      buffer,
      mimeType,
      filename: this.resolveFilename(response, resolvedUrl),
    };
  }

  async killSession(session: GlpiSession): Promise<void> {
    try {
      await this.request(
        this.buildUrl(session.baseUrl, 'apirest.php/killSession'),
        {
          headers: this.buildSessionHeaders(session),
        },
        async () => undefined,
      );
    } catch (error: any) {
      this.logger.debug(`Failed to close GLPI session: ${String(error?.message || error || 'unknown error')}`);
    }
  }

  async testConnection(
    tenantId: string,
    overrides?: GlpiConnectionOverrides,
    manager?: EntityManager,
  ): Promise<GlpiTestResult> {
    const startedAt = Date.now();
    let session: GlpiSession | null = null;

    try {
      if (!manager) {
        throw new BadRequestException('Tenant manager is required for GLPI connection testing.');
      }
      session = await this.initSession(tenantId, manager, overrides);
      return {
        ok: true,
        message: 'GLPI connection succeeded.',
        latency_ms: Date.now() - startedAt,
      };
    } catch (error: any) {
      return {
        ok: false,
        message: this.getErrorMessage(error),
        latency_ms: Date.now() - startedAt,
      };
    } finally {
      if (session) {
        await this.killSession(session);
      }
    }
  }

  private async resolveSettings(
    tenantId: string,
    manager: EntityManager,
    overrides?: GlpiConnectionOverrides,
  ): Promise<ResolvedGlpiSettings> {
    const settings = await this.settingsService.find(tenantId, { manager });
    const baseUrl = normalizeBaseUrl(overrides?.glpi_url ?? settings?.glpi_url ?? null);

    let userToken = textOrNull(overrides?.glpi_user_token);
    if (!userToken && settings?.glpi_user_token_encrypted) {
      try {
        userToken = this.cipher.decrypt(settings.glpi_user_token_encrypted);
      } catch (error: any) {
        throw new BadRequestException(
          `Stored GLPI user token cannot be decrypted: ${String(error?.message || error || 'unknown error')}`,
        );
      }
    }

    let appToken = textOrNull(overrides?.glpi_app_token);
    if (!appToken && settings?.glpi_app_token_encrypted) {
      try {
        appToken = this.cipher.decrypt(settings.glpi_app_token_encrypted);
      } catch (error: any) {
        throw new BadRequestException(
          `Stored GLPI app token cannot be decrypted: ${String(error?.message || error || 'unknown error')}`,
        );
      }
    }

    if (!baseUrl) {
      throw new BadRequestException('GLPI URL is required.');
    }
    if (!userToken) {
      throw new BadRequestException('GLPI user token is required.');
    }

    return { baseUrl, userToken, appToken };
  }

  private normalizeFollowup(payload: unknown): GlpiTicketFollowup | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    const id = parseNumericGlpiValue(record.id);
    if (!id) {
      return null;
    }

    const contentHtml = textOrNull(resolveHtmlContentSource(String(record.content ?? '')));
    const authorId = parseNumericGlpiValue(record.users_id);
    const editorId = parseNumericGlpiValue(record.users_id_editor);
    const authorLabel = decodeGlpiPlainTextField(textOrNull(record.user_name)
      ?? stringifyGlpiValue(record.users_id)
      ?? stringifyGlpiValue(record.users_id_editor)
      ?? null);

    return {
      id,
      content_html: contentHtml,
      author_id: authorId,
      author_label: authorLabel,
      editor_id: editorId,
      date: normalizeGlpiDate(record.date ?? record.date_creation ?? record.date_mod),
      updated_date: normalizeGlpiDate(record.date_mod ?? record.date ?? record.date_creation),
      is_private: parseBooleanGlpiValue(record.is_private),
      image_targets: extractImageTargets(contentHtml),
    };
  }

  private normalizeReferenceCatalogItem(payload: unknown): GlpiReferenceItem | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const id = parsePositiveInteger(record.id ?? record['2']);
    if (!id) {
      return null;
    }
    const name = decodeGlpiPlainTextField(textOrNull(record.name ?? record['1'])
      ?? stringifyGlpiValue(record.name ?? record['1'])
      ?? null);
    const completename = decodeGlpiPlainTextField(textOrNull(record.completename)
      ?? textOrNull(record['completename'])
      ?? stringifyGlpiValue(record.completename ?? record['completename'])
      ?? null)
      ?? name;
    const parentId = parsePositiveInteger(
      record.parent_id
        ?? record.parentId
        ?? record.itilcategories_id
        ?? record.entities_id
        ?? null,
    );
    return {
      id,
      name,
      completename,
      parent_id: parentId,
    };
  }

  private normalizeTicketGroupAssociation(payload: unknown): GlpiTicketGroupAssociation | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const id = parseNumericGlpiValue(record.id);
    const groupId = parseNumericGlpiValue(record.groups_id);
    if (!id || !groupId) {
      return null;
    }
    const rawLabel = typeof record.groups_id === 'object' ? stringifyGlpiValue(record.groups_id) : null;
    return {
      id,
      group_id: groupId,
      group_label: decodeGlpiPlainTextField(rawLabel),
      role: glpiTicketUserRole(record.type),
    };
  }

  private normalizeTicketUserAssociation(
    payload: unknown,
    labelsByAssociationId?: Map<number, string>,
  ): GlpiTicketUserAssociation | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const record = payload as Record<string, unknown>;
    const id = parseNumericGlpiValue(record.id);
    const userId = parseNumericGlpiValue(record.users_id);
    if (!id || !userId) {
      return null;
    }
    const inlineLabel = decodeGlpiPlainTextField(stringifyGlpiValue(record.users_id));
    return {
      id,
      user_id: userId,
      user_label: labelsByAssociationId?.get(id)
        ?? (inlineLabel && !/^\d+$/.test(inlineLabel) ? inlineLabel : null),
      role: glpiTicketUserRole(record.type),
    };
  }

  private buildInitHeaders(
    userToken: string,
    appToken: string | null,
  ): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `user_token ${userToken}`,
      ...(appToken ? { 'App-Token': appToken } : {}),
    };
  }

  private buildSessionHeaders(
    session: GlpiSession,
  ): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Session-Token': session.sessionToken,
      ...(session.appToken ? { 'App-Token': session.appToken } : {}),
    };
  }

  private buildBinarySessionHeaders(
    session: GlpiSession,
  ): Record<string, string> {
    return {
      Accept: 'application/octet-stream',
      'Session-Token': session.sessionToken,
      ...(session.appToken ? { 'App-Token': session.appToken } : {}),
    };
  }

  private buildUrl(baseUrl: string, pathOrUrl: string): string {
    return new URL(pathOrUrl, baseUrl).toString();
  }

  private resolveSameOriginUrl(baseUrl: string, candidate: string): URL {
    const normalized = textOrNull(candidate);
    if (!normalized) {
      throw new BadRequestException('GLPI image URL is missing.');
    }

    const resolved = new URL(normalized, baseUrl);
    const base = new URL(baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      throw new BadRequestException('GLPI image URL must use http:// or https://.');
    }
    if (resolved.origin !== base.origin) {
      throw new BadRequestException('GLPI image URL must stay on the configured GLPI origin.');
    }
    if (resolved.username || resolved.password) {
      throw new BadRequestException('GLPI image URL must not include embedded credentials.');
    }

    return resolved;
  }

  private resolveDocumentDownloadUrl(baseUrl: string, sourceUrl: URL): string | null {
    const pathname = sourceUrl.pathname.toLowerCase();
    let documentId: number | null = null;

    if (pathname.endsWith('/front/document.send.php') || pathname.endsWith('/document.send.php')) {
      documentId = parseNumericGlpiValue(sourceUrl.searchParams.get('docid'));
    } else {
      const apiMatch = sourceUrl.pathname.match(/\/apirest\.php\/Document\/(\d+)(?:\/)?$/i);
      if (apiMatch?.[1]) {
        documentId = Number.parseInt(apiMatch[1], 10);
      }
    }

    if (!documentId || !Number.isFinite(documentId) || documentId <= 0) {
      return null;
    }

    const downloadUrl = new URL(this.buildUrl(baseUrl, `apirest.php/Document/${documentId}`));
    downloadUrl.searchParams.set('alt', 'media');
    return downloadUrl.toString();
  }

  private expectRecord(payload: unknown, label: string): Record<string, unknown> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(`${label} response was malformed.`);
    }
    return payload as Record<string, unknown>;
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    opts?: { notFoundMessage?: string },
  ): Promise<unknown> {
    const { response, raw } = await this.requestText(url, init);
    const payload = this.safeParseJson(raw, {
      requestUrl: url,
      responseUrl: response.url || url,
      contentType: response.headers.get('content-type'),
      status: response.status,
    });

    const mappedError = this.extractGlpiError(payload);
    if (!response.ok) {
      throw this.createHttpError(response.status, mappedError, opts?.notFoundMessage);
    }
    if (mappedError) {
      throw new BadRequestException(mappedError);
    }

    return payload;
  }

  private async requestText(url: string, init: RequestInit): Promise<{ response: Response; raw: string }> {
    return this.request(url, init, async (response) => ({ response, raw: await response.text() }));
  }

  // `read` gets the response and reads its body: the connection is released
  // once it has finished, or failed.
  private async request<T>(url: string, init: RequestInit, read: (response: Response) => Promise<T>): Promise<T> {
    // SSRF guard: block internal targets in multi-tenant cloud (no-op on-prem where
    // a private GLPI base URL is legitimate), then connect to the validated
    // addresses only. redirect:'error' in cloud additionally stops a public host
    // 302-ing to an internal one after the DNS check.
    const target = await openValidatedFetch(url);
    try {
      let response: Response;
      try {
        response = await target.fetch(url, {
          ...init,
          redirect: Features.SINGLE_TENANT ? 'follow' : 'error',
          signal: AbortSignal.timeout(GLPI_TIMEOUT_MS),
        });
      } catch (error: any) {
        throw new BadRequestException(
          `GLPI request failed: ${String(error?.message || error || 'request failed')}`,
        );
      }
      return await read(response);
    } finally {
      await target.close();
    }
  }

  private safeParseJson(
    raw: string,
    meta?: {
      requestUrl?: string | null;
      responseUrl?: string | null;
      contentType?: string | null;
      status?: number | null;
    },
  ): unknown {
    const text = String(raw || '').trim();
    if (!text) {
      return {};
    }
    try {
      return JSON.parse(text);
    } catch {
      const contentType = textOrNull(meta?.contentType);
      const redirected = meta?.responseUrl && meta.requestUrl && meta.responseUrl !== meta.requestUrl
        ? ` Redirected to ${meta.responseUrl}.`
        : '';
      const status = meta?.status ? ` HTTP ${meta.status}.` : '';

      this.logger.warn(
        `GLPI returned non-JSON content for ${meta?.requestUrl || 'unknown request'}`
        + `${meta?.responseUrl && meta?.responseUrl !== meta?.requestUrl ? ` -> ${meta.responseUrl}` : ''}`
        + `${contentType ? ` [${contentType}]` : ''}`,
      );

      if (contentType?.toLowerCase().includes('text/html') || text.startsWith('<!DOCTYPE html') || text.startsWith('<html')) {
        throw new BadRequestException(
          `GLPI returned HTML instead of JSON.${status}`
          + ` Check that the GLPI URL is the base GLPI URL and that the REST API is enabled.`
          + redirected,
        );
      }

      throw new BadRequestException(
        `GLPI returned a non-JSON response.${status}`
        + `${contentType ? ` Content-Type: ${contentType}.` : ''}`
        + redirected,
      );
    }
  }

  private extractGlpiError(payload: unknown): string | null {
    if (Array.isArray(payload) && payload.length > 0) {
      const code = textOrNull(payload[0]);
      const detail = textOrNull(payload[1]);
      if (code?.startsWith('ERROR_')) {
        return this.mapGlpiError(code, detail);
      }
    }
    if (payload && typeof payload === 'object') {
      const record = payload as Record<string, unknown>;
      const code = textOrNull(record.code ?? record.error ?? null);
      const detail = textOrNull(record.message ?? record.error_message ?? null);
      if (code?.startsWith('ERROR_')) {
        return this.mapGlpiError(code, detail);
      }
      if (record.success === false && detail) {
        return detail;
      }
    }
    return null;
  }

  private mapGlpiError(code: string, detail: string | null): string {
    const suffix = detail ? ` ${detail}` : '';
    switch (code) {
      case 'ERROR_SESSION_TOKEN_INVALID':
        return `GLPI session token is invalid.${suffix}`.trim();
      case 'ERROR_GLPI_LOGIN_USER_TOKEN':
        return `GLPI user token is invalid.${suffix}`.trim();
      case 'ERROR_APP_TOKEN_PARAMETERS_MISSING':
      case 'ERROR_WRONG_APP_TOKEN_PARAMETER':
        return `GLPI app token is invalid.${suffix}`.trim();
      case 'ERROR_NOT_FOUND':
        return `GLPI resource was not found.${suffix}`.trim();
      default:
        return `GLPI request failed (${code}).${suffix}`.trim();
    }
  }

  private createHttpError(
    status: number,
    message: string | null,
    notFoundMessage?: string,
  ): Error {
    if (status === 404 && notFoundMessage) {
      return new NotFoundException(notFoundMessage);
    }
    return new BadRequestException(message || `GLPI request failed with HTTP ${status}.`);
  }

  private resolveFilename(response: Response, url: URL): string {
    const contentDisposition = response.headers.get('content-disposition') || '';
    const utf8Match = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      return decodeFilenameComponent(utf8Match[1]);
    }

    const quotedMatch = contentDisposition.match(/filename\s*=\s*"([^"]+)"/i);
    if (quotedMatch?.[1]) {
      return quotedMatch[1];
    }

    const bareMatch = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
    if (bareMatch?.[1]) {
      return bareMatch[1].trim();
    }

    const fallback = decodeFilenameComponent(url.pathname.split('/').pop() || '').trim();
    return fallback || 'glpi-image';
  }

  private async readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) {
      return Buffer.alloc(0);
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancellation failures when enforcing the size limit.
          }
          throw new BadRequestException('GLPI image exceeds the 20 MB inline image limit.');
        }

        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, total);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return 'GLPI connection failed.';
  }
}

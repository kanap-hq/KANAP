import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiEntityService } from './ai-entity.service';
import { AiPolicyService } from './ai-policy.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AI_SEARCH_ENTITY_TYPES, AiExecutionContext, AiSearchEntityType } from './ai.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;
/** Internal pool size requested from the entity service. The picker re-ranks the
 * pool by content tier and trims to the user's limit, so we want enough candidates
 * to make sure tier-1 (ref) and tier-2 (label) matches surface from every type. */
const CANDIDATE_POOL = 200;
const PICKER_ENTITY_TYPES: AiSearchEntityType[] = [
  'applications',
  'assets',
  'business_processes',
  'capex_items',
  'companies',
  'connections',
  'contacts',
  'contracts',
  'departments',
  'documents',
  'incidents',
  'interfaces',
  'locations',
  'projects',
  'requests',
  'spend_items',
  'suppliers',
  'tasks',
];
const KNOWN_ENTITY_TYPES: ReadonlySet<string> = new Set<string>(AI_SEARCH_ENTITY_TYPES);

function isKnownEntityType(value: string): value is AiSearchEntityType {
  return KNOWN_ENTITY_TYPES.has(value);
}

/**
 * Lightweight entity search endpoint backing the @-mention autocomplete in the Plaid
 * composer. Uses a picker-specific entity search so each readable type contributes
 * candidates before the controller applies mention ranking and trims to the UI limit.
 */
@Controller('ai/search')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiSearchController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly entities: AiEntityService,
  ) {}

  private buildContext(req: any): AiExecutionContext {
    return {
      tenantId: String(req?.tenant?.id || ''),
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  /**
   * Tier-based re-ranking helper. The per-type searches inside AiEntityService each
   * compute a SQL-side CASE score on a 1..4 scale (or, for the document index, an
   * index-based fetchLimit-index), and these scales aren't comparable across types.
   * Once we have a flat candidate pool we ignore those scores and rank purely on
   * what's visible in the result row:
   *
   *   100 — ref exact match (case-insensitive). Either the query is the full ref
   *         (e.g. "T-5" matches T-5) or the query is the bare item number (e.g.
   *         "5" matches T-5, PRJ-5, …).
   *    50 — label contains the query as a substring (case-insensitive).
   *    10 — matched by something else (description, snippet, related entity name).
   *
   * Empty query degrades everything to 10, which collapses the sort to "recent
   * items first" — the natural behaviour for the bare `@` trigger.
   */
  private computeTier(item: { ref?: string | null; label?: string | null }, query: string): { tier: number; sortKey: number } {
    const trimmed = query.trim();
    if (!trimmed) return { tier: 10, sortKey: 0 };
    const queryLower = trimmed.toLowerCase();
    const ref = (item.ref || '').toLowerCase();
    const queryNumMatch = trimmed.match(/-(\d+)$|^(\d+)$/);
    const queryNum = queryNumMatch ? (queryNumMatch[1] || queryNumMatch[2]) : null;
    if (ref) {
      if (ref === queryLower) return { tier: 100, sortKey: 0 };
      // Bare number match: query "5" → matches refs ending in "-5" (T-5, PRJ-5…).
      const refNumberMatch = ref.match(/-(\d+)$/);
      if (refNumberMatch && /^\d+$/.test(trimmed) && refNumberMatch[1] === trimmed) {
        return { tier: 100, sortKey: 0 };
      }
      if (queryNum && refNumberMatch && refNumberMatch[1].startsWith(queryNum) && refNumberMatch[1] !== queryNum) {
        return { tier: 75, sortKey: Number.parseInt(refNumberMatch[1], 10) || 0 };
      }
    }
    const label = (item.label || '').toLowerCase();
    if (label && label.includes(queryLower)) return { tier: 50, sortKey: 0 };
    return { tier: 10, sortKey: 0 };
  }

  @Get('entities')
  async searchEntities(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('limit') limitRaw?: string,
    @Query('entity_types') entityTypesRaw?: string,
  ) {
    const query = (q || '').trim();
    const limit = Math.min(Math.max(Number.parseInt(limitRaw || '', 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    // Comma-separated entity_types narrow the search to a specific subset.
    // The frontend sets this when the user typed a recognised type-token prefix
    // (`@APP`, `@PRJ`, `@T-5`, …). With a narrow active, an empty query is
    // legitimate ("show recent items of this type"). Without a narrow, an empty
    // query is rejected so we don't dump the whole workspace.
    // Only known entity types are kept: any other value is ignored, and a list
    // left empty is the same as no narrow at all.
    const requestedEntityTypes = String(entityTypesRaw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(isKnownEntityType);
    const entityTypes = requestedEntityTypes.length > 0
      ? requestedEntityTypes
      : PICKER_ENTITY_TYPES;

    if (!query && requestedEntityTypes.length === 0) {
      return { items: [] };
    }

    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSurfaceAccess(ctx, ctx.manager);

      const result = await this.entities.searchMentionCandidates(ctx, {
        query,
        limit: CANDIDATE_POOL,
        entity_types: entityTypes,
      });

      // Re-rank purely on item content (ignoring the per-type SQL CASE scores
      // which aren't comparable across types). Sort by tier desc + recency desc.
      const ranked = (result.items as any[])
        .map((item) => ({
          item,
          ...this.computeTier(item, query),
          updated: new Date(item.updated_at || 0).getTime(),
        }))
        .sort((a, b) => {
          if (a.tier !== b.tier) return b.tier - a.tier;
          if (a.tier === 75 && a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
          return b.updated - a.updated;
        });

      const items = ranked.slice(0, limit).map(({ item }) => ({
        entity_type: String(item.type || ''),
        id: String(item.id || ''),
        ref: item.ref ? String(item.ref) : null,
        label: item.label ? String(item.label) : null,
      })).filter((entry) => entry.entity_type && entry.id);

      return { items };
    });
  }
}

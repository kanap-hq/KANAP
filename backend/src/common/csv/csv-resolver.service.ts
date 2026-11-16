import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CsvCallerAccess, CsvFieldDefinition, CsvFieldType } from './csv-field.types';
import { SHIPPED_TASK_TYPE_LABELS } from '../../it-ops-settings/catalog-shipped-labels.data';
import { accentFreeKey, AMBIGUOUS_NAMES_SHOWN, type MatchHow } from '../name-matching';

/**
 * Supported FK entity types for resolution
 */
export type FkEntityType =
  | 'users'
  | 'suppliers'
  | 'portfolio_categories'
  | 'portfolio_streams'
  | 'portfolio_sources'
  | 'portfolio_task_types'
  | 'companies'
  | 'departments'
  | 'locations'
  | 'portfolio_project_phases';

/**
 * Entity configuration for FK resolution
 */
interface FkEntityConfig {
  tableName: string;
  lookupColumn: string;
  idColumn: string;
  additionalColumns?: string[];
  /** Optional scope column (e.g., project_id for phases) */
  scopeColumn?: string;
  /**
   * A family looked up by its name (not by an e-mail or a code): a file's name finds a record once
   * accents are set aside too (lot I3 of 26.11.9), for a person who reads one of these modules
   * (the level `reader`, as the routes that list the family).
   */
  byName?: { readers: readonly string[] };
  /** The prefix of the family's business reference, numbered by `item_number` (`SUP-3`). */
  refPrefix?: string;
}

/** What a name of the file finds: nothing, several records (named), or one record and how. */
export type FkNameLookup =
  | { kind: 'none' }
  | { kind: 'many'; names: string[] }
  | { kind: 'one'; entry: FkCacheEntry; how: MatchHow; target: string; ref: string | null };


const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** The modules whose readers see the portfolio's classification lists (`GET /portfolio/classification/all`). */
const PORTFOLIO_LIST_READERS = [
  'tasks', 'portfolio_requests', 'portfolio_projects', 'portfolio_planning', 'portfolio_reports', 'portfolio_settings',
] as const;

/**
 * FK resolution cache entry
 */
interface FkCacheEntry {
  id: string;
  [key: string]: any;
}

/**
 * Service for resolving foreign key relationships in CSV imports/exports.
 *
 * Preloads all relevant FK tables into Maps for efficient lookup.
 * Supports case-insensitive matching with lowercase normalization.
 */
@Injectable()
export class CsvResolverService {
  /**
   * Entity configurations for FK resolution
   */
  private readonly entityConfigs: Record<FkEntityType, FkEntityConfig> = {
    users: {
      tableName: 'users',
      lookupColumn: 'email',
      idColumn: 'id',
      additionalColumns: ['first_name', 'last_name'],
    },
    suppliers: {
      tableName: 'suppliers',
      lookupColumn: 'name',
      idColumn: 'id',
      additionalColumns: ['item_number'],
      byName: { readers: ['suppliers'] },
      refPrefix: 'SUP',
    },
    portfolio_categories: {
      tableName: 'portfolio_categories',
      lookupColumn: 'name',
      idColumn: 'id',
      byName: { readers: PORTFOLIO_LIST_READERS },
    },
    portfolio_streams: {
      tableName: 'portfolio_streams',
      lookupColumn: 'name',
      idColumn: 'id',
      additionalColumns: ['category_id'],
      byName: { readers: PORTFOLIO_LIST_READERS },
    },
    portfolio_sources: {
      tableName: 'portfolio_sources',
      lookupColumn: 'name',
      idColumn: 'id',
      byName: { readers: PORTFOLIO_LIST_READERS },
    },
    portfolio_task_types: {
      tableName: 'portfolio_task_types',
      lookupColumn: 'name',
      idColumn: 'id',
      additionalColumns: ['code'],
      byName: { readers: ['tasks'] },
    },
    companies: {
      tableName: 'companies',
      lookupColumn: 'name',
      idColumn: 'id',
      additionalColumns: ['item_number'],
      byName: { readers: ['companies'] },
      refPrefix: 'COMP',
    },
    departments: {
      tableName: 'departments',
      lookupColumn: 'name',
      idColumn: 'id',
      additionalColumns: ['company_id', 'item_number'],
      byName: { readers: ['departments'] },
      refPrefix: 'DEPT',
    },
    locations: {
      tableName: 'locations',
      lookupColumn: 'location_reference',
      idColumn: 'id',
      additionalColumns: ['name'],
    },
    portfolio_project_phases: {
      tableName: 'portfolio_project_phases',
      lookupColumn: 'name',
      idColumn: 'id',
      scopeColumn: 'project_id',
      byName: { readers: ['portfolio_projects'] },
    },
  };

  /**
   * Beside each family's cache (whose shape the exports and the incidents read), its names once
   * accents are set aside: by accent-free key, the records the case-blind lookup gives for each
   * distinct name (the first one read of each, as that lookup), for the families looked up by name.
   */
  private readonly accentIndexes = new WeakMap<Map<string, FkCacheEntry>, Map<string, FkCacheEntry[]>>();

  /**
   * Preload all necessary FK tables for the given field definitions.
   * Returns a Map of entity type to lookup Map (lowercase value -> entity).
   *
   * @param tenantId - Current tenant ID
   * @param fieldDefs - Field definitions that may require FK resolution
   * @param manager - TypeORM EntityManager
   * @returns Cache map: entityType -> (lookupValue -> entity)
   */
  async preloadResolvers(
    tenantId: string,
    fieldDefs: CsvFieldDefinition[],
    manager: EntityManager,
  ): Promise<Map<string, Map<string, FkCacheEntry>>> {
    const cache = new Map<string, Map<string, FkCacheEntry>>();

    // Determine which entities need to be loaded
    const fkTypes = this.extractFkTypes(fieldDefs);

    // One after the other: the request's single connection runs its queries in turn anyway.
    for (const entityType of fkTypes) {
      const entityCache = await this.loadEntityCache(tenantId, entityType, manager);
      cache.set(entityType, entityCache);
    }

    return cache;
  }

  /**
   * Preload a specific entity type with optional scope.
   * Useful for scoped lookups like phases within a project.
   *
   * @param tenantId - Current tenant ID
   * @param entityType - FK entity type
   * @param manager - TypeORM EntityManager
   * @param scope - Optional scope filter (e.g., { project_id: '...' })
   * @returns Cache map: lookupValue -> entity
   */
  async preloadScopedResolver(
    tenantId: string,
    entityType: FkEntityType,
    manager: EntityManager,
    scope?: Record<string, string>,
  ): Promise<Map<string, FkCacheEntry>> {
    return this.loadEntityCache(tenantId, entityType, manager, scope);
  }

  /**
   * Resolve a value to its entity using the cache.
   * Returns null if not found.
   *
   * @param entityType - FK entity type
   * @param lookupValue - Value to look up (case-insensitive)
   * @param cache - Preloaded cache map
   * @returns Resolved entity or null
   */
  resolve(
    entityType: string,
    lookupValue: string | null | undefined,
    cache: Map<string, Map<string, FkCacheEntry>>,
  ): FkCacheEntry | null {
    if (!lookupValue || lookupValue.trim() === '') {
      return null;
    }

    const entityCache = cache.get(entityType);
    if (!entityCache) {
      return null;
    }

    const normalizedValue = this.normalizeValue(lookupValue);
    return entityCache.get(normalizedValue) ?? null;
  }

  /**
   * Resolve a value to just its ID using the cache.
   *
   * @param entityType - FK entity type
   * @param lookupValue - Value to look up (case-insensitive)
   * @param cache - Preloaded cache map
   * @returns Resolved ID or null
   */
  resolveId(
    entityType: string,
    lookupValue: string | null | undefined,
    cache: Map<string, Map<string, FkCacheEntry>>,
  ): string | null {
    const entity = this.resolve(entityType, lookupValue, cache);
    return entity?.id ?? null;
  }

  /**
   * The record a name of the file finds (lot I3 of 26.11.9): exactly or case aside, as `resolve`
   * (the first record read wins, as before); then, when `beyondCase` and the family is looked up by
   * name, once accents are set aside. There, one name answering is that record (the same one the
   * case-blind lookup gives for that name); several different names answering are an ambiguity, named
   * by the records' references, else their names (the first five). A record found by a name other
   * than its own beyond case (a shipped task type's name in another language) is a `translation`.
   */
  resolveName(
    entityType: string,
    lookupValue: string | null | undefined,
    cache: Map<string, Map<string, FkCacheEntry>>,
    options: { beyondCase: boolean },
  ): FkNameLookup {
    if (!lookupValue || lookupValue.trim() === '') return { kind: 'none' };
    const entityCache = cache.get(entityType);
    if (!entityCache) return { kind: 'none' };
    const config = this.entityConfigs[entityType as FkEntityType];
    const normalizedValue = this.normalizeValue(lookupValue);
    const found = entityCache.get(normalizedValue);
    if (found) {
      const own = this.normalizeValue(String(found._originalLookupValue ?? ''));
      const how: MatchHow = own === normalizedValue
        ? (String(found._originalLookupValue).trim() === lookupValue.trim() ? 'exact' : 'case')
        : 'translation';
      return this.found(config, found, how);
    }
    if (!options.beyondCase || !config?.byName) return { kind: 'none' };
    const candidates = this.accentIndexes.get(entityCache)?.get(accentFreeKey(lookupValue)) ?? [];
    if (candidates.length === 0) return { kind: 'none' };
    if (candidates.length > 1) {
      return {
        kind: 'many',
        names: candidates.slice(0, AMBIGUOUS_NAMES_SHOWN).map((entry) => this.refOf(config, entry) ?? String(entry._originalLookupValue ?? '')),
      };
    }
    const [entry] = candidates;
    const how: MatchHow = accentFreeKey(String(entry._originalLookupValue ?? '')) === accentFreeKey(lookupValue) ? 'accents' : 'translation';
    return this.found(config, entry, how);
  }

  /**
   * Whether a person with `access` may have a name of `entityType` found beyond case: the family is
   * looked up by name and the person reads one of its modules. Without access (an internal caller),
   * no: the lookup stays case-blind, as before.
   */
  matchesBeyondCase(entityType: string, access: CsvCallerAccess | null | undefined): boolean {
    const readers = this.entityConfigs[entityType as FkEntityType]?.byName?.readers;
    if (!readers || !access) return false;
    if (access.isAdmin) return true;
    return readers.some((module) => (LEVEL_RANK[access.permissions?.[module] ?? ''] ?? 0) >= LEVEL_RANK.reader);
  }

  private found(config: FkEntityConfig | undefined, entry: FkCacheEntry, how: MatchHow): FkNameLookup {
    return { kind: 'one', entry, how, target: String(entry._originalLookupValue ?? ''), ref: this.refOf(config, entry) };
  }

  private refOf(config: FkEntityConfig | undefined, entry: FkCacheEntry): string | null {
    const number = Number(entry.item_number);
    return config?.refPrefix && entry.item_number != null && Number.isSafeInteger(number) && number > 0
      ? `${config.refPrefix}-${number}`
      : null;
  }

  /**
   * Reverse lookup: get the display value for an entity ID.
   * Useful for exports.
   *
   * @param entityType - FK entity type
   * @param entityId - Entity ID to look up
   * @param cache - Preloaded cache map
   * @returns Display value or null
   */
  reverseResolve(
    entityType: string,
    entityId: string | null | undefined,
    cache: Map<string, Map<string, FkCacheEntry>>,
  ): string | null {
    if (!entityId) {
      return null;
    }

    const entityCache = cache.get(entityType);
    if (!entityCache) {
      return null;
    }

    // Search through cache for matching ID
    for (const [lookupValue, entity] of entityCache.entries()) {
      if (entity.id === entityId) {
        // Return original (non-normalized) lookup value from entity
        return entity._originalLookupValue ?? lookupValue;
      }
    }

    return null;
  }

  /**
   * Build a reverse lookup map (id -> display value) for exports.
   *
   * @param entityType - FK entity type
   * @param cache - Preloaded cache map
   * @returns Map of id -> display value
   */
  buildReverseLookup(
    entityType: string,
    cache: Map<string, Map<string, FkCacheEntry>>,
  ): Map<string, string> {
    const reverse = new Map<string, string>();
    const entityCache = cache.get(entityType);

    if (entityCache) {
      for (const entity of entityCache.values()) {
        if (!reverse.has(entity.id)) {
          reverse.set(entity.id, entity._originalLookupValue ?? '');
        }
      }
    }

    return reverse;
  }

  /**
   * Extract FK entity types needed from field definitions.
   */
  private extractFkTypes(fieldDefs: CsvFieldDefinition[]): Set<FkEntityType> {
    const types = new Set<FkEntityType>();

    for (const field of fieldDefs) {
      // A list of references (`ARRAY` with `fkEntity`, numbered columns of owners) resolves its cells
      // in the same cache as a single reference.
      if (
        (field.type === CsvFieldType.FK_BY_EMAIL ||
          field.type === CsvFieldType.FK_BY_NAME ||
          field.type === CsvFieldType.FK_BY_CODE ||
          field.type === CsvFieldType.ARRAY) &&
        field.fkEntity
      ) {
        const entityType = field.fkEntity as FkEntityType;
        if (this.entityConfigs[entityType]) {
          types.add(entityType);
        }
      }
    }

    return types;
  }

  /**
   * Load all entities of a type into a cache map.
   */
  private async loadEntityCache(
    tenantId: string,
    entityType: FkEntityType,
    manager: EntityManager,
    scope?: Record<string, string>,
  ): Promise<Map<string, FkCacheEntry>> {
    const cache = new Map<string, FkCacheEntry>();
    const config = this.entityConfigs[entityType];

    if (!config) {
      return cache;
    }

    // Build column list
    const columns = [config.idColumn, config.lookupColumn];
    if (config.additionalColumns) {
      columns.push(...config.additionalColumns);
    }

    // Build query
    let query = `SELECT ${columns.join(', ')} FROM ${config.tableName} WHERE tenant_id = $1`;
    const params: any[] = [tenantId];

    // Add scope conditions if provided
    if (scope && config.scopeColumn) {
      const scopeValue = scope[config.scopeColumn];
      if (scopeValue) {
        query += ` AND ${config.scopeColumn} = $${params.length + 1}`;
        params.push(scopeValue);
      }
    }

    // Execute query
    const rows = await manager.query(query, params);

    // Build cache with lowercase normalization
    for (const row of rows) {
      const lookupValue = row[config.lookupColumn];
      if (lookupValue != null) {
        const normalizedValue = this.normalizeValue(String(lookupValue));
        const entry: FkCacheEntry = {
          id: row[config.idColumn],
          _originalLookupValue: String(lookupValue),
        };

        // Copy additional columns
        if (config.additionalColumns) {
          for (const col of config.additionalColumns) {
            entry[col] = row[col];
          }
        }

        // Only store first match (in case of duplicates)
        if (!cache.has(normalizedValue)) {
          cache.set(normalizedValue, entry);
        }
      }
    }

    if (entityType === 'portfolio_task_types') this.addShippedTaskTypeNames(cache);
    if (config.byName) this.accentIndexes.set(cache, this.accentIndex(cache));
    return cache;
  }

  /** The records of a cache by the accent-free key of each name they answer to; one record once per key. */
  private accentIndex(cache: Map<string, FkCacheEntry>): Map<string, FkCacheEntry[]> {
    const index = new Map<string, FkCacheEntry[]>();
    for (const [name, entry] of cache) {
      const key = accentFreeKey(name);
      const entries = index.get(key);
      if (!entries) index.set(key, [entry]);
      else if (!entries.some((other) => other.id === entry.id)) entries.push(entry);
    }
    return index;
  }

  /**
   * A task type the tenant kept as shipped (its code and English name) also answers to the name the
   * app shows for it in each language ("Tâche"). The stored names were added first and keep
   * precedence; the export still writes the stored name (`_originalLookupValue`).
   */
  private addShippedTaskTypeNames(cache: Map<string, FkCacheEntry>): void {
    const kept = [...new Set(cache.values())].filter((entry) => {
      const shipped = entry.code ? SHIPPED_TASK_TYPE_LABELS[entry.code] : undefined;
      return !!shipped && shipped.source === entry._originalLookupValue;
    });
    for (const entry of kept) {
      const shipped = SHIPPED_TASK_TYPE_LABELS[entry.code];
      for (const label of [shipped.en, shipped.fr, shipped.de, shipped.es]) {
        const key = this.normalizeValue(label);
        if (!cache.has(key)) cache.set(key, entry);
      }
    }
  }

  /**
   * Normalize a lookup value for case-insensitive matching.
   */
  private normalizeValue(value: string): string {
    return value.toLowerCase().trim();
  }

  /**
   * Get the lookup column for an entity type.
   */
  getLookupColumn(entityType: FkEntityType): string {
    return this.entityConfigs[entityType]?.lookupColumn ?? 'name';
  }

  /**
   * Check if an entity type is supported.
   */
  isSupported(entityType: string): entityType is FkEntityType {
    return entityType in this.entityConfigs;
  }
}

import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { CsvCallerAccess, CsvFieldDefinition, CsvFieldType } from './csv-field.types';
import { SHIPPED_TASK_TYPE_LABELS } from '../../it-ops-settings/catalog-shipped-labels.data';
import { accentFreeKey, AMBIGUOUS_NAMES_SHOWN, type MatchHow } from '../name-matching';
import { parentReadLock } from '../record-membership';

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
  /**
   * The record a name belongs to, when several records may share it (lot I7a of 26.12.1, P12): a
   * stream's category, a department's company. `column` is the column of the family's table, and also
   * the property of the record that holds the pair (`category_id`); `entity` the parent's family.
   */
  parent?: { column: string; entity: FkEntityType };
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
  | { kind: 'many'; names: string[]; scoped?: { entries: FkCacheEntry[]; how: MatchHow } }
  | { kind: 'one'; entry: FkCacheEntry; how: MatchHow; target: string; ref: string | null };


const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/** The modules whose readers see the portfolio's classification lists (`GET /portfolio/classification/all`). */
const PORTFOLIO_LIST_READERS = [
  'tasks', 'portfolio_requests', 'portfolio_projects', 'portfolio_planning', 'portfolio_reports', 'portfolio_settings',
] as const;

/**
 * FK resolution cache entry
 */
export interface FkCacheEntry {
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
      parent: { column: 'category_id', entity: 'portfolio_categories' },
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
      parent: { column: 'company_id', entity: 'companies' },
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
      byName: { readers: ['portfolio_projects'] },
    },
  };

  /**
   * Beside each family's cache (whose shape the exports and the incidents read), its names once
   * accents are set aside: by accent-free key, every record answering it, for the families looked up
   * by name. The cache keeps one record per name; this index keeps each record read, so that two
   * records of the same name are two (T-I3a, lot I3 of 26.11.9, fixes D).
   */
  private readonly accentIndexes = new WeakMap<Map<string, FkCacheEntry>, Map<string, FkCacheEntry[]>>();

  /**
   * For a family whose names several records may share (`parent`), every record read: by its name
   * case aside (the cache keeps the first one), and by id (lot I7a of 26.12.1).
   */
  private readonly sameNames = new WeakMap<Map<string, FkCacheEntry>, Map<string, FkCacheEntry[]>>();
  private readonly byId = new WeakMap<Map<string, FkCacheEntry>, Map<string, FkCacheEntry>>();

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
    /** An import that writes (`lock`): the families with a parent are read `FOR KEY SHARE` (`parentReadLock`). */
    opts?: { lock?: boolean },
  ): Promise<Map<string, Map<string, FkCacheEntry>>> {
    const cache = new Map<string, Map<string, FkCacheEntry>>();

    // Determine which entities need to be loaded
    const fkTypes = this.extractFkTypes(fieldDefs);

    // One after the other: the request's single connection runs its queries in turn anyway.
    for (const entityType of fkTypes) {
      const entityCache = await this.loadEntityCache(tenantId, entityType, manager, opts?.lock === true);
      cache.set(entityType, entityCache);
    }

    return cache;
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
   * name, once accents are set aside. There, one record answering is that record; several records
   * answering, even of the same name (two departments "Finance" of two companies), are an ambiguity,
   * named by the records' references, else their names (the first five). A record found by a name other
   * than its own beyond case (a shipped task type's name in another language) is a `translation`.
   * In a family whose names several records may share (`parent`, lot I7a of 26.12.1), several records
   * of the name, case aside, are an ambiguity too; there, an ambiguity carries its records (`scoped`),
   * for the import to look the name up in the row's parent.
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
    const sameName = config?.parent ? this.sameNames.get(entityCache)?.get(normalizedValue) ?? [] : [];
    if (sameName.length > 1) return this.ambiguous(config, sameName, 'case');
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
    if (candidates.length > 1) return this.ambiguous(config, candidates, 'accents');
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

  /** Several records for one name: named by their references, else their names (the first five). */
  private ambiguous(config: FkEntityConfig | undefined, entries: FkCacheEntry[], how: MatchHow): FkNameLookup {
    return {
      kind: 'many',
      names: entries.slice(0, AMBIGUOUS_NAMES_SHOWN).map((entry) => this.refOf(config, entry) ?? String(entry._originalLookupValue ?? '')),
      ...(config?.parent ? { scoped: { entries, how } } : {}),
    };
  }

  /** The record a name of the file found, as a match is noted (its name and business reference). */
  describeEntry(entityType: string, entry: FkCacheEntry): { target: string; ref: string | null } {
    return { target: String(entry._originalLookupValue ?? ''), ref: this.refOf(this.entityConfigs[entityType as FkEntityType], entry) };
  }

  /**
   * The parent of a family whose names several records may share (lot I7a of 26.12.1): the column of
   * the family's table, which is also the record's property holding it, and the parent's family. None
   * for the other families.
   */
  parentOf(entityType: string): { column: string; entity: FkEntityType } | null {
    return this.entityConfigs[entityType as FkEntityType]?.parent ?? null;
  }

  /** A record of a family whose names several records may share, read in the cache, by its id; null when none. */
  entryById(entityType: string, id: string | null | undefined, cache: Map<string, Map<string, FkCacheEntry>>): FkCacheEntry | null {
    const entityCache = id ? cache.get(entityType) : undefined;
    if (!entityCache) return null;
    return this.byId.get(entityCache)?.get(String(id).toLowerCase()) ?? null;
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
    lock = false,
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
    // A department or a stream an import writes on a record cannot move to another parent before the
    // import commits (lot I7a of 26.12.1): the rows of a family with a parent are read `FOR KEY SHARE`.
    const query = `SELECT ${columns.join(', ')} FROM ${config.tableName} WHERE tenant_id = $1${config.parent ? parentReadLock(manager, lock) : ''}`;
    const rows = await manager.query(query, [tenantId]);
    // Every record read, by its own name, for the accent-free index (the cache keeps one per name).
    const read: Array<[string, FkCacheEntry]> = [];

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
        read.push([normalizedValue, entry]);
      }
    }

    if (entityType === 'portfolio_task_types') this.addShippedTaskTypeNames(cache);
    if (config.byName) this.accentIndexes.set(cache, this.accentIndex([...read, ...cache]));
    if (config.parent) {
      const sameNames = new Map<string, FkCacheEntry[]>();
      for (const [name, entry] of read) sameNames.set(name, [...(sameNames.get(name) ?? []), entry]);
      this.sameNames.set(cache, sameNames);
      this.byId.set(cache, new Map(read.map(([, entry]) => [String(entry.id).toLowerCase(), entry])));
    }
    return cache;
  }

  /**
   * Records by the accent-free key of each name they answer to (their own name, a shipped name added
   * to the cache); one record once per key.
   */
  private accentIndex(names: Iterable<[string, FkCacheEntry]>): Map<string, FkCacheEntry[]> {
    const index = new Map<string, FkCacheEntry[]>();
    for (const [name, entry] of names) {
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

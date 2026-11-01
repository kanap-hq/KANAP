import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, Raw } from 'typeorm';
import {
  UserDashboardConfig,
  DashboardTileConfig,
  DEFAULT_DASHBOARD_CONFIG,
  DEFAULT_BUDGET_DASHBOARD_CONFIG,
  BUDGET_AMOUNT_COLUMN_KEYS,
  DASHBOARD_SECTION_IDS,
  type DashboardLayout,
} from './user-dashboard-config.entity';
import { UpdateDashboardConfigDto, UpdateHomeDashboardConfigDto } from './dto/update-dashboard-config.dto';

type HomeDashboardConfig = {
  tiles: DashboardTileConfig[];
  hideEmptyTiles: boolean;
  /** Null until the person orders the sections. */
  sections: NonNullable<DashboardLayout['sections']> | null;
};

/** The configuration a person sees in their layout, the defaults filling what they never chose. */
function withLayout(tiles: DashboardTileConfig[], layout: DashboardLayout | null | undefined): HomeDashboardConfig {
  return { tiles, hideEmptyTiles: layout?.hideEmptyTiles !== false, sections: layout?.sections ?? null };
}

interface ServiceOptions {
  manager?: EntityManager;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(UserDashboardConfig)
    private readonly repo: Repository<UserDashboardConfig>,
  ) {}

  private getRepo(manager?: EntityManager): Repository<UserDashboardConfig> {
    return manager ? manager.getRepository(UserDashboardConfig) : this.repo;
  }

  /**
   * Every default tile is present in the result. A default tile absent from `tiles` keeps its default
   * state when reading (a tile added after the user saved shows up as designed) but is stored disabled
   * when saving (`missingAsDisabled`), so a tile the client left out does not come back switched on.
   */
  private mergeWithDefaults(tiles: DashboardTileConfig[], missingAsDisabled = false): DashboardTileConfig[] {
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    const merged = DEFAULT_DASHBOARD_CONFIG.map((defaultTile) => {
      const existing = byId.get(defaultTile.id);
      return existing
        ? {
            ...existing,
            config: { ...defaultTile.config, ...(existing.config || {}) },
          }
        : { ...defaultTile, enabled: missingAsDisabled ? false : defaultTile.enabled, config: { ...defaultTile.config } };
    });

    const knownIds = new Set(DEFAULT_DASHBOARD_CONFIG.map((tile) => tile.id));
    const extras = tiles
      .filter((tile) => !knownIds.has(tile.id))
      .map((tile) => ({ ...tile, config: { ...(tile.config || {}) } }));

    return [...merged, ...extras]
      .sort((a, b) => a.order - b.order)
      .map((tile, index) => ({ ...tile, order: index + 1 }));
  }

  /**
   * Get user's dashboard configuration, returning defaults if none exists
   */
  async getConfig(
    userId: string,
    opts?: ServiceOptions,
  ): Promise<HomeDashboardConfig> {
    const repo = this.getRepo(opts?.manager);
    const config = await repo.findOne({
      where: { user_id: userId, tenant_id: Raw((alias) => `${alias} = app_current_tenant()`) },
    });

    if (config) {
      return withLayout(this.mergeWithDefaults(config.tiles), config.layout);
    }

    // Return default configuration
    return withLayout(DEFAULT_DASHBOARD_CONFIG.map((tile) => ({ ...tile, config: { ...tile.config } })), null);
  }

  /**
   * Save user's dashboard configuration (upsert). The option and the sections keep their saved value
   * when the client leaves them out; the sections, when sent, name each section once.
   */
  async saveConfig(
    userId: string,
    dto: UpdateHomeDashboardConfigDto,
    opts?: ServiceOptions,
  ): Promise<HomeDashboardConfig> {
    const repo = this.getRepo(opts?.manager);
    if (dto.sections) {
      const ids = new Set(dto.sections.map((section) => section.id));
      if (ids.size !== dto.sections.length || ids.size !== DASHBOARD_SECTION_IDS.length) {
        throw new BadRequestException('Name every section once');
      }
    }

    const tiles = this.mergeWithDefaults(dto.tiles, true);
    const saved = await repo.findOne({
      where: { user_id: userId, tenant_id: Raw((alias) => `${alias} = app_current_tenant()`) },
    });
    const layout: DashboardLayout = {
      ...(saved?.layout ?? {}),
      ...(dto.hideEmptyTiles === undefined ? {} : { hideEmptyTiles: dto.hideEmptyTiles }),
      ...(dto.sections === undefined ? {} : { sections: dto.sections.map(({ id, hidden }) => ({ id, hidden })) }),
    };
    await this.writeTiles(repo, userId, 'tiles', tiles, layout);
    return withLayout(tiles, layout);
  }

  /** Update only the selected dashboard, including when two first saves race. */
  private async writeTiles(repo: Repository<UserDashboardConfig>, userId: string, column: 'tiles' | 'budget_tiles', tiles: DashboardTileConfig[], layout?: DashboardLayout) {
    const extra = layout === undefined ? {} : { layout };
    await repo.createQueryBuilder().insert().values({ user_id: userId, [column]: tiles, ...extra, updated_at: new Date() })
      .orUpdate([column, ...Object.keys(extra), 'updated_at'], ['tenant_id', 'user_id']).execute();
  }

  /**
   * Reset user's dashboard configuration to defaults
   */
  async resetConfig(
    userId: string,
    opts?: ServiceOptions,
  ): Promise<HomeDashboardConfig> {
    const repo = this.getRepo(opts?.manager);

    // Preserve the budget dashboard when resetting the main dashboard; the layout goes back to the defaults.
    await this.writeTiles(repo, userId, 'tiles', [], {});

    // Return default configuration
    return withLayout(DEFAULT_DASHBOARD_CONFIG.map((tile) => ({ ...tile, config: { ...tile.config } })), null);
  }

  private mergeBudgetDefaults(tiles: DashboardTileConfig[]): DashboardTileConfig[] {
    const byId = new Map(tiles.map((tile) => [tile.id, tile]));
    return DEFAULT_BUDGET_DASHBOARD_CONFIG.map((fallback) => {
      const existing = byId.get(fallback.id);
      return { ...fallback, ...existing, config: { ...fallback.config, ...existing?.config } };
    }).sort((a, b) => a.order - b.order).map((tile, index) => ({ ...tile, order: index + 1 }));
  }

  async getBudgetConfig(userId: string, opts?: ServiceOptions): Promise<{ tiles: DashboardTileConfig[] }> {
    const row = await this.getRepo(opts?.manager).findOne({
      where: { user_id: userId, tenant_id: Raw((alias) => `${alias} = app_current_tenant()`) },
    });
    return { tiles: this.mergeBudgetDefaults(row?.budget_tiles ?? []) };
  }

  async saveBudgetConfig(userId: string, dto: UpdateDashboardConfigDto, opts?: ServiceOptions): Promise<{ tiles: DashboardTileConfig[] }> {
    const knownIds = new Set(DEFAULT_BUDGET_DASHBOARD_CONFIG.map((tile) => tile.id));
    const seen = new Set<string>();
    for (const tile of dto.tiles) {
      if (!knownIds.has(tile.id) || seen.has(tile.id)) throw new BadRequestException('Unknown or duplicate budget tile');
      seen.add(tile.id);
      if (tile.id === 'budget' && tile.config.columns !== undefined && tile.config.columns !== null) {
        const columns = tile.config.columns;
        if (!Array.isArray(columns) || columns.length === 0 || columns.some((key) => !BUDGET_AMOUNT_COLUMN_KEYS.includes(key))) {
          throw new BadRequestException('Choose at least one known amount column');
        }
      }
    }
    const tiles = this.mergeBudgetDefaults(dto.tiles);
    await this.writeTiles(this.getRepo(opts?.manager), userId, 'budget_tiles', tiles);
    return { tiles };
  }

  async resetBudgetConfig(userId: string, opts?: ServiceOptions): Promise<{ tiles: DashboardTileConfig[] }> {
    await this.writeTiles(this.getRepo(opts?.manager), userId, 'budget_tiles', []);
    return { tiles: this.mergeBudgetDefaults([]) };
  }
}

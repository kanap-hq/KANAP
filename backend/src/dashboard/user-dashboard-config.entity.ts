import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export interface DashboardTileConfig {
  id: string; // 'my-tasks', 'projects-i-lead', etc.
  enabled: boolean;
  order: number;
  config: Record<string, unknown>; // Tile-specific settings
}

/**
 * What a person sees before choosing: four tiles, one row on a wide screen, with the budget section
 * right under them (frontend). The other tiles wait in the settings.
 */
export const DEFAULT_DASHBOARD_CONFIG: DashboardTileConfig[] = [
  { id: 'my-tasks', enabled: true, order: 1, config: { limit: 5, showOverdue: true } },
  { id: 'projects-i-lead', enabled: true, order: 2, config: { limit: 5 } },
  { id: 'application-compliance', enabled: true, order: 3, config: {} },
  // Shown to those who read the infrastructure, with the vulnerability feed on (frontend TILE_REGISTRY).
  { id: 'vulnerabilities', enabled: true, order: 4, config: {} },
  { id: 'recently-viewed', enabled: false, order: 5, config: { limit: 5 } },
  { id: 'projects-i-contribute', enabled: false, order: 6, config: { limit: 5 } },
  { id: 'my-time-last-week', enabled: false, order: 7, config: { days: 7 } },
  { id: 'new-requests', enabled: false, order: 8, config: { limit: 5, days: 7 } },
  { id: 'knowledge-overview', enabled: false, order: 9, config: {} },
  { id: 'team-activity', enabled: false, order: 10, config: { limit: 5 } },
  { id: 'global-status-changes', enabled: false, order: 11, config: { days: 5 } },
  { id: 'stale-tasks', enabled: false, order: 12, config: { scope: 'my', thresholdDays: 90 } },
  { id: 'netbox-sync', enabled: false, order: 13, config: {} },
];

export const BUDGET_AMOUNT_COLUMN_KEYS = ['budget', 'revision', 'forecast', 'follow_up', 'landing'] as const;

/** The budget tiles on by default: the overview, the top lines and the hygiene checks, one row on a wide screen. */
export const DEFAULT_BUDGET_TILE_IDS = ['budget', 'top-lines', 'hygiene'];

export const DEFAULT_BUDGET_DASHBOARD_CONFIG: DashboardTileConfig[] = [
  'budget', 'top-lines', 'hygiene', 'my-budget', 'renewals',
  'top-increases', 'cost-centers', 'recent-updates', 'my-tasks',
].map((id, index) => ({ id, enabled: DEFAULT_BUDGET_TILE_IDS.includes(id), order: index + 1, config: id === 'budget' ? { columns: null } : {} }));

@Entity('user_dashboard_config')
export class UserDashboardConfig {
  @PrimaryColumn('uuid')
  tenant_id!: string;

  @PrimaryColumn('uuid')
  user_id!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column('jsonb', { default: '[]' })
  tiles!: DashboardTileConfig[];

  @Column('jsonb', { default: '[]' })
  budget_tiles!: DashboardTileConfig[];

  /** Leave out the home tiles with nothing to show. */
  @Column('boolean', { default: true })
  hide_empty_tiles!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}

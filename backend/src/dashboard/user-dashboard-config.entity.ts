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

export const DEFAULT_DASHBOARD_CONFIG: DashboardTileConfig[] = [
  { id: 'my-tasks', enabled: true, order: 1, config: { limit: 5, showOverdue: true } },
  { id: 'projects-i-lead', enabled: true, order: 2, config: { limit: 5 } },
  { id: 'projects-i-contribute', enabled: true, order: 3, config: { limit: 5 } },
  { id: 'recently-viewed', enabled: true, order: 4, config: { limit: 5 } },
  { id: 'my-time-last-week', enabled: true, order: 5, config: { days: 7 } },
  { id: 'new-requests', enabled: true, order: 6, config: { limit: 5, days: 7 } },
  { id: 'knowledge-overview', enabled: true, order: 7, config: {} },
  { id: 'application-compliance', enabled: true, order: 8, config: {} },
  { id: 'team-activity', enabled: false, order: 9, config: { limit: 5 } },
  { id: 'global-status-changes', enabled: false, order: 10, config: { days: 5 } },
  { id: 'stale-tasks', enabled: false, order: 11, config: { scope: 'my', thresholdDays: 90 } },
  { id: 'netbox-sync', enabled: false, order: 12, config: {} },
];

export const BUDGET_AMOUNT_COLUMN_KEYS = ['budget', 'revision', 'forecast', 'follow_up', 'landing'] as const;

export const DEFAULT_BUDGET_DASHBOARD_CONFIG: DashboardTileConfig[] = [
  'budget', 'hygiene', 'my-budget', 'my-tasks', 'renewals',
  'top-lines', 'top-increases', 'cost-centers', 'recent-updates',
].map((id, index) => ({ id, enabled: true, order: index + 1, config: id === 'budget' ? { columns: null } : {} }));

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

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at!: Date;
}

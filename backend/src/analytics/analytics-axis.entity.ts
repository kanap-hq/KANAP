import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

export const AXIS_APPLIES_TO = ['opex', 'capex'] as const;
export type AxisAppliesTo = (typeof AXIS_APPLIES_TO)[number];

/**
 * An analytics dimension of a tenant ("axis" in code, "dimension" in the UI).
 * Each budget line holds at most one value per dimension. The default
 * dimension (`is_default`) is the one the legacy `analytics_category_id` API
 * field, the `analytics_category` CSV header and the AI `analytics_category`
 * key address; it is an identity, never a position, a code or a name. Its name
 * may stay NULL (every screen then shows the translated default label).
 */
@Entity('analytics_axes')
export class AnalyticsAxis {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { default: () => 'app_current_tenant()' })
  tenant_id!: string;

  @Column('text')
  code!: string;

  @Column('text', { nullable: true })
  name!: string | null;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('int', { default: 0 })
  sort_order!: number;

  @Column('boolean', { default: false })
  is_default!: boolean;

  /** The budget lines the dimension applies to: OPEX only, CAPEX only, or both (null, always for the default). */
  @Column('text', { nullable: true })
  applies_to!: AxisAppliesTo | null;

  /**
   * A new line of a type it applies to must hold a value on it, and a held value cannot be
   * cleared. Checked only while the dimension is enabled.
   */
  @Column('boolean', { default: false })
  required!: boolean;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

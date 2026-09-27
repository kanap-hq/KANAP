import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

export type CostCenterKind = 'group' | 'cost_center';

export const COST_CENTER_KINDS: readonly CostCenterKind[] = ['group', 'cost_center'];

/**
 * A node of the tenant's cost center tree. A group holds other nodes and has
 * no company; a cost center is a leaf, belongs to one company and is what
 * budget lines are attached to. The tree invariants live in
 * `CostCentersService.validateGraph`; the database enforces the per-row ones.
 */
@Entity('cost_centers')
export class CostCenter {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  code!: string;

  @Column('text')
  kind!: CostCenterKind;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('uuid', { nullable: true })
  parent_id!: string | null;

  @Column('uuid', { nullable: true })
  company_id!: string | null;

  @Column('uuid', { nullable: true })
  owner_user_id!: string | null;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('int', { default: 0 })
  sort_order!: number;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

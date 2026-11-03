import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('business_processes')
export class BusinessProcess {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { default: () => 'app_current_tenant()' })
  tenant_id!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('uuid', { nullable: true })
  owner_user_id!: string | null;

  @Column('uuid', { nullable: true })
  it_owner_user_id!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  /** The ISO 9001 type: management, core or support (`business-process-tree.ts`). */
  @Column('text', { nullable: true })
  process_type!: string | null;

  /** The parent process, in the same tenant; null at the top of the tree. */
  @Column('uuid', { nullable: true })
  parent_id!: string | null;

  @Column({
    type: 'enum',
    enum: StatusState,
    enumName: 'status_state',
    default: StatusState.ENABLED,
  })
  status!: StatusState;

  @Column('timestamptz', { nullable: true })
  disabled_at!: Date | null;

  @Column('boolean', { default: false })
  is_default!: boolean;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

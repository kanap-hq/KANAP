import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { StatusState } from '../common/status';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  /**
   * Business reference in the tenant, shown as SUP-n. Set by the database at insertion
   * (trigger assign_item_number, migration 1856240000000), never written by the application;
   * `default` only makes TypeORM read it back (RETURNING) after an insert.
   */
  @Column({ type: 'int', insert: false, update: false, default: () => 'NULL' })
  item_number!: number;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  erp_supplier_id!: string | null;

  // Legacy free-text contact fields removed; linked contacts live in supplier_contacts

  @Column('text', { nullable: true })
  notes!: string | null;

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

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}

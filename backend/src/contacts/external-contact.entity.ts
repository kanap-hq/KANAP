import { Column, Entity, Index, PrimaryGeneratedColumn, JoinColumn, ManyToOne } from 'typeorm';
import { Supplier } from '../suppliers/supplier.entity';

@Entity('contacts')
export class ExternalContact {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  /**
   * Business reference in the tenant, shown as CTCT-n. Set by the database at insertion
   * (trigger assign_item_number, migration 1856240000000), never written by the application;
   * `default` only makes TypeORM read it back (RETURNING) after an insert.
   */
  @Column({ type: 'int', insert: false, update: false, default: () => 'NULL' })
  item_number!: number;

  @Column('text', { nullable: true })
  first_name!: string | null;

  @Column('text', { nullable: true })
  last_name!: string | null;

  @Column('text', { nullable: true })
  job_title!: string | null;

  @Index()
  @Column('text')
  email!: string; // unique per tenant (lowercased)

  @Column('text', { nullable: true })
  phone!: string | null;

  @Column('text', { nullable: true })
  mobile!: string | null;

  @Column('char', { length: 2, nullable: true })
  country!: string | null; // ISO 3166-1 alpha-2

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('boolean', { default: true })
  active!: boolean;

  @Index()
  @Column('uuid', { nullable: true })
  supplier_id!: string | null;

  @ManyToOne(() => Supplier, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'supplier_id' })
  supplier?: Supplier | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}

import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('connections')
@Index(['tenant_id', 'connection_reference'], { unique: true })
@Index(['tenant_id', 'topology'])
export class Connection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  connection_reference!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  description!: string | null;

  @Column('text')
  topology!: 'server_to_server' | 'multi_server';

  @Column('uuid', { nullable: true })
  source_asset_id!: string | null;

  @Column('text', { nullable: true })
  source_entity_code!: string | null;

  @Column('uuid', { nullable: true })
  destination_asset_id!: string | null;

  @Column('text', { nullable: true })
  destination_entity_code!: string | null;

  @Column('text', { default: 'active' })
  lifecycle!: string;

  @Column('text', { nullable: true })
  criticality!: string | null;

  @Column('text', { nullable: true })
  data_class!: string | null;

  @Column('boolean', { default: false })
  contains_pii!: boolean;

  @Column('text', { default: 'manual' })
  risk_mode!: 'manual' | 'derived';

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  /** Kept by the database (migration 1856270000000): never written by TypeORM, see touchUpdatedAt. */
  @Column({ type: 'timestamptz', default: () => 'now()', update: false })
  updated_at!: Date;
}

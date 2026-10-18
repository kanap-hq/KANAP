import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('assets')
@Index(['tenant_id', 'environment'])
@Index(['tenant_id', 'kind'])
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('text')
  name!: string;

  @Column('text', { nullable: true })
  asset_reference!: string | null;

  @Column('text')
  kind!: string;

  @Column('text', { nullable: true })
  provider!: string | null;

  @Column('text')
  environment!: 'prod' | 'pre_prod' | 'qa' | 'test' | 'dev' | 'sandbox';

  @Column('text', { nullable: true })
  region!: string | null;

  @Column('text', { nullable: true })
  zone!: string | null;

  @Column('text', { nullable: true })
  hostname!: string | null;

  @Column('text', { nullable: true })
  domain!: string | null;

  @Column('text', { nullable: true })
  fqdn!: string | null;

  @Column('text', { array: true, nullable: true })
  aliases!: string[] | null;

  @Column('jsonb', { nullable: true })
  ip_addresses!: Array<{ type: string; ip: string; subnet_cidr: string | null }> | null;

  @Column('text', { nullable: true })
  cluster!: string | null;

  @Column('boolean', { default: false })
  is_cluster!: boolean;

  /**
   * Readable operating system (`Windows Server 2019`). Not a column: the marked technology
   * link is the source, and the asset services attach the label after they load the row.
   */
  operating_system?: string | null;

  @Column('uuid', { nullable: true })
  location_id!: string | null;

  @Column('uuid', { nullable: true })
  sub_location_id!: string | null;

  @Column('text', { default: 'active' })
  status!: string;

  @Column('date', { nullable: true })
  go_live_date!: string | null;

  @Column('date', { nullable: true })
  end_of_life_date!: string | null;

  @Column('text', { nullable: true })
  notes!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

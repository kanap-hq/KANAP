import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A technology linked to an incident (lot S, migration 1854190000000). */
@Entity('incident_technologies')
@Index(['tenant_id', 'incident_id', 'technology_id'], { unique: true })
export class IncidentTechnology {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('uuid')
  incident_id!: string;

  @Column('uuid')
  technology_id!: string;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;
}

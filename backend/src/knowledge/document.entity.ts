import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('documents')
@Index(['tenant_id', 'item_number'], { unique: true })
@Index(['tenant_id', 'updated_at'])
@Index(['tenant_id', 'status'])
@Index(['tenant_id', 'folder_id'])
@Index(['tenant_id', 'library_id'])
@Index(['tenant_id', 'document_type_id'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid', { default: () => 'app_current_tenant()' })
  tenant_id!: string;

  @Column('int')
  item_number!: number;

  @Column('text')
  title!: string;

  @Column('text', { nullable: true })
  summary!: string | null;

  @Column('text', { default: '' })
  content_markdown!: string;

  @Column('text', { default: '' })
  content_plain!: string;

  // Written by the trigger only (documents_search_vector_sync): TypeORM never reads, inserts or
  // updates it, so a save cannot put back a vector read before the text changed.
  @Column({ type: 'tsvector' as any, nullable: true, select: false, insert: false, update: false })
  search_vector?: string | null;

  @Column('uuid', { nullable: true })
  folder_id!: string | null;

  @Column('uuid')
  library_id!: string;

  @Column('uuid', { nullable: true })
  document_type_id!: string | null;

  @Column('uuid', { nullable: true })
  template_document_id!: string | null;

  @Column('text', { default: 'draft' })
  status!: string;

  @Column('int', { default: 1 })
  revision!: number;

  @Column('int', { default: 0 })
  current_version_number!: number;

  @Column('timestamptz', { nullable: true })
  published_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  last_reviewed_at!: Date | null;

  @Column('timestamptz', { nullable: true })
  review_due_at!: Date | null;

  @Column('uuid', { nullable: true })
  created_by!: string | null;

  @Column('uuid', { nullable: true })
  updated_by!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

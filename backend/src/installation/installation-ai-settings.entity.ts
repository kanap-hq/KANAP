import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * The AI settings of the installation set on the screen (installation/ai-installation-settings.domain.ts).
 * One row (`singleton`), no `tenant_id`, no row level security; every column stays null until it is
 * set. The service writes it in SQL and dates it; the audit entry names the author.
 */
@Entity('installation_ai_settings')
export class InstallationAiSettings {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('boolean', { default: true, unique: true })
  singleton!: true;

  @Column('text', { nullable: true, select: false })
  web_search_api_key_encrypted!: string | null;

  @Column('integer', { nullable: true })
  chat_max_tokens!: number | null;

  @Column('integer', { nullable: true })
  ticket_max_images!: number | null;

  @Column('integer', { nullable: true })
  ticket_max_image_bytes!: number | null;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

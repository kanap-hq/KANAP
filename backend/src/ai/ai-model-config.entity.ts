import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AiModelProvider = 'anthropic' | 'openai' | 'ollama' | 'custom';
export type AiModelConfigStatus = 'active' | 'archived';

/**
 * Per-tenant registry of LLM configurations ("AI models"). Each entry bundles a
 * provider connection with the model-level properties that used to live flat on
 * ai_settings (vision support) or hardcoded in code (token prices, timeout).
 *
 * The platform-operated builtin model is intentionally NOT stored here: a null
 * assignment on a consumer (ai_settings.chat_model_config_id or
 * ai_agent_definitions.llm_model_config_id) resolves to the builtin provider.
 *
 * Prices are numeric columns — TypeORM returns them as strings; parse at the
 * service boundary like the other money columns (OPEX/CAPEX convention).
 */
@Entity('ai_model_configs')
@Index(['tenant_id', 'name'], { unique: true })
export class AiModelConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  tenant_id!: string;

  @Column('varchar', { length: 100 })
  name!: string;

  @Column('varchar', { length: 50 })
  provider!: AiModelProvider;

  @Column('varchar', { length: 100 })
  model!: string;

  @Column('text', { nullable: true })
  endpoint_url!: string | null;

  @Column('text', { nullable: true, select: false })
  api_key_encrypted!: string | null;

  @Column('boolean', { default: true })
  supports_vision!: boolean;

  @Column('numeric', { precision: 12, scale: 4, nullable: true })
  price_input_eur_per_mtok!: string | null;

  @Column('numeric', { precision: 12, scale: 4, nullable: true })
  price_output_eur_per_mtok!: string | null;

  // Price of a prompt token read from the provider's cache; null falls back to the input price
  // times the provider's cache read factor (ai-llm-cost.util.ts).
  @Column('numeric', { precision: 12, scale: 4, nullable: true })
  price_cache_read_eur_per_mtok!: string | null;

  // Max LLM response time for this model; null falls back to the per-stage env defaults.
  @Column('integer', { nullable: true })
  llm_timeout_ms!: number | null;

  @Column('varchar', { length: 10, default: 'active' })
  status!: AiModelConfigStatus;

  @Column('boolean', { default: false })
  is_default!: boolean;

  @Column('uuid', { nullable: true })
  updated_by!: string | null;

  @Column('timestamptz', { default: () => 'now()' })
  created_at!: Date;

  @Column('timestamptz', { default: () => 'now()' })
  updated_at!: Date;
}

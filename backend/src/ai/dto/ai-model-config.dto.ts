import { IsBoolean, IsIn, IsInt, IsNumber, IsString, IsUrl, MaxLength, Min, ValidateIf } from 'class-validator';
import { AI_REASONING_EFFORTS, AiReasoningEffort } from '../providers/ai-provider.types';

export class CreateAiModelConfigDto {
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsIn(['anthropic', 'openai', 'ollama', 'custom'])
  provider!: 'anthropic' | 'openai' | 'ollama' | 'custom';

  @IsString()
  @MaxLength(100)
  model!: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, require_tld: false })
  endpoint_url?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4096)
  api_key?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  supports_vision?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_input_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_output_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_cache_read_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(AI_REASONING_EFFORTS)
  reasoning_effort?: AiReasoningEffort | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  llm_timeout_ms?: number | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  is_default?: boolean;
}

export class UpdateAiModelConfigDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  name?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsIn(['anthropic', 'openai', 'ollama', 'custom'])
  provider?: 'anthropic' | 'openai' | 'ollama' | 'custom';

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(100)
  model?: string;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, require_tld: false })
  endpoint_url?: string | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4096)
  api_key?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  supports_vision?: boolean;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_input_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_output_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsNumber()
  @Min(0)
  price_cache_read_eur_per_mtok?: number | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsIn(AI_REASONING_EFFORTS)
  reasoning_effort?: AiReasoningEffort | null;

  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  llm_timeout_ms?: number | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  is_default?: boolean;
}

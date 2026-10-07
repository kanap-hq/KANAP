export type AiProviderId = 'anthropic' | 'openai' | 'ollama' | 'custom';
export type AiSystemPromptRole = 'system' | 'developer';
export type AiMaxTokensParam = 'max_completion_tokens' | 'max_tokens';

export interface AiProviderCapabilities {
  supportsStreaming: boolean;
  supportsToolCalling: boolean;
  requiresApiKey: boolean;
  allowsCustomEndpoint: boolean;
  contextWindow?: number | null;
}

export interface AiProviderDescriptor {
  id: AiProviderId;
  label: string;
  description: string;
  capabilities: AiProviderCapabilities;
}

export interface AiProviderSettingsSnapshot {
  llm_provider: string | null;
  llm_model: string | null;
  llm_endpoint_url: string | null;
  has_llm_api_key: boolean;
}

export type AiProviderTestResult = {
  ok: boolean;
  provider: string | null;
  model: string | null;
  latency_ms: number | null;
  message: string;
  validation_errors: string[];
};

export type AiProviderImageAttachment = {
  mime_type: string;
  /** Base64-encoded image bytes (no data: prefix). */
  base64_data: string;
};

export type AiProviderMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  /**
   * Provider-private reasoning transcript that must be replayed for APIs that
   * require it after tool calls. This must never be shown as assistant text.
   */
  reasoning_content?: string | null;
  /**
   * Image attachments for explicitly configured multimodal models. Callers must not send
   * images unless a vision-capable runtime has been selected.
   */
  images?: AiProviderImageAttachment[] | null;
  tool_calls?: AiProviderToolCall[] | null;
  tool_call_id?: string | null;
};

export type AiProviderToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type AiProviderToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AiReasoningEffort = 'low' | 'medium' | 'high';

export type AiStreamParams = {
  providerId?: AiProviderId;
  model: string;
  apiKey: string | null;
  endpointUrl: string | null;
  // Who set `endpointUrl`: a tenant (the default; checked before the call and the
  // connection bound to the validated addresses) or the platform operator (the
  // built-in provider, used as configured).
  endpointSource?: 'tenant' | 'platform';
  systemPrompt: string;
  systemPromptRole?: AiSystemPromptRole;
  messages: AiProviderMessage[];
  tools: AiProviderToolDef[];
  maxTokens: number;
  maxTokensParam?: AiMaxTokensParam;
  signal?: AbortSignal | null;
  timeoutMs?: number;
  maxRetries?: number;
  parallelToolCalls?: boolean;
  debugTrace?: boolean;
  // Caps how much a reasoning model may think before answering. Only ever set for the
  // platform built-in provider (a config KANAP controls); tenant-provided configurations
  // must never send it, because arbitrary OpenAI-compatible servers may reject the field.
  reasoningEffort?: AiReasoningEffort | null;
};

export type AiProviderDebugTraceName =
  | 'provider_stream_opened'
  | 'provider_first_raw_chunk'
  | 'provider_first_text_delta'
  | 'provider_first_tool_delta'
  | 'provider_tool_call_completed';

export type AiStreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; arguments: string }
  | { type: 'tool_call_end'; id: string }
  | { type: 'debug_trace'; name: AiProviderDebugTraceName; tool_name?: string | null }
  | { type: 'done'; usage?: { input_tokens: number; output_tokens: number }; finish_reason?: string }
  | { type: 'error'; message: string };

export interface AiProviderAdapter {
  readonly descriptor: AiProviderDescriptor;
  validateConfiguration(settings: AiProviderSettingsSnapshot): string[];
  createStream(params: AiStreamParams): AsyncGenerator<AiStreamEvent>;
}

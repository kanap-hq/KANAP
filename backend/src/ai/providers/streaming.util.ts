export type StreamUsage = {
  /** The whole prompt, cached part included. */
  input_tokens: number;
  output_tokens: number;
  /** Prompt tokens read from the provider's cache, when the provider reports them. */
  cache_read_input_tokens?: number;
  /** Prompt tokens written to the provider's cache, when the provider reports them. */
  cache_write_input_tokens?: number;
  /** Output tokens spent reasoning, when an OpenAI-compatible provider reports them. */
  reasoning_tokens?: number;
};

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const maybeError = error as {
    name?: string;
    code?: string;
    message?: string;
  };

  return maybeError.name === 'AbortError'
    || maybeError.code === 'ABORT_ERR'
    || maybeError.message === 'The operation was aborted'
    || maybeError.message === 'The operation was aborted.';
}

export function cloneUsage(usage?: StreamUsage | null): StreamUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const next: StreamUsage = {
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
  };
  if (usage.cache_read_input_tokens != null) {
    next.cache_read_input_tokens = Number(usage.cache_read_input_tokens) || 0;
  }
  if (usage.cache_write_input_tokens != null) {
    next.cache_write_input_tokens = Number(usage.cache_write_input_tokens) || 0;
  }
  return next;
}

// A cache field absent on both sides stays absent; absent on one side counts as 0.
function addOptional(left: number | undefined, right: number | undefined): number | undefined {
  if (left == null && right == null) {
    return undefined;
  }
  return (left ?? 0) + (right ?? 0);
}

export function addUsage(
  total: StreamUsage | undefined,
  usage?: StreamUsage | null,
): StreamUsage | undefined {
  const next = cloneUsage(usage);
  if (!next) {
    return total;
  }
  if (!total) {
    return next;
  }
  const sum: StreamUsage = {
    input_tokens: total.input_tokens + next.input_tokens,
    output_tokens: total.output_tokens + next.output_tokens,
  };
  const cacheRead = addOptional(total.cache_read_input_tokens, next.cache_read_input_tokens);
  if (cacheRead != null) {
    sum.cache_read_input_tokens = cacheRead;
  }
  const cacheWrite = addOptional(total.cache_write_input_tokens, next.cache_write_input_tokens);
  if (cacheWrite != null) {
    sum.cache_write_input_tokens = cacheWrite;
  }
  return sum;
}

export function parseToolCallArguments(rawArguments: string): Record<string, unknown> {
  const parsed = tryParseToolCallArguments(rawArguments);
  return parsed.ok ? parsed.value : {};
}

export function tryParseToolCallArguments(rawArguments: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string } {
  if (!rawArguments || !rawArguments.trim()) {
    return { ok: true, value: {} };
  }

  try {
    const parsed = JSON.parse(rawArguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, value: parsed as Record<string, unknown> };
    }
    return { ok: false, message: 'Tool arguments must be a JSON object.' };
  } catch {
    return { ok: false, message: 'Tool arguments were not valid JSON.' };
  }
}

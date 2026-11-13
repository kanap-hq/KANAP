import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { sameOriginRedirectFetch } from '../../common/outbound-redirects';

export type BraveSearchResult = {
  title: string;
  url: string;
  description: string;
};

type BraveWebResult = {
  title?: string;
  url?: string;
  description?: string;
};

type BraveApiResponse = {
  web?: { results?: BraveWebResult[] };
};

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const SEARCH_TIMEOUT_MS = 5_000;
const MAX_PUBLIC_QUERY_LENGTH = 256;
const INTERNAL_REF_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
  /\b(?:PRJ|REQ|DOC|T)-\d+\b/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:kanap|srv|host|vm|node|db|asset|app|loc|task|req|prj|doc)[-_][A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b/gi,
];

@Injectable()
export class BraveSearchService {
  private readonly logger = new Logger(BraveSearchService.name);

  private getApiKey(): string | undefined {
    return process.env.BRAVE_SEARCH_API_KEY;
  }

  private toPublicQuery(query: string): string {
    const normalized = String(query || '')
      .trim()
      .slice(0, MAX_PUBLIC_QUERY_LENGTH);

    let sanitized = normalized;
    for (const pattern of INTERNAL_REF_PATTERNS) {
      sanitized = sanitized.replace(pattern, ' ');
    }

    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    if (!sanitized) {
      throw new BadRequestException(
        'Web search query must use generic, publicly meaningful terms only.',
      );
    }

    if (sanitized !== normalized) {
      this.logger.warn(
        'Sanitized internal identifiers from a web search query before sending it to Brave Search.',
      );
    }

    return sanitized;
  }

  async search(
    query: string,
    opts?: { count?: number; signal?: AbortSignal },
  ): Promise<BraveSearchResult[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is not configured.');

    const count = Math.min(opts?.count ?? 5, 10);
    const publicQuery = this.toPublicQuery(query);
    const url = `${BRAVE_API_URL}?q=${encodeURIComponent(publicQuery)}&count=${count}`;

    const timeoutSignal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
    const signal = opts?.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;

    // The key travels in a header that a followed redirect would carry to another origin.
    const response = await sameOriginRedirectFetch(globalThis.fetch)(url, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Brave Search API returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const data: BraveApiResponse = await response.json();
    const results = data.web?.results ?? [];

    return results.map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      description: r.description ?? '',
    }));
  }

  async testConnectivity(): Promise<{ ok: boolean; message: string; latency_ms: number | null }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { ok: false, message: 'BRAVE_SEARCH_API_KEY is not configured.', latency_ms: null };
    }

    const start = Date.now();
    try {
      const results = await this.search('test', { count: 1 });
      const latency = Date.now() - start;
      this.logger.log(`Brave Search connectivity test: ok, ${results.length} result(s), ${latency}ms`);
      return { ok: true, message: `Connected successfully (${results.length} result(s)).`, latency_ms: latency };
    } catch (error: unknown) {
      const latency = Date.now() - start;
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Brave Search connectivity test failed: ${message}`);
      return { ok: false, message, latency_ms: latency };
    }
  }
}

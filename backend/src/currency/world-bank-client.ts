import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { openBoundedArchive } from '../common/archive-limits';
import { CURRENCY_TO_WB_CODE } from './world-bank-codes';

export type WorldBankFrequency = 'A' | 'Q';

// The FX dataset archive is about 100 KB and the JSON answers a few KB: these
// limits leave a wide margin and bound what a download or a decompression keeps
// in memory.
export const WB_DOWNLOAD_MAX_BYTES = 32 * 1024 * 1024;
export const WB_RESPONSE_MAX_BYTES = 32 * 1024 * 1024;

export interface WorldBankSeriesRequest {
  frequency: WorldBankFrequency;
  currency: string;
  startPeriod: number;
  endPeriod: number;
}

@Injectable()
export class WorldBankClient {
  private readonly logger = new Logger(WorldBankClient.name);
  private readonly legacyBaseUrls: string[];
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, { timestamp: number; data: any }>();
  private readonly csvDownloadUrl: string;
  private readonly csvCacheDir: string;
  private readonly csvCacheTtlMs: number;
  private annualDataCache: Map<string, Map<number, number>> | null = null;
  private annualDataLoadedAt = 0;
  private annualLoadPromise: Promise<Map<string, Map<number, number>>> | null = null;
  private readonly liveBaseUrl: string;
  private readonly liveApiKey: string | null;
  private readonly liveRateTtlMs: number;
  private readonly liveRateCache = new Map<string, { timestamp: number; rate: number }>();

  constructor() {
    const override = process.env.WB_BASE_URL?.trim();
    const defaults = [
      'https://api.worldbank.org/v2',
    ];
    this.legacyBaseUrls = override && override.length ? [override] : defaults;
    const fallbackTtl = 6 * 60 * 60 * 1000;
    const parsed = Number(process.env.WB_CACHE_TTL_MS);
    this.cacheTtlMs = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackTtl;
    const csvTtlParsed = Number(process.env.WB_CSV_CACHE_TTL_MS);
    this.csvCacheTtlMs = Number.isFinite(csvTtlParsed) && csvTtlParsed > 0 ? csvTtlParsed : 30 * 24 * 60 * 60 * 1000;
    this.csvCacheDir = process.env.WB_CACHE_DIR?.trim() || path.join(os.tmpdir(), 'cio-wb-fx-cache');
    this.csvDownloadUrl =
      process.env.WB_CSV_URL?.trim() || 'https://api.worldbank.org/v2/en/indicator/PA.NUS.FCRF?downloadformat=csv';
    const liveBase = process.env.FX_SPOT_BASE_URL?.trim();
    this.liveBaseUrl = liveBase && liveBase.length ? liveBase : 'https://open.er-api.com/v6/latest';
    this.liveApiKey = process.env.FX_SPOT_API_KEY?.trim() || null;
    const liveTtlParsed = Number(process.env.FX_SPOT_CACHE_TTL_MS);
    this.liveRateTtlMs = Number.isFinite(liveTtlParsed) && liveTtlParsed > 0 ? liveTtlParsed : 30 * 24 * 60 * 60 * 1000; // 30 days (aligns with login refresh interval)
  }

  resolveCode(currency: string): string | null {
    const upper = currency.toUpperCase();
    return CURRENCY_TO_WB_CODE[upper] ?? null;
  }

  async fetchAnnualRates(currency: string, startYear: number, endYear: number): Promise<Map<number, number>> {
    const code = this.resolveCode(currency);
    if (!code) throw new Error(`No World Bank ISO3 mapping for ${currency}`);
    const dataset = await this.ensureAnnualDataset();
    const source = dataset.get(code);
    const map = new Map<number, number>();
    if (!source) {
      this.logger.warn(`World Bank annual dataset missing ISO3 ${code}`);
      return map;
    }
    const first = Math.min(startYear, endYear);
    const last = Math.max(startYear, endYear);
    for (let year = first; year <= last; year += 1) {
      const value = source.get(year);
      if (value != null && Number.isFinite(value)) {
        map.set(year, value);
      }
    }
    return map;
  }

  async fetchSpotRate(currency: string): Promise<number | null> {
    const upper = currency.toUpperCase();
    if (upper === 'USD') return 1;
    const cached = this.liveRateCache.get(upper);
    if (cached && Date.now() - cached.timestamp < this.liveRateTtlMs) {
      return cached.rate;
    }
    try {
      const url = this.buildSpotUrl(upper);
      const payload = await this.requestWithRetry(url, {
        timeoutMs: 15000,
        retries: 2,
        retryDelayMs: 1500,
        skipCache: true,
      });
      const usdPerUnit = this.extractUsdPerUnit(upper, payload);
      if (usdPerUnit != null && usdPerUnit > 0) {
        const value = Number((1 / usdPerUnit).toFixed(6));
        this.liveRateCache.set(upper, { timestamp: Date.now(), rate: value });
        return value;
      }
      this.logger.warn(`Spot FX payload missing USD quote for ${upper}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Spot FX fetch failed for ${upper}: ${reason}`);
    }
    return null;
  }

  private buildSpotUrl(currency: string): string {
    const base = this.liveBaseUrl.trim();
    const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
    const url = new URL(currency, baseWithSlash);
    if (this.liveApiKey) {
      url.searchParams.set('apikey', this.liveApiKey);
    }
    return url.toString();
  }

  private extractUsdPerUnit(currency: string, payload: any): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const direct = payload?.rates?.USD;
    if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) return direct;
    const conversion = payload?.conversion_rates?.USD;
    if (typeof conversion === 'number' && Number.isFinite(conversion) && conversion > 0) return conversion;
    const dataRates = payload?.data?.rates?.USD;
    if (typeof dataRates === 'number' && Number.isFinite(dataRates) && dataRates > 0) return dataRates;
    const rateField = payload?.USD;
    if (typeof rateField === 'number' && Number.isFinite(rateField) && rateField > 0) return rateField;
    this.logger.debug(`Spot FX payload for ${currency} missing USD field: ${JSON.stringify(payload).slice(0, 200)}`);
    return null;
  }

  private async ensureAnnualDataset(): Promise<Map<string, Map<number, number>>> {
    const now = Date.now();
    if (this.annualDataCache && now - this.annualDataLoadedAt < this.csvCacheTtlMs) {
      return this.annualDataCache;
    }
    if (this.annualLoadPromise) {
      return this.annualLoadPromise;
    }
    this.annualLoadPromise = (async () => {
      const csvPath = await this.ensureAnnualCsvFile();
      const csvContent = await fs.promises.readFile(csvPath, 'utf8');
      const dataset = this.parseAnnualCsv(csvContent);
      this.annualDataCache = dataset;
      this.annualDataLoadedAt = Date.now();
      this.annualLoadPromise = null;
      return dataset;
    })().catch((err) => {
      this.annualLoadPromise = null;
      throw err;
    });
    return this.annualLoadPromise;
  }

  private async ensureAnnualCsvFile(): Promise<string> {
    await fs.promises.mkdir(this.csvCacheDir, { recursive: true });
    const csvPath = path.join(this.csvCacheDir, 'world-bank-fcrf.csv');
    let needsDownload = true;
    try {
      const stats = await fs.promises.stat(csvPath);
      if (Date.now() - stats.mtimeMs < this.csvCacheTtlMs) {
        needsDownload = false;
      }
    } catch {
      needsDownload = true;
    }
    if (needsDownload) {
      this.logger.log('Refreshing World Bank FX annual dataset (CSV download)');
      const archive = await this.requestBinaryWithRetry(this.csvDownloadUrl, {
        timeoutMs: 60000,
        retries: 3,
        retryDelayMs: 2000,
      });
      const csvContent = this.extractCsvFromArchive(archive);
      // Written aside, then renamed over the cache file (atomic on one file system): the API
      // processes of a container share this directory, and another one may be reading it.
      const tmpPath = `${csvPath}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmpPath, csvContent, 'utf8');
      await fs.promises.rename(tmpPath, csvPath);
    }
    return csvPath;
  }

  private extractCsvFromArchive(buffer: Buffer): string {
    const archive = openBoundedArchive(buffer);
    const entry = archive.entries().find((item) => {
      const name = item.entryName.toLowerCase();
      return name.endsWith('.csv') && name.includes('api_pa.nus.fcrf') && !name.includes('metadata');
    });
    if (!entry) {
      throw new Error('World Bank CSV archive missing FX data file');
    }
    return archive.readText(entry);
  }

  private parseAnnualCsv(content: string): Map<string, Map<number, number>> {
    const lines = content.split(/\r?\n/);
    const headerIndex = lines.findIndex((line) => line.includes('Country Name'));
    if (headerIndex === -1) {
      throw new Error('World Bank CSV dataset missing header row');
    }
    const csv = lines.slice(headerIndex).join('\n');
    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;
    const dataset = new Map<string, Map<number, number>>();
    records.forEach((row) => {
      const iso3 = String(row['Country Code'] ?? '').trim();
      if (!iso3) return;
      let yearMap = dataset.get(iso3);
      if (!yearMap) {
        yearMap = new Map<number, number>();
        dataset.set(iso3, yearMap);
      }
      Object.entries(row).forEach(([key, raw]) => {
        if (!/^\d{4}$/.test(key)) return;
        const year = Number(key);
        const value = Number(raw);
        if (!Number.isFinite(year) || !Number.isFinite(value) || value <= 0) return;
        yearMap!.set(year, value);
      });
    });
    this.logger.log(`World Bank FX CSV dataset loaded (${dataset.size} ISO3 codes)`);
    return dataset;
  }

  private async requestBinaryWithRetry(
    url: string,
    options: { timeoutMs?: number; retries?: number; retryDelayMs?: number },
  ): Promise<Buffer> {
    const timeoutMs = options.timeoutMs ?? 60000;
    const retries = options.retries ?? 1;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await this.requestBinary(url, timeoutMs, 0);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === retries) break;
        const delay = retryDelayMs * attempt;
        this.logger.warn(
          `World Bank binary request attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError ?? new Error('World Bank binary request failed');
  }

  private requestBinary(url: string, timeoutMs: number, redirectDepth: number): Promise<Buffer> {
    if (redirectDepth > 5) {
      return Promise.reject(new Error('World Bank download exceeded redirect limit'));
    }
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.get(
        parsed,
        {
          headers: {
            Accept: '*/*',
            'User-Agent': 'cio-assistant/1.0',
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location, url).toString();
            res.resume();
            this.requestBinary(nextUrl, timeoutMs, redirectDepth + 1).then(resolve).catch(reject);
            return;
          }
          if (status >= 400) {
            const err = new Error(`World Bank download failed with status ${status}`);
            (err as any).status = status;
            res.resume();
            reject(err);
            return;
          }
          const declared = Number(res.headers['content-length']);
          if (Number.isFinite(declared) && declared > WB_DOWNLOAD_MAX_BYTES) {
            res.destroy();
            reject(new Error('World Bank download exceeds the size limit'));
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          let overLimit = false;
          res.on('data', (chunk) => {
            if (overLimit) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            received += buffer.length;
            if (received > WB_DOWNLOAD_MAX_BYTES) {
              overLimit = true;
              chunks.length = 0;
              res.destroy();
              reject(new Error('World Bank download exceeds the size limit'));
              return;
            }
            chunks.push(buffer);
          });
          res.on('end', () => {
            if (!overLimit) resolve(Buffer.concat(chunks));
          });
          res.on('error', (err) => reject(err as Error));
        },
      );
      req.on('error', (err) => reject(err as Error));
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`World Bank download timed out after ${timeoutMs}ms`));
      });
    });
  }

  private parseArrayResponse(payload: any): Array<{ date: string; value: number | null }> {
    if (!Array.isArray(payload) || payload.length < 2) return [];
    const data = payload[1];
    if (!Array.isArray(data)) return [];
    return data.map((entry) => ({
      date: entry?.date,
      value: entry?.value ?? null,
    }));
  }

  private async requestWithRetry(
    url: string,
    options: { timeoutMs?: number; retries?: number; retryDelayMs?: number; skipCache?: boolean },
  ): Promise<any> {
    const timeoutMs = options.timeoutMs ?? 30000;
    const retries = options.retries ?? 1;
    const retryDelayMs = options.retryDelayMs ?? 1000;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        if (!options.skipCache) {
          const cached = this.readCache(url);
          if (cached != null) {
            return cached;
          }
        }
        const result = await this.request(url, timeoutMs);
        if (!options.skipCache) {
          this.writeCache(url, result);
        }
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt === retries) break;
        const delay = retryDelayMs * attempt;
        this.logger.warn(
          `World Bank request attempt ${attempt}/${retries} failed: ${lastError.message}. Retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError ?? new Error('World Bank request failed');
  }

  private readCache(url: string): any | null {
    const entry = this.cache.get(url);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTtlMs) {
      this.cache.delete(url);
      return null;
    }
    return entry.data;
  }

  private writeCache(url: string, data: any): void {
    this.cache.set(url, { timestamp: Date.now(), data });
  }

  private request(url: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const safeResolve = (value: any) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const parsed = new URL(url);
      const client = parsed.protocol === 'http:' ? http : https;
      const req = client.get(
        parsed,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'cio-assistant/1.0',
            'Accept-Encoding': 'gzip,deflate',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            const err = new Error(`World Bank request failed with status ${res.statusCode}`);
            (err as any).status = res.statusCode;
            safeReject(err);
            res.resume();
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          res.on('data', (chunk) => {
            if (settled) return;
            received += (chunk as Buffer).length;
            if (received > WB_RESPONSE_MAX_BYTES) {
              chunks.length = 0;
              res.destroy();
              safeReject(new Error('World Bank response exceeds the size limit'));
              return;
            }
            chunks.push(chunk as Buffer);
          });
          res.on('end', () => {
            if (settled) return;
            try {
              const buffer = Buffer.concat(chunks);
              if (!buffer.length) {
                safeResolve(null);
                return;
              }
              const encodingHeader = res.headers['content-encoding'];
              const encoding = Array.isArray(encodingHeader)
                ? encodingHeader.join(',').toLowerCase()
                : (encodingHeader || '').toLowerCase();
              const handlePayload = (err: Error | null, data?: Buffer) => {
                if (err) {
                  safeReject(err);
                  return;
                }
                const raw = (data ?? buffer).toString('utf8');
                try {
                  const json = JSON.parse(raw);
                  safeResolve(json);
                } catch (parseErr) {
                  this.logger.warn(`Failed to parse World Bank response as JSON: ${(parseErr as Error).message}`);
                  safeResolve(null);
                }
              };
              // The decompressed answer is bounded too.
              const inflateOptions = { maxOutputLength: WB_RESPONSE_MAX_BYTES };
              if (encoding.includes('gzip')) {
                zlib.gunzip(buffer, inflateOptions, handlePayload);
              } else if (encoding.includes('deflate')) {
                zlib.inflate(buffer, inflateOptions, handlePayload);
              } else {
                handlePayload(null, buffer);
              }
            } catch (err) {
              safeReject(err as Error);
            }
          });
          res.on('error', (err) => safeReject(err as Error));
        },
      );
      req.on('error', (err) => {
        this.logger.warn(`World Bank request to ${url} failed: ${(err as Error).message}`);
        safeReject(err as Error);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`World Bank request timed out after ${timeoutMs}ms`));
      });
    });
  }
}

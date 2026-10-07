import { BadRequestException, Injectable } from '@nestjs/common';
import * as path from 'path';
import { openValidatedFetch } from './pinned-fetch';

const MAX_REMOTE_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const REMOTE_IMAGE_FETCH_TIMEOUT_MS = 15_000;

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

@Injectable()
export class RemoteInlineImageImportService {
  async importFromUrl(sourceUrl: string): Promise<Express.Multer.File> {
    // Always block private targets for user-supplied image URLs, in both deployment
    // modes, and connect to the validated addresses only. The connection is
    // released once the image is read.
    const target = await openValidatedFetch(sourceUrl, { enforcePrivateBlock: true });
    try {
      return await this.download(target.url, target.fetch);
    } finally {
      await target.close();
    }
  }

  private async download(url: URL, boundFetch: typeof fetch): Promise<Express.Multer.File> {
    let response: Response;
    try {
      response = await boundFetch(url.toString(), {
        redirect: 'error',
        signal: AbortSignal.timeout(REMOTE_IMAGE_FETCH_TIMEOUT_MS),
      });
    } catch (error: any) {
      throw new BadRequestException(
        `Unable to fetch remote image: ${String(error?.message || error || 'request failed')}`,
      );
    }

    if (!response.ok) {
      throw new BadRequestException(`Unable to fetch remote image: HTTP ${response.status}`);
    }

    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_INLINE_IMAGE_BYTES) {
      throw new BadRequestException('Image size exceeds 20 MB limit');
    }

    const buffer = await this.readResponseBuffer(response, MAX_REMOTE_INLINE_IMAGE_BYTES);
    if (buffer.length === 0) {
      throw new BadRequestException('Remote image is empty');
    }

    const mimeType = String(response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const originalName = this.deriveOriginalName(url, mimeType);

    return {
      fieldname: 'file',
      originalname: originalName,
      encoding: '7bit',
      mimetype: mimeType || 'application/octet-stream',
      size: buffer.length,
      buffer,
      destination: '',
      filename: path.basename(originalName),
      path: '',
      stream: undefined as any,
    };
  }

  private deriveOriginalName(url: URL, mimeType: string): string {
    const rawName = path.posix.basename(url.pathname || '');
    let safeName = this.sanitizeFilename(rawName);

    if (!safeName) {
      safeName = 'imported-image';
    }

    if (!path.extname(safeName)) {
      const extension = MIME_EXTENSION_MAP[mimeType] || '';
      if (extension) {
        safeName = `${safeName}${extension}`;
      }
    }

    return safeName;
  }

  private sanitizeFilename(value: string): string {
    let decoded = String(value || '').trim();
    if (!decoded) return '';

    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep the original value when decoding fails.
    }

    return path.basename(decoded).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  }

  private async readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        total += value.byteLength;
        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore cancellation failures when enforcing the size limit.
          }
          throw new BadRequestException('Image size exceeds 20 MB limit');
        }

        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, total);
  }
}

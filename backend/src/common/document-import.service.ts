import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { ImportedImageReference } from './document-import-markdown';
import {
  findImportedImageReferences,
  isMarkdownWorkFailure,
  sanitizeImportedMarkdown,
} from './markdown-worker';
import { ARCHIVE_MAX_ENTRY_BYTES, ARCHIVE_MAX_TOTAL_BYTES, openBoundedArchive } from './archive-limits';
import { converterEnv } from './converter-env';
import { IMPORTABLE_MIME_TYPES } from './dto/import-document.dto';
import { validateUploadedFile } from './upload-validation';
import { VectorImageConversionService } from './vector-image-conversion.service';
import { removeSvgBlipElements } from './text-scan';

const execFileAsync = promisify(execFile);

const IMPORT_MAX_FILE_BYTES = 20 * 1024 * 1024;
const PANDOC_TIMEOUT_MS = 60_000;
const PANDOC_MAX_BUFFER_BYTES = 50 * 1024 * 1024;
const VECTOR_IMAGE_EXTENSIONS = new Set(['.svg', '.emf', '.wmf', '.eps']);

/** Limits on the images pandoc extracts, read back from disk: those of the archive itself. */
export type ExtractedMediaLimits = { maxImageBytes: number; maxTotalBytes: number };
const EXTRACTED_MEDIA_LIMITS: ExtractedMediaLimits = {
  maxImageBytes: ARCHIVE_MAX_ENTRY_BYTES,
  maxTotalBytes: ARCHIVE_MAX_TOTAL_BYTES,
};

type ImportedImageOccurrence = {
  kind: 'markdown' | 'html';
  raw: string;
  target: string;
  index: number;
  rewrite: (nextTarget: string | null) => string;
};

export type ImportedDocumentImage = {
  sourcePath: string;
  file: Express.Multer.File;
};

export type ImportedDocumentResult = {
  markdown: string;
  images: ImportedDocumentImage[];
  omittedTargets: string[];
  warnings: string[];
};

@Injectable()
export class DocumentImportService {
  private readonly logger = new Logger(DocumentImportService.name);

  constructor(private readonly vectorConversion: VectorImageConversionService) {}

  async convertToMarkdown(
    fileBuffer: Buffer,
    mimeType: string,
    originalName: string,
  ): Promise<ImportedDocumentResult> {
    const validated = validateUploadedFile(
      {
        originalName,
        mimeType,
        buffer: fileBuffer,
        size: fileBuffer.length,
      },
      { scope: 'document-import' },
    );
    if (validated.size > IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException(`File size exceeds ${IMPORT_MAX_FILE_BYTES} bytes`);
    }

    const format = IMPORTABLE_MIME_TYPES[validated.mimeType];
    if (!format) {
      throw new BadRequestException('Unsupported file type. Allowed: DOCX');
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-import-'));
    const warnings: string[] = [];
    const inputFile = path.join(tempDir, 'input.docx');
    const outputFile = path.join(tempDir, 'output.md');

    try {
      // pandoc decompresses the whole document: its entry count and sizes, declared
      // then real, are checked first (400 when over the limits).
      const archive = openBoundedArchive(fileBuffer);
      archive.assertDeclaredSizes();
      archive.assertRealSizes();

      await fs.writeFile(inputFile, fileBuffer);
      this.stripProprietarySvgExtensions(inputFile);
      await this.convertInputToMarkdown(inputFile, outputFile, tempDir);

      const rawMarkdown = await fs.readFile(outputFile, 'utf8');
      if (!String(rawMarkdown || '').trim()) {
        throw new BadRequestException('Imported document produced no content.');
      }
      // The converter output is cleaned for the editor in the Markdown workers (markdown-worker.ts).
      const { markdown, images: references } = await sanitizeImportedMarkdown(rawMarkdown, {
        fieldName: 'content_markdown',
      });
      const collected = await this.collectReferencedImages(markdown, tempDir, EXTRACTED_MEDIA_LIMITS, references);
      warnings.push(...collected.warnings);

      return {
        markdown,
        images: collected.images,
        omittedTargets: collected.omittedTargets,
        warnings,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException || isMarkdownWorkFailure(error)) {
        throw error;
      }
      const stderr = String(error?.stderr || error?.message || 'unknown error');
      this.logger.error(`Document import conversion failed: ${stderr}`);
      throw new InternalServerErrorException('Document import failed');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async rewriteImageTargets(
    markdown: string,
    replacements: Map<string, string>,
    omittedTargets?: Iterable<string>,
  ): Promise<string> {
    const omitted = new Set(Array.from(omittedTargets || []));
    const occurrences = this.withRewrites(
      await findImportedImageReferences(markdown, { fieldName: 'content_markdown' }),
    );
    const applied = occurrences
      .map((occurrence) => {
        if (replacements.has(occurrence.target)) {
          return {
            raw: occurrence.raw,
            replacement: occurrence.rewrite(replacements.get(occurrence.target) || null),
          };
        }
        if (omitted.has(occurrence.target)) {
          return {
            raw: occurrence.raw,
            replacement: occurrence.rewrite(null),
          };
        }
        return null;
      })
      .filter((entry): entry is { raw: string; replacement: string } => !!entry);

    return this.applyReplacements(markdown, applied);
  }

  private async convertInputToMarkdown(
    inputFile: string,
    outputFile: string,
    tempDir: string,
  ): Promise<void> {
    await execFileAsync(
      'pandoc',
      [
        '--from',
        'docx',
        '--to',
        'gfm',
        '--wrap=none',
        '--extract-media=.',
        inputFile,
        '-o',
        outputFile,
      ],
      {
        cwd: tempDir,
        env: await converterEnv(tempDir),
        timeout: PANDOC_TIMEOUT_MS,
        maxBuffer: PANDOC_MAX_BUFFER_BYTES,
      },
    );
  }

  /**
   * Word 2016+ embeds SVG images via a proprietary `asvg:svgBlip` extension
   * inside `<a:blip>`. Pandoc does not understand this extension and uses the
   * SVG reference, which typically renders as a broken-image placeholder.
   * Stripping the extension forces pandoc to fall back to the PNG/JPEG in the
   * parent `<a:blip r:embed="...">`, which is the correct raster image.
   */
  private stripProprietarySvgExtensions(docxPath: string): void {
    try {
      const archive = openBoundedArchive(docxPath);
      const zip = archive.zip;
      let modified = false;

      for (const entry of archive.entries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;

        const content = archive.readText(entry);
        const stripped = removeSvgBlipElements(content);
        if (stripped.length !== content.length) {
          zip.updateFile(entry.entryName, Buffer.from(stripped, 'utf8'));
          modified = true;
        }
      }

      if (modified) {
        zip.writeZip(docxPath);
      }
    } catch (error: any) {
      this.logger.warn(
        `Failed to preprocess DOCX for SVG extensions: ${String(error?.message || error)}`,
      );
    }
  }

  private async collectReferencedImages(
    markdown: string,
    tempDir: string,
    mediaLimits: ExtractedMediaLimits = EXTRACTED_MEDIA_LIMITS,
    references?: ImportedImageReference[],
  ): Promise<{ images: ImportedDocumentImage[]; omittedTargets: string[]; warnings: string[] }> {
    const images: ImportedDocumentImage[] = [];
    const omittedTargets = new Set<string>();
    const warnings: string[] = [];
    const seenTargets = new Set<string>();
    let mediaBytes = 0;

    const occurrences = references ?? await findImportedImageReferences(markdown, { fieldName: 'content_markdown' });
    for (const occurrence of occurrences) {
      const target = occurrence.target;
      if (!this.isLocalTarget(target) || seenTargets.has(target)) {
        continue;
      }
      seenTargets.add(target);

      const filePath = this.resolveTargetPath(tempDir, target);
      if (!filePath) {
        omittedTargets.add(target);
        warnings.push(`Skipped extracted image ${target}: invalid local path.`);
        continue;
      }

      let buffer: Buffer;
      try {
        // The size on disk is checked before the file is read.
        const { size } = await fs.stat(filePath);
        if (size > mediaLimits.maxImageBytes || mediaBytes + size > mediaLimits.maxTotalBytes) {
          omittedTargets.add(target);
          warnings.push(`Skipped extracted image ${target}: the image is too large.`);
          continue;
        }
        buffer = await fs.readFile(filePath);
        mediaBytes += buffer.length;
      } catch {
        omittedTargets.add(target);
        warnings.push(`Skipped extracted image ${target}: converter output was not found.`);
        continue;
      }

      let originalName = path.basename(filePath);
      let ext = path.extname(originalName).toLowerCase();

      if (VECTOR_IMAGE_EXTENSIONS.has(ext)) {
        const result = await this.vectorConversion.convertToPng(filePath, ext, tempDir);
        if (!result.success || !result.pngBuffer || !result.pngFilename) {
          omittedTargets.add(target);
          warnings.push(`Could not convert vector image ${target} (${ext.slice(1).toUpperCase()}): ${result.reason || 'unknown error'}`);
          continue;
        }
        buffer = result.pngBuffer;
        originalName = result.pngFilename;
        ext = '.png';
        // Fall through to existing raster validation + upload
      }

      try {
        const detectedMime = this.getInlineImageMimeType(ext);
        validateUploadedFile(
          {
            originalName,
            mimeType: detectedMime,
            buffer,
            size: buffer.length,
          },
          { scope: 'inline-image' },
        );
        images.push({
          sourcePath: target,
          file: {
            fieldname: 'file',
            originalname: originalName,
            encoding: '7bit',
            mimetype: detectedMime,
            size: buffer.length,
            buffer,
            destination: '',
            filename: originalName,
            path: '',
            stream: undefined as any,
          },
        });
      } catch {
        omittedTargets.add(target);
        warnings.push(`Skipped extracted image ${target}: unsupported image format.`);
      }
    }

    return {
      images,
      omittedTargets: [...omittedTargets],
      warnings,
    };
  }

  /** The images found in the Markdown workers, with their rewrite. */
  private withRewrites(references: ImportedImageReference[]): ImportedImageOccurrence[] {
    return references.map((reference) => {
      const { raw, target } = reference;
      return {
        ...reference,
        rewrite: reference.kind === 'markdown'
          ? (nextTarget: string | null) => (nextTarget ? raw.replace(target, nextTarget) : '')
          : (nextTarget: string | null) => (nextTarget ? this.buildMarkdownImage(reference, nextTarget) : ''),
      };
    });
  }

  private applyReplacements(
    content: string,
    replacements: Array<{ raw: string; replacement: string }>,
  ): string {
    if (replacements.length === 0) {
      return String(content || '');
    }

    let cursor = 0;
    let output = '';
    const text = String(content || '');

    for (const entry of replacements) {
      const nextIndex = text.indexOf(entry.raw, cursor);
      if (nextIndex < 0) {
        throw new BadRequestException('Failed to rewrite imported image references');
      }
      output += text.slice(cursor, nextIndex);
      output += entry.replacement;
      cursor = nextIndex + entry.raw.length;
    }

    output += text.slice(cursor);
    return output;
  }

  private buildMarkdownImage(reference: ImportedImageReference, target: string): string {
    const alt = reference.alt ?? '';
    const title = reference.title ?? null;
    const encodedTitle = title ? ` "${String(title).replace(/[\\"]/g, '\\$&')}"` : '';
    return `![${alt}](${target}${encodedTitle})`;
  }

  private isLocalTarget(target: string): boolean {
    const normalized = String(target || '').trim();
    if (!normalized) return false;
    if (normalized.startsWith('/')) return false;
    if (normalized.startsWith('#')) return false;
    if (normalized.startsWith('data:')) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
    return true;
  }

  private resolveTargetPath(tempDir: string, rawTarget: string): string | null {
    let decoded = String(rawTarget || '').trim();
    if (!decoded) return null;

    const queryIndex = decoded.search(/[?#]/);
    if (queryIndex >= 0) {
      decoded = decoded.slice(0, queryIndex);
    }
    if (!decoded) return null;

    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      // Keep the original target when decoding fails.
    }

    const resolved = path.resolve(tempDir, decoded);
    const relative = path.relative(tempDir, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      return null;
    }
    return resolved;
  }

  private getInlineImageMimeType(extension: string): string {
    switch (String(extension || '').toLowerCase()) {
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      default:
        throw new BadRequestException('Unsupported image type. Allowed: PNG, JPG, JPEG, GIF, WEBP');
    }
  }
}

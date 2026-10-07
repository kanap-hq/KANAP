import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ARCHIVE_MAX_ENTRY_BYTES, ARCHIVE_MAX_TOTAL_BYTES, openBoundedArchive } from './archive-limits';
import { IMPORTABLE_MIME_TYPES } from './dto/import-document.dto';
import { validateUploadedFile } from './upload-validation';
import { VectorImageConversionService } from './vector-image-conversion.service';

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
      const markdown = this.sanitizeForMdxEditor(rawMarkdown);
      const collected = await this.collectReferencedImages(markdown, tempDir);
      warnings.push(...collected.warnings);

      return {
        markdown,
        images: collected.images,
        omittedTargets: collected.omittedTargets,
        warnings,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const stderr = String(error?.stderr || error?.message || 'unknown error');
      this.logger.error(`Document import conversion failed: ${stderr}`);
      throw new InternalServerErrorException('Document import failed');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  rewriteImageTargets(
    markdown: string,
    replacements: Map<string, string>,
    omittedTargets?: Iterable<string>,
  ): string {
    const omitted = new Set(Array.from(omittedTargets || []));
    const occurrences = this.findImageOccurrences(markdown);
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
    const svgBlipPattern = /<(?:[a-zA-Z0-9]+:)?svgBlip\b[\s\S]*?\/>/g;

    try {
      const archive = openBoundedArchive(docxPath);
      const zip = archive.zip;
      let modified = false;

      for (const entry of archive.entries()) {
        if (entry.isDirectory) continue;
        const name = entry.entryName;
        if (!name.startsWith('word/') || !name.endsWith('.xml')) continue;

        const content = archive.readText(entry);
        const stripped = content.replace(svgBlipPattern, '');
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
  ): Promise<{ images: ImportedDocumentImage[]; omittedTargets: string[]; warnings: string[] }> {
    const images: ImportedDocumentImage[] = [];
    const omittedTargets = new Set<string>();
    const warnings: string[] = [];
    const seenTargets = new Set<string>();
    let mediaBytes = 0;

    for (const occurrence of this.findImageOccurrences(markdown)) {
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

  private findImageOccurrences(markdown: string): ImportedImageOccurrence[] {
    const text = String(markdown || '');
    const occurrences: ImportedImageOccurrence[] = [];

    const markdownImageRegex = /!\[[^\]]*]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
    let markdownMatch: RegExpExecArray | null;
    while ((markdownMatch = markdownImageRegex.exec(text)) !== null) {
      const raw = String(markdownMatch[0] || '');
      const target = String(markdownMatch[1] || '').trim();
      const index = Number(markdownMatch.index || 0);
      if (!raw || !target) continue;
      occurrences.push({
        kind: 'markdown',
        raw,
        target,
        index,
        rewrite: (nextTarget) => (nextTarget ? raw.replace(target, nextTarget) : ''),
      });
    }

    const htmlImageRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
    let htmlMatch: RegExpExecArray | null;
    while ((htmlMatch = htmlImageRegex.exec(text)) !== null) {
      const raw = String(htmlMatch[0] || '');
      const target = String(htmlMatch[2] || '').trim();
      const index = Number(htmlMatch.index || 0);
      if (!raw || !target) continue;
      occurrences.push({
        kind: 'html',
        raw,
        target,
        index,
        rewrite: (nextTarget) => (nextTarget ? this.buildMarkdownImage(raw, nextTarget) : ''),
      });
    }

    return occurrences.sort((a, b) => a.index - b.index);
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

  private buildMarkdownImage(rawHtml: string, target: string): string {
    const alt = this.escapeMarkdownImageText(this.readHtmlAttribute(rawHtml, 'alt') || '');
    const title = this.readHtmlAttribute(rawHtml, 'title');
    const encodedTitle = title ? ` "${String(title).replace(/"/g, '\\"')}"` : '';
    return `![${alt}](${target}${encodedTitle})`;
  }

  private readHtmlAttribute(rawHtml: string, attributeName: string): string | null {
    const pattern = new RegExp(`\\b${attributeName}\\s*=\\s*([\"'])(.*?)\\1`, 'i');
    const match = rawHtml.match(pattern);
    return match?.[2] ? String(match[2]) : null;
  }

  private escapeMarkdownImageText(value: string): string {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]');
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

  /**
   * Post-processes pandoc GFM output to produce clean markdown that:
   * 1. Passes the backend `content_markdown` validation (no raw HTML).
   * 2. Parses without errors in the frontend MDXEditor (JSX/MDX rules).
   *
   * Pandoc falls back to raw HTML for constructs GFM cannot represent
   * (tables with column widths, merged cells, autolinks, etc.).
   */
  private sanitizeForMdxEditor(markdown: string): string {
    // Protect fenced code blocks from processing.
    const codeBlocks: string[] = [];
    let result = String(markdown || '').replace(
      /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n\1\s*$/gm,
      (match) => {
        const i = codeBlocks.length;
        codeBlocks.push(match);
        return `\x00CB${i}\x00`;
      },
    );

    // Convert HTML tables to GFM markdown tables.
    result = result.replace(/<table\b[\s\S]*?<\/table>/gi, (html) => this.convertHtmlTableToGfm(html));

    // Convert URI autolinks <scheme://…> to standard markdown links.
    // MDX treats <https://…> as JSX and fails on the :// namespace syntax.
    result = result.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s>]+)>/g, '[$1]($1)');

    // Convert email autolinks <user@host> to markdown mailto links.
    result = result.replace(/<([^\s>@]+@[^\s>]+\.[^\s>]+)>/g, '[$1](mailto:$1)');

    // Convert semantic HTML breaks/rules to markdown equivalents.
    result = result.replace(/<br\s*\/?>/gi, '\n');
    result = result.replace(/<hr\s*\/?>/gi, '\n---\n');

    // Convert <img> tags to markdown images before stripping HTML.
    result = result.replace(
      /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi,
      (match, _q, src) => {
        const alt = this.escapeMarkdownImageText(this.readHtmlAttribute(match, 'alt') || '');
        return `![${alt}](${src})`;
      },
    );

    // Strip HTML comments (e.g. pandoc bookmarks, drawing group markers).
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    // Strip block-level and inline HTML tags, keeping text content.
    result = result.replace(/<\/p\s*>/gi, '\n\n');
    result = result.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g, '');

    // Decode common HTML entities left by stripped HTML.
    result = this.decodeHtmlEntities(result);

    // Collapse excessive blank lines.
    result = result.replace(/\n{3,}/g, '\n\n');

    // Restore code blocks.
    result = result.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[Number(i)]);

    return result;
  }

  private convertHtmlTableToGfm(html: string): string {
    const rows: string[][] = [];
    const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const text = this.stripHtmlToText(cellMatch[1]).replace(/\|/g, '\\|');
        cells.push(text);
      }
      if (cells.length > 0) rows.push(cells);
    }

    if (rows.length === 0) return '';

    // Normalize column count.
    const maxCols = Math.max(...rows.map((r) => r.length));
    for (const row of rows) {
      while (row.length < maxCols) row.push('');
    }

    // First row becomes the header (pandoc puts <th> in a <thead>).
    const lines: string[] = [];
    lines.push('| ' + rows[0].map((c) => c || ' ').join(' | ') + ' |');
    lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
    for (let i = 1; i < rows.length; i++) {
      lines.push('| ' + rows[i].map((c) => c || ' ').join(' | ') + ' |');
    }

    return '\n' + lines.join('\n') + '\n';
  }

  private stripHtmlToText(html: string): string {
    let text = String(html || '');
    text = text.replace(/<br\s*\/?>/gi, ' ');
    text = text.replace(/<\/p\s*>/gi, ' ');
    text = text.replace(/<\/?[a-zA-Z][a-zA-Z0-9]*\b[^>]*\/?>/g, '');
    text = this.decodeHtmlEntities(text);
    return text.replace(/\s+/g, ' ').trim();
  }

  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'");
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

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { openBoundedArchive } from './archive-limits';
import { ExportFormat } from './dto/export.dto';
import { isDevelopmentEnv, parseBoolean } from './env';
import { readStreamWithCaps, StreamLimitError } from './bounded-stream';

const execFileAsync = promisify(execFile);

const MAX_EXPORT_CONTENT_BYTES = 1_000_000;
// Budgets mémoire. Les images validées sont incorporées à l'arbre sous forme de
// data: URI : leur contenu transite donc entièrement par la mémoire du processus,
// d'où trois plafonds distincts (téléchargement, incorporation, arbre sérialisé).
export const MAX_IMAGE_BYTES_PER_IMAGE = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES_TOTAL = 32 * 1024 * 1024;
const MAX_INLINED_IMAGE_BYTES = 64 * 1024 * 1024;
const MAX_PARSED_AST_JSON_BYTES = 32 * 1024 * 1024;
const MAX_REWRITTEN_AST_JSON_BYTES = 64 * 1024 * 1024;
const PANDOC_TIMEOUT_MS = 30_000;
const IMAGE_FETCH_TIMEOUT_MS = 15_000;
const PANDOC_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const DEFAULT_FILENAME = 'document';
const HTML_IMAGE_RE = /<img\b[^>]*>/gi;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ODT_MAX_IMAGE_WIDTH_CM = 16;
const ODT_SIZE_RE = /^([0-9]*\.?[0-9]+)\s*(cm|mm|in|pt|px)$/i;

type ExportConfig = {
  extension: 'pdf' | 'docx' | 'odt';
  mimeType: string;
  pandocTarget: 'pdf' | 'docx' | 'odt';
};

export type ExportImageFetchOptions = {
  imageFetchHeaders?: Record<string, string>;
  /**
   * Résolution interne d'une image de l'application (lecture du stockage, contrôlée
   * par les droits de l'appelant), prioritaire sur le téléchargement HTTP. Fournie
   * par les appelants qui disposent d'une identité et d'un contexte tenant ; son
   * absence laisse le comportement d'origine intact.
   */
  resolveInlineImage?: (rawTarget: string) => Promise<ResolvedExportImage | null>;
};

export type ResolvedExportImage = {
  buffer: Buffer;
  mimeType: string | null;
};

type ImageBudget = {
  downloadedBytes: number;
  inlinedBytes: number;
};

type AstImageContext = {
  opts?: ExportImageFetchOptions;
  cache: Map<string, string>;
  budget: ImageBudget;
};

@Injectable()
export class DocumentExportService {
  private readonly logger = new Logger(DocumentExportService.name);
  private readonly allowedImageHostPatterns = this.buildAllowedImageHostPatterns();
  private readonly mediaBaseUrl = this.resolveMediaBaseUrl();
  private readonly selfHostnames = this.buildSelfHostnames();

  async exportMarkdown(
    content: string,
    format: ExportFormat,
    title?: string,
    opts?: ExportImageFetchOptions,
  ): Promise<{ buffer: Buffer; mimeType: string; extension: string; filename: string }> {
    const normalized = String(content || '');
    const sizeBytes = Buffer.byteLength(normalized, 'utf8');
    if (!normalized.trim()) {
      throw new BadRequestException('content is required');
    }
    if (sizeBytes > MAX_EXPORT_CONTENT_BYTES) {
      throw new BadRequestException(`content exceeds ${MAX_EXPORT_CONTENT_BYTES} bytes`);
    }

    const config = this.getExportConfig(format);
    const safeTitle = this.sanitizeFilename(title || DEFAULT_FILENAME);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kanap-export-'));
    const inputFile = path.join(tempDir, 'input.md');
    const parsedAstFile = path.join(tempDir, 'parsed.json');
    const rewrittenAstFile = path.join(tempDir, 'rewritten.json');
    const outputFile = path.join(tempDir, `output.${config.extension}`);

    try {
      await fs.writeFile(inputFile, normalized, 'utf8');

      // Passe 1 — lecture seule. Le lecteur Pandoc résout lui-même les images par
      // référence et certaines balises HTML : c'est son arbre, et non une
      // reconnaissance textuelle du Markdown, qui fait autorité pour la validation.
      // Aucune ressource n'est chargée pendant cette passe.
      await this.runPandoc(
        ['--sandbox', '--from', 'gfm', '--to', 'json', '--output', parsedAstFile, inputFile],
        tempDir,
      );
      const parsedAst = await this.readAstFile(parsedAstFile, MAX_PARSED_AST_JSON_BYTES);

      // Toutes les ressources sont validées puis incorporées ici : la passe 2 ne
      // verra plus que des data: URI produites par nos soins. Les métadonnées du
      // document sont écartées ; le titre reste fourni par l'application.
      await this.inlineAstImages(parsedAst, {
        opts,
        cache: new Map<string, string>(),
        budget: { downloadedBytes: 0, inlinedBytes: 0 },
      });

      const rewrittenAst = JSON.stringify(parsedAst);
      if (Buffer.byteLength(rewrittenAst, 'utf8') > MAX_REWRITTEN_AST_JSON_BYTES) {
        throw new BadRequestException('Document export is too large');
      }
      await fs.writeFile(rewrittenAstFile, rewrittenAst, 'utf8');

      const args = [
        '--sandbox',
        '--from',
        'json',
        '--to',
        config.pandocTarget,
        '--standalone',
        '--output',
        outputFile,
      ];
      if (title && title.trim()) {
        args.push('--metadata', `title=${title.trim()}`);
      }
      if (config.pandocTarget === 'pdf') {
        args.push(
          '--pdf-engine=typst',
          '--pdf-engine-opt=--font-path=/usr/share/fonts',
          '--pdf-engine-opt=--font-path=/usr/local/share/fonts',
          '--variable=mainfont:Noto Sans',
          '--variable=sansfont:Noto Sans',
          '--variable=monofont:DejaVu Sans Mono',
        );
      }
      args.push(rewrittenAstFile);

      await this.runPandoc(args, tempDir);

      if (config.pandocTarget === 'odt') {
        await this.normalizeOdtImageFrames(outputFile).catch((error: any) => {
          const message = String(error?.message || error || 'unknown error');
          this.logger.warn(`ODT image post-processing skipped: ${message}`);
        });
      }

      const buffer = await fs.readFile(outputFile);
      return {
        buffer,
        mimeType: config.mimeType,
        extension: config.extension,
        filename: `${safeTitle}.${config.extension}`,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const stderr = String(error?.stderr || error?.message || 'unknown error');
      this.logger.error(`Pandoc export failed (${format}): ${stderr}`);
      throw new InternalServerErrorException('Document export failed');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * `--sandbox` limite les E/S des lecteurs et rédacteurs Pandoc aux fichiers
   * nommés sur la ligne de commande. Il ne limite ni les filtres ni la production
   * du PDF (moteur externe, ici Typst) et ne constitue donc pas un confinement de
   * processus : c'est une protection complémentaire. La garantie principale reste
   * qu'aucune ressource n'est résolue par Pandoc — tout est validé puis fourni
   * sous forme de data: URI.
   */
  private async runPandoc(args: string[], cwd: string): Promise<void> {
    await execFileAsync('pandoc', args, {
      cwd,
      timeout: PANDOC_TIMEOUT_MS,
      maxBuffer: PANDOC_MAX_BUFFER_BYTES,
    });
  }

  private async readAstFile(file: string, maxBytes: number): Promise<any> {
    const stats = await fs.stat(file);
    if (stats.size > maxBytes) {
      throw new BadRequestException('Document export is too large');
    }
    const raw = await fs.readFile(file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch {
      throw new InternalServerErrorException('Document export failed');
    }
  }

  private getExportConfig(format: ExportFormat): ExportConfig {
    switch (format) {
      case 'pdf':
        return {
          extension: 'pdf',
          mimeType: 'application/pdf',
          pandocTarget: 'pdf',
        };
      case 'docx':
        return {
          extension: 'docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pandocTarget: 'docx',
        };
      case 'odt':
        return {
          extension: 'odt',
          mimeType: 'application/vnd.oasis.opendocument.text',
          pandocTarget: 'odt',
        };
      default:
        throw new BadRequestException('Unsupported export format');
    }
  }

  private async inlineAstImages(ast: any, ctx: AstImageContext): Promise<void> {
    if (!ast || typeof ast !== 'object') return;
    ast.blocks = await this.rewriteImageNodes(ast.blocks, ctx);
    ast.meta = {};
  }

  /**
   * Parcours récursif de l'arbre : tout nœud Image — quelle que soit la syntaxe
   * d'origine, y compris les images par référence que seul le lecteur Pandoc
   * résout — est remplacé par une ressource validée par nos soins.
   */
  private async rewriteImageNodes(node: any, ctx: AstImageContext): Promise<any> {
    if (Array.isArray(node)) {
      const rewritten: any[] = [];
      for (const child of node) {
        // Les tableaux imbriqués de l'AST (attributs, listes d'inlines, lignes de
        // tableau…) sont des données : ils restent imbriqués tels quels.
        if (Array.isArray(child)) {
          rewritten.push(await this.rewriteImageNodes(child, ctx));
          continue;
        }
        // `null` et les valeurs scalaires sont signifiants dans l'AST (un `Maybe`
        // vide, un niveau de titre…) : ils sont recopiés sans modification.
        if (child === null || typeof child !== 'object') {
          rewritten.push(child);
          continue;
        }
        // Un nœud remplacé par plusieurs nœuds (images issues de HTML brut, texte
        // de remplacement d'une image) est inséré à la place de l'original.
        const value = await this.rewriteImageNodes(child, ctx);
        if (Array.isArray(value)) rewritten.push(...value);
        else rewritten.push(value);
      }
      return rewritten;
    }

    if (!node || typeof node !== 'object') return node;

    if (node.t === 'Image' && Array.isArray(node.c) && Array.isArray(node.c[2])) {
      const alt = Array.isArray(node.c[1]) ? node.c[1] : [];
      const rawTarget = String(node.c[2][0] ?? '');
      if (!rawTarget.trim()) {
        // Cible vide : il n'y a aucune ressource à charger. L'image est remplacée
        // par son texte de remplacement plutôt que de faire échouer l'export sur
        // une syntaxe incomplète. Ce texte peut lui-même contenir des images.
        return this.rewriteImageNodes(alt, ctx);
      }
      node.c[2] = [await this.imageTargetToDataUri(rawTarget, ctx), node.c[2][1] ?? ''];
      // Pas de retour anticipé : le texte alternatif est lui aussi parcouru, car
      // `![a ![b](cible)](cible)` y imbrique un nœud Image qui doit passer par la
      // même validation.
    }

    if ((node.t === 'RawInline' || node.t === 'RawBlock') && Array.isArray(node.c) && node.c[0] === 'html') {
      const images = await this.extractHtmlImages(String(node.c[1] ?? ''), ctx);
      if (images.length > 0) {
        // Les sorties bureautiques ignorent le HTML brut : les images qu'il
        // contient étaient donc perdues. On les réinjecte comme nœuds Image,
        // validés par la même voie que les images Markdown.
        return node.t === 'RawBlock' ? images.map((image) => ({ t: 'Para', c: [image] })) : images;
      }
      return node;
    }

    for (const key of Object.keys(node)) {
      node[key] = await this.rewriteImageNodes(node[key], ctx);
    }
    return node;
  }

  private async extractHtmlImages(html: string, ctx: AstImageContext): Promise<any[]> {
    const images: any[] = [];
    const regex = new RegExp(HTML_IMAGE_RE.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
      const rawSrc = this.readHtmlAttribute(match[0], 'src');
      if (!rawSrc || !rawSrc.trim()) continue;
      const alt = this.readHtmlAttribute(match[0], 'alt') || '';
      const target = await this.imageTargetToDataUri(rawSrc, ctx);
      images.push({
        t: 'Image',
        c: [['', [], []], alt ? [{ t: 'Str', c: alt }] : [], [target, '']],
      });
    }
    return images;
  }

  private async imageTargetToDataUri(rawTarget: string, ctx: AstImageContext): Promise<string> {
    const cacheKey = String(rawTarget ?? '').trim();
    const cached = ctx.cache.get(cacheKey);
    if (cached) {
      this.accountInlinedImage(cached, ctx);
      return cached;
    }

    // Le résolveur interne passe **avant** la validation d'hôte : une image servie
    // depuis notre stockage n'a ni hôte à autoriser ni requête à émettre, ce qui la
    // rend insensible à APP_URL et à la liste d'hôtes. Tout le reste garde le
    // comportement d'origine, validation comprise (chemin local, data: d'auteur,
    // schéma non HTTP, hôte hors allowlist → BadRequestException).
    const internal = await ctx.opts?.resolveInlineImage?.(cacheKey);
    const dataUri = internal
      ? this.dataUriFromResolvedImage(internal, ctx)
      : await this.fetchImageAsDataUri(this.normalizeAndValidateImageTarget(rawTarget), ctx);

    ctx.cache.set(cacheKey, dataUri);
    this.accountInlinedImage(dataUri, ctx);
    return dataUri;
  }

  private dataUriFromResolvedImage(image: ResolvedExportImage, ctx: AstImageContext): string {
    // Une image lue depuis le stockage consomme la même mémoire qu'une image
    // téléchargée : elle entre donc dans le même budget total.
    ctx.budget.downloadedBytes += image.buffer.length;
    if (ctx.budget.downloadedBytes > MAX_IMAGE_BYTES_TOTAL) {
      throw new BadRequestException('Exported images exceed the size budget');
    }
    return this.toDataUri(image.buffer, this.resolveImageMimeType(image.buffer, image.mimeType || ''));
  }

  private accountInlinedImage(dataUri: string, ctx: AstImageContext): void {
    // Une image répétée est incorporée autant de fois que d'occurrences : le budget
    // porte donc sur les incorporations, pas sur les téléchargements uniques.
    ctx.budget.inlinedBytes += dataUri.length;
    if (ctx.budget.inlinedBytes > MAX_INLINED_IMAGE_BYTES) {
      throw new BadRequestException('Exported images exceed the size budget');
    }
  }

  private readHtmlAttribute(tag: string, attrName: string): string | null {
    const pattern = new RegExp(
      `\\b${attrName}\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))`,
      'i',
    );
    const match = String(tag || '').match(pattern);
    const raw = String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
    if (!raw) return null;
    return raw
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\'')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }

  /**
   * Télécharge une ressource autorisée et l'encode en data: URI. La lecture est
   * bornée pendant le transfert : ni la taille annoncée ni la taille réelle ne
   * peuvent faire dépasser les budgets mémoire du processus.
   */
  private async fetchImageAsDataUri(target: string, ctx: AstImageContext): Promise<string> {
    const candidates = this.buildImageFetchCandidates(target);
    let lastError = '';

    for (const candidate of candidates) {
      let response: Response;
      try {
        const parsed = new URL(candidate);
        this.assertAllowedImageHost(parsed.hostname);
        response = await fetch(candidate, {
          headers: this.imageFetchHeadersFor(candidate, ctx),
          redirect: 'error',
          signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
        });
      } catch (error: any) {
        lastError = String(error?.message || error || 'fetch failed');
        continue;
      }

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        await this.cancelStream(response.body);
        continue;
      }

      const responseContentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (responseContentType && !responseContentType.startsWith('image/') && responseContentType !== 'application/octet-stream' && responseContentType !== 'application/pdf') {
        lastError = `unexpected content-type: ${responseContentType}`;
        await this.cancelStream(response.body);
        continue;
      }

      const remainingTotal = MAX_IMAGE_BYTES_TOTAL - ctx.budget.downloadedBytes;
      const buffer = await this.readImageBody(response, target, remainingTotal);
      if (buffer.length === 0) {
        lastError = 'empty image payload';
        continue;
      }

      ctx.budget.downloadedBytes += buffer.length;
      return this.toDataUri(buffer, this.resolveImageMimeType(buffer, responseContentType));
    }

    const suffix = lastError ? ` (${lastError})` : '';
    throw new BadRequestException(`Unable to fetch image: ${target}${suffix}`);
  }

  /**
   * Le cookie de session n'est transmis qu'aux cibles de notre propre
   * infrastructure (self hosts et boucle locale) : il n'a aucune raison d'aller
   * vers un CDN tiers autorisé. Sans cette restriction, l'export transmettait le
   * cookie du navigateur à tout hôte de la liste autorisée (constat n°3 de l'audit).
   */
  private imageFetchHeadersFor(candidate: string, ctx: AstImageContext): Record<string, string> | undefined {
    const configured = ctx.opts?.imageFetchHeaders;
    if (!configured) return undefined;
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      if (this.selfHostnames.has(host) || LOOPBACK_HOSTS.has(host)) return configured;
    } catch {
      // Candidat illisible : aucun en-tête transmis.
    }
    return undefined;
  }

  private async readImageBody(
    response: Response,
    target: string,
    remainingTotalBytes: number,
  ): Promise<Buffer> {
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES_PER_IMAGE) {
      await this.cancelStream(response.body);
      throw new BadRequestException(`Image too large for export: ${target}`);
    }
    if (remainingTotalBytes <= 0) {
      await this.cancelStream(response.body);
      throw new BadRequestException('Exported images exceed the size budget');
    }

    const body = response.body as any;
    // Attention : appeler `body.getReader()` ici verrouillerait le flux avant de le
    // confier au lecteur partagé. On se contente donc de vérifier sa présence.
    if (!body || typeof body.getReader !== 'function') {
      // Corps non diffusé (réponse vide) : le contrôle a posteriori reste appliqué.
      const fallback = Buffer.from(await response.arrayBuffer());
      this.assertImageBytesWithinCaps(fallback.length, remainingTotalBytes, target);
      return fallback;
    }

    try {
      // Lecture bornée partagée avec les flux du stockage objet : le compteur est
      // incrémenté à chaque morceau et l'annulation passe par le lecteur (`body`
      // étant verrouillé, `body.cancel()` laisserait la connexion ouverte).
      return await readStreamWithCaps(
        { web: body },
        { maxBytes: MAX_IMAGE_BYTES_PER_IMAGE, remainingTotalBytes },
      );
    } catch (error) {
      if (error instanceof StreamLimitError) {
        throw new BadRequestException(
          error.failure === 'per-resource'
            ? `Image too large for export: ${target}`
            : 'Exported images exceed the size budget',
        );
      }
      throw error;
    }
  }

  private assertImageBytesWithinCaps(total: number, remainingTotalBytes: number, target: string): void {
    if (total > MAX_IMAGE_BYTES_PER_IMAGE) {
      throw new BadRequestException(`Image too large for export: ${target}`);
    }
    if (total > remainingTotalBytes) {
      throw new BadRequestException('Exported images exceed the size budget');
    }
  }

  /**
   * Annule un transfert abandonné pour ne pas laisser une connexion ouverte :
   * budget dépassé, type refusé, erreur de lecture. Accepte un `ReadableStream`
   * ou le lecteur qui le verrouille — dans ce second cas, seul `reader.cancel()`
   * atteint réellement la source.
   */
  private async cancelStream(source: { cancel?: () => Promise<void> } | null | undefined): Promise<void> {
    try {
      await source?.cancel?.();
    } catch {
      // Flux déjà consommé, annulé ou verrouillé : rien à faire de plus.
    }
  }

  private toDataUri(buffer: Buffer, mimeType: string): string {
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }

  private resolveImageMimeType(buffer: Buffer, declaredContentType: string): string {
    // Le type réel prime : Pandoc et Typst doivent pouvoir décoder la ressource
    // même si le serveur annonce application/octet-stream ou un type erroné.
    const sniffed = this.sniffImageMimeType(buffer);
    if (sniffed) return sniffed;
    return declaredContentType || 'application/octet-stream';
  }

  private sniffImageMimeType(buffer: Buffer): string | null {
    const startsWith = (bytes: number[], offset = 0) =>
      buffer.length >= offset + bytes.length &&
      bytes.every((byte, index) => buffer[offset + index] === byte);

    if (startsWith([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
    if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
    if (startsWith([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
    if (startsWith([0x42, 0x4d])) return 'image/bmp';
    if (
      startsWith([0x52, 0x49, 0x46, 0x46]) &&
      buffer.length >= 12 &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
    if (startsWith([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';

    const head = buffer.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
      return 'image/svg+xml';
    }

    return null;
  }

  private buildImageFetchCandidates(target: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const add = (value: string) => {
      const trimmed = String(value || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      candidates.push(trimmed);
    };

    const parsed = new URL(target);
    const hasApiPrefix = parsed.pathname.startsWith('/api/');
    const backendPort = String(process.env.PORT || '8080').trim() || '8080';
    const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());

    add(parsed.toString());

    if (hasApiPrefix) {
      const stripped = new URL(parsed.toString());
      stripped.pathname = stripped.pathname.replace(/^\/api/, '') || '/';
      add(stripped.toString());
    }

    if (isLoopback && parsed.port !== backendPort) {
      const backendDirect = new URL(parsed.toString());
      backendDirect.port = backendPort;
      add(backendDirect.toString());

      if (hasApiPrefix) {
        const backendStripped = new URL(backendDirect.toString());
        backendStripped.pathname = backendStripped.pathname.replace(/^\/api/, '') || '/';
        add(backendStripped.toString());
      }
    }

    const isSelfHost = this.selfHostnames.has(parsed.hostname.toLowerCase());
    if (isSelfHost && !isLoopback) {
      const backendDirect = new URL(parsed.toString());
      backendDirect.protocol = 'http:';
      backendDirect.hostname = '127.0.0.1';
      backendDirect.port = backendPort;
      add(backendDirect.toString());

      if (hasApiPrefix) {
        const backendStripped = new URL(backendDirect.toString());
        backendStripped.pathname = backendStripped.pathname.replace(/^\/api/, '') || '/';
        add(backendStripped.toString());
      }
    }

    return candidates;
  }

  private async normalizeOdtImageFrames(odtPath: string): Promise<void> {
    const archive = openBoundedArchive(odtPath);
    const zip = archive.zip;
    const entry = zip.getEntry('content.xml');
    if (!entry) return;

    const originalXml: string = archive.readText(entry);
    let changed = false;
    const updatedXml = originalXml.replace(/<draw:frame\b[^>]*>/gi, (tag) => {
      const widthMatch = tag.match(/\bsvg:width="([^"]+)"/i);
      if (!widthMatch) return tag;

      const widthCm = this.odtSizeToCm(widthMatch[1]);
      if (!widthCm || widthCm <= ODT_MAX_IMAGE_WIDTH_CM) return tag;

      const ratio = ODT_MAX_IMAGE_WIDTH_CM / widthCm;
      let updatedTag = tag.replace(
        /\bsvg:width="[^"]+"/i,
        `svg:width="${this.cmToOdtSize(ODT_MAX_IMAGE_WIDTH_CM)}"`,
      );

      const heightMatch = updatedTag.match(/\bsvg:height="([^"]+)"/i);
      if (heightMatch) {
        const heightCm = this.odtSizeToCm(heightMatch[1]);
        if (heightCm) {
          updatedTag = updatedTag.replace(
            /\bsvg:height="[^"]+"/i,
            `svg:height="${this.cmToOdtSize(heightCm * ratio)}"`,
          );
        }
      }

      if (updatedTag !== tag) changed = true;
      return updatedTag;
    });

    if (!changed) return;
    zip.updateFile('content.xml', Buffer.from(updatedXml, 'utf8'));
    zip.writeZip(odtPath);
  }

  private odtSizeToCm(value: string): number | null {
    const match = String(value || '').trim().match(ODT_SIZE_RE);
    if (!match) return null;
    const size = Number(match[1]);
    if (!Number.isFinite(size) || size <= 0) return null;
    const unit = String(match[2] || '').toLowerCase();
    switch (unit) {
      case 'cm':
        return size;
      case 'mm':
        return size / 10;
      case 'in':
        return size * 2.54;
      case 'pt':
        return size * (2.54 / 72);
      case 'px':
        return size * (2.54 / 96);
      default:
        return null;
    }
  }

  private cmToOdtSize(cm: number): string {
    const normalized = Math.max(0.01, Math.round(cm * 100) / 100);
    const text = Number.isInteger(normalized)
      ? normalized.toFixed(0)
      : normalized.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${text}cm`;
  }

  private normalizeAndValidateImageTarget(rawTarget: string): string {
    const target = String(rawTarget || '').trim();
    if (!target) {
      throw new BadRequestException('Image URL cannot be empty');
    }

    // Les data: URI sont produits par le service après validation, jamais acceptés
    // en entrée : c'est ce qui garantit qu'une cible fournie par l'auteur passe
    // toujours par la liste d'hôtes autorisés.
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(target)) {
      throw new BadRequestException('Inline base64 images are not supported. Upload image attachments first.');
    }
    if (/^data:/i.test(target)) {
      throw new BadRequestException('Unsupported image URI scheme');
    }

    if (/^\/\//.test(target)) {
      const parsed = new URL(`https:${target}`);
      this.assertAllowedImageHost(parsed.hostname);
      return parsed.toString();
    }

    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      const parsed = new URL(target);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new BadRequestException('Unsupported image URI scheme');
      }
      this.assertAllowedImageHost(parsed.hostname);
      return parsed.toString();
    }

    if (target.startsWith('/')) {
      if (!this.mediaBaseUrl) {
        throw new BadRequestException('Relative image URLs require EXPORT_MEDIA_BASE_URL or APP_BASE_URL');
      }
      const parsed = new URL(target, this.mediaBaseUrl);
      this.assertAllowedImageHost(parsed.hostname);
      return parsed.toString();
    }

    throw new BadRequestException('Only absolute HTTP(S) or root-relative image URLs are allowed');
  }

  private resolveMediaBaseUrl(): string | null {
    const candidates = [
      process.env.EXPORT_MEDIA_BASE_URL,
      process.env.APP_URL,
      process.env.APP_BASE_URL,
      process.env.PUBLIC_APP_URL,
    ];
    for (const candidate of candidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      try {
        return new URL(raw).origin;
      } catch {
        // ignore malformed entries
      }
    }
    return null;
  }

  private buildSelfHostnames(): Set<string> {
    const hosts = new Set<string>();
    for (const candidate of [
      process.env.EXPORT_MEDIA_BASE_URL,
      process.env.APP_URL,
      process.env.APP_BASE_URL,
      process.env.PUBLIC_APP_URL,
    ]) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      try {
        hosts.add(new URL(raw).hostname.toLowerCase());
      } catch {
        // ignore malformed entries
      }
    }
    return hosts;
  }

  private buildAllowedImageHostPatterns(): string[] {
    const patterns = new Set<string>();
    const rawList = String(process.env.EXPORT_ALLOWED_IMAGE_HOSTS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const entry of rawList) {
      patterns.add(this.normalizeHostPattern(entry));
    }

    const urlCandidates = [
      process.env.EXPORT_MEDIA_BASE_URL,
      process.env.APP_URL,
      process.env.APP_BASE_URL,
      process.env.PUBLIC_APP_URL,
    ];
    for (const candidate of urlCandidates) {
      const raw = String(candidate || '').trim();
      if (!raw) continue;
      try {
        patterns.add(new URL(raw).hostname.toLowerCase());
      } catch {
        // ignore malformed entries
      }
    }

    if (this.allowLoopbackImageHosts()) {
      for (const host of LOOPBACK_HOSTS) {
        patterns.add(host);
      }
    }

    return [...patterns];
  }

  private allowLoopbackImageHosts(): boolean {
    const raw = process.env.EXPORT_ALLOW_LOOPBACK_IMAGE_HOSTS;
    if (raw !== undefined) return parseBoolean(raw);
    return isDevelopmentEnv();
  }

  private normalizeHostPattern(pattern: string): string {
    const value = String(pattern || '').trim().toLowerCase();
    if (!value) return '';
    if (value.includes('://')) {
      try {
        return new URL(value).hostname.toLowerCase();
      } catch {
        return value;
      }
    }
    return value;
  }

  private assertAllowedImageHost(hostname: string): void {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) {
      throw new BadRequestException('Invalid image host');
    }

    const allowed = this.allowedImageHostPatterns.some((pattern) => {
      if (!pattern) return false;
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1).toLowerCase(); // ".example.com"
        return host.endsWith(suffix) && host.length > suffix.length;
      }
      return host === pattern;
    });

    if (!allowed) {
      throw new BadRequestException(`Image host is not allowed: ${host}`);
    }
  }

  private sanitizeFilename(value: string): string {
    const cleaned = String(value || DEFAULT_FILENAME)
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+/, '')
      .replace(/_+$/, '');
    return cleaned || DEFAULT_FILENAME;
  }
}

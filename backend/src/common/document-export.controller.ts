import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InlineImageResolverService } from '../knowledge/inline-image-resolver.service';
import { Tenant, TenantRequest } from './decorators/tenant.decorator';
import { contentDisposition } from './content-disposition';
import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMITS } from './rate-limit';
import { ExportDto } from './dto/export.dto';
import { DocumentExportService, ExportImageFetchOptions } from './document-export.service';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from './request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('export')
export class DocumentExportController {
  constructor(
    private readonly documentExportService: DocumentExportService,
    private readonly inlineImages: InlineImageResolverService,
  ) {}

  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post()
  @UseGuards(RateLimitGuard)
  @Throttle({ default: RATE_LIMITS.documentExport })
  async exportDocument(
    @Body() body: ExportDto,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const result = await this.documentExportService.exportMarkdown(
      body.content,
      body.format,
      body.title,
      this.exportOptions(ctx, req),
    );

    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.send(result.buffer);
  }

  /**
   * Le markdown vient de l'éditeur : les images de l'application qu'il référence
   * sont résolues depuis notre stockage avec l'identité de l'appelant (JWT), donc
   * sans dépendre du cookie de session ni du nom d'hôte inscrit dans l'URL — deux
   * causes du 404 observé sur les images inline. Le cookie reste transmis pour les
   * cibles internes non reconnues : le comportement d'origine est préservé.
   */
  private exportOptions(ctx: TenantRequest, req: any): ExportImageFetchOptions | undefined {
    const options: ExportImageFetchOptions = {};
    const cookie = req?.headers?.cookie as string | undefined;
    if (cookie) {
      options.imageFetchHeaders = { Cookie: cookie };
    }
    const resolveInlineImage = this.inlineImages.exporter(ctx);
    if (resolveInlineImage) {
      options.resolveInlineImage = resolveInlineImage;
    }
    return Object.keys(options).length > 0 ? options : undefined;
  }
}

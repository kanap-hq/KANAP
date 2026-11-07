import { BadRequestException, Controller, Get, NotFoundException, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { completeExport } from '../../audit/export-events.interceptor';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { contentDisposition } from '../../common/content-disposition';
import { Tenant, TenantRequest } from '../../common/decorators';
import { XLSX_CONTENT_TYPE } from '../../common/xlsx/write';
import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { AiPolicyService } from '../ai-policy.service';
import { personWriteLanguage } from '../ai-write-texts';
import type { AiExecutionContextWithManager } from '../ai.types';
import { AiImportMappingService, PrepareImportMappingInput } from './ai-import-mapping.service';

/** `inventaire.csv` → `inventaire-import.xlsx`. */
export function preparedFileName(filename: unknown): string {
  const base = String(filename ?? '').trim().replace(/\.[^.]+$/, '') || 'import';
  return `${base}-import.xlsx`;
}

/**
 * The file Plaid prepared for an import (lot I3), downloaded from the import card: the person's
 * spreadsheet in the import's format, rebuilt from the attachment and the card's mapping, never
 * stored. Unlike the other conversation routes, it runs in the request's tenant transaction, so
 * ExportEventsInterceptor records each download in the audit log, as any export.
 */
@Controller('ai/conversations')
@UseGuards(JwtAuthGuard)
export class AiImportFileController {
  constructor(
    private readonly policy: AiPolicyService,
    private readonly previews: AiMutationPreviewService,
    private readonly mapping: AiImportMappingService,
  ) {}

  @Get(':id/previews/:previewId/import-file/export')
  async download(
    @Param('id') id: string,
    @Param('previewId') previewId: string,
    @Req() req: any,
    @Tenant() tenant: TenantRequest,
    @Res() res: Response,
  ): Promise<void> {
    if (!tenant.manager) throw new BadRequestException('The prepared file needs a tenant.');
    const context: AiExecutionContextWithManager = {
      tenantId: tenant.tenantId,
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      conversationId: id,
      requestId: req?.id ?? null,
      aiApiKeyId: null,
      manager: tenant.manager,
    };
    await this.policy.assertSurfaceAccess(context, context.manager);
    const preview = await this.previews.getPreviewForUser(context, previewId);
    if (preview.tool_name !== 'prepare_import_mapping' || preview.conversation_id !== id) {
      throw new NotFoundException('AI preview not found.');
    }
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId);
    const file = await this.mapping.preparedFile(context, preview.mutation_input as unknown as PrepareImportMappingInput, language);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', contentDisposition(preparedFileName(preview.mutation_input?.filename)));
    res.setHeader('Content-Length', String(file.content.length));
    await completeExport(res, { rows: file.rows });
    res.end(file.content);
  }
}

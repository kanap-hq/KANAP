import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { completeExport } from '../../audit/export-events.interceptor';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { contentDisposition } from '../../common/content-disposition';
import { Tenant, TenantRequest } from '../../common/decorators';
import { XLSX_CONTENT_TYPE } from '../../common/xlsx/write';
import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { AiPolicyService } from '../ai-policy.service';
import { personWriteLanguage, screenLanguageOf } from '../ai-write-texts';
import type { AiExecutionContextWithManager } from '../ai.types';
import type { AiMutationPreviewDto } from '../ai.types';
import { AI_BULK_EDIT_TOOLS, parseBulkExclusions } from '../mutation/ai-bulk-edit';
import { AiImportMappingService, aiImportTarget, PrepareImportMappingInput } from './ai-import-mapping.service';
import { parseImportChoices } from './ai-import-targets';

/** `inventaire.csv` → `inventaire-import.xlsx`. */
export function preparedFileName(filename: unknown): string {
  const base = String(filename ?? '').trim().replace(/\.[^.]+$/, '') || 'import';
  return `${base}-import.xlsx`;
}

/**
 * The routes of a card the person acts on before approving it, in the request's tenant transaction
 * (the person's data access applied by the tenant interceptor). The file Plaid prepared for an
 * import (lot I3), downloaded from the import card: the person's spreadsheet in the import's format,
 * rebuilt from the attachment and the card's mapping, never stored; unlike the other conversation
 * routes, ExportEventsInterceptor records each download in the audit log, as any export. The
 * choices on an import card, and the records left out of a change in bulk (lot K2e of 26.12.1).
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
    const context = this.context(id, req, tenant);
    await this.policy.assertSurfaceAccess(context, context.manager);
    const preview = await this.previews.getPreviewForUser(context, previewId);
    if (preview.tool_name !== 'prepare_import_mapping' || preview.conversation_id !== id) {
      throw new NotFoundException('AI preview not found.');
    }
    const language = await personWriteLanguage(context.manager, context.tenantId, context.userId, context.screenLanguage);
    const file = await this.mapping.preparedFile(context, preview.mutation_input as unknown as PrepareImportMappingInput, language);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', contentDisposition(preparedFileName(preview.mutation_input?.filename)));
    res.setHeader('Content-Length', String(file.content.length));
    await completeExport(res, { rows: file.rows });
    res.end(file.content);
  }

  /**
   * The person's choices on an import card (lot I1 of 26.11.9): `{ choices: [...] }`, the whole list
   * (matches undone, and for a budget file `create_suppliers` and the rows that look like a stored
   * line; another import takes matches undone only, lot I3). Answers the new card, which replaces this one;
   * the same checks as the download, the frozen workspace included (`assertSurfaceAccess`), and the
   * rights of the import.
   */
  @Post(':id/previews/:previewId/import-choices')
  @HttpCode(200)
  async choose(
    @Param('id') id: string,
    @Param('previewId') previewId: string,
    @Body() body: unknown,
    @Req() req: any,
    @Tenant() tenant: TenantRequest,
  ): Promise<AiMutationPreviewDto> {
    const context = this.context(id, req, tenant);
    await this.policy.assertSurfaceAccess(context, context.manager);
    const preview = await this.previews.getPreviewForUser(context, previewId);
    if (preview.tool_name !== 'prepare_import_mapping' || preview.conversation_id !== id) {
      throw new NotFoundException('AI preview not found.');
    }
    const target = aiImportTarget(preview.mutation_input?.entity_type);
    // The choices the card of this import takes: a budget file's, or another import's matches undone.
    let choices: unknown[];
    try {
      choices = parseImportChoices(target.key, (body as { choices?: unknown } | null)?.choices ?? []);
    } catch {
      throw new BadRequestException('The choices are not valid.');
    }
    await this.mapping.assertImportRights(context, target);
    return this.previews.replaceImportChoices(context, previewId, choices);
  }

  /**
   * The records the person leaves out of a card of a change in bulk (lot K2e of 26.12.1):
   * `{ excluded: [ids] }`, the whole list of the ids left out (at most 200, each one listed by the
   * card), an empty list to keep them all. Answers the new card, recounted, which replaces this one;
   * the same checks as the import choices: the frozen workspace (`assertSurfaceAccess`), the card of
   * the person and of this conversation, pending, and the rights of the write. Another budget
   * operation running answers 409 `operation_running` and leaves the card as it was.
   */
  @Post(':id/previews/:previewId/bulk-exclusions')
  @HttpCode(200)
  async exclude(
    @Param('id') id: string,
    @Param('previewId') previewId: string,
    @Body() body: unknown,
    @Req() req: any,
    @Tenant() tenant: TenantRequest,
  ): Promise<AiMutationPreviewDto> {
    const context = this.context(id, req, tenant);
    await this.policy.assertSurfaceAccess(context, context.manager);
    const preview = await this.previews.getPreviewForUser(context, previewId);
    if (!AI_BULK_EDIT_TOOLS.has(preview.tool_name) || preview.conversation_id !== id) {
      throw new NotFoundException('AI preview not found.');
    }
    const excluded = parseBulkExclusions((body as { excluded?: unknown } | null)?.excluded);
    return this.previews.replaceBulkExclusions(context, previewId, excluded);
  }

  private context(id: string, req: any, tenant: TenantRequest): AiExecutionContextWithManager {
    if (!tenant.manager) throw new BadRequestException('This route needs a tenant.');
    return {
      tenantId: tenant.tenantId,
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      conversationId: id,
      requestId: req?.id ?? null,
      aiApiKeyId: null,
      screenLanguage: screenLanguageOf(req?.headers?.['accept-language']),
      manager: tenant.manager,
    };
  }
}

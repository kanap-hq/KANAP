import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { KnowledgeService } from './knowledge.service';

@UseGuards(JwtAuthGuard)
@Controller('knowledge-folders')
export class DocumentFoldersController {
  constructor(private readonly docs: KnowledgeService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('tree')
  tree(@Query('library_id') libraryId: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.docs.listFolderTree({ manager: ctx.manager, libraryId: libraryId || undefined, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post()
  create(@Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.createFolder(body, ctx.userId || null, { manager: ctx.manager });
  }

  /** The check before a folder's delete: the folders of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Tenant() ctx: TenantRequest) {
    return this.docs.folderDeleteCheck(Array.isArray(body?.ids) ? body.ids : [], { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.updateFolder(id, body, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Delete(':id')
  remove(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.docs.deleteFolder(id, { manager: ctx.manager, userId: ctx.userId || null });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'member')
  @Post(':id/move')
  move(@Param('id') id: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    return this.docs.moveFolder(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get(':id/knowledge')
  listDocuments(@Param('id') id: string, @Query() query: any, @Tenant() ctx: TenantRequest) {
    return this.docs.listFolderDocuments(id, query, { manager: ctx.manager, userId: ctx.userId || null });
  }
}

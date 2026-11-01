import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { businessContributorNoAccess } from '../auth/module-right-required';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { InterfaceBindingsService } from './interface-bindings.service';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';

@UseGuards(JwtAuthGuard)
@Controller()
export class InterfaceBindingsController {
  constructor(private readonly svc: InterfaceBindingsService) {}

  private async assertUnrestrictedApplicationReader(req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    if (accessScope) {
      throw businessContributorNoAccess('interface_bindings', 'Business Contributor cannot access interface bindings');
    }
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('interfaces/:interfaceId/bindings')
  async list(@Param('interfaceId') interfaceId: string, @Req() req: any) {
    await this.assertUnrestrictedApplicationReader(req);
    return this.svc.list(interfaceId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('interfaces/:interfaceId/bindings')
  create(@Param('interfaceId') interfaceId: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.create(interfaceId, body, tenantId ?? '', req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('interface-bindings/:bindingId')
  update(@Param('bindingId') bindingId: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.update(bindingId, body, tenantId ?? '', req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('interface-bindings/:bindingId')
  delete(@Param('bindingId') bindingId: string, @Req() req: any) {
    return this.svc.delete(bindingId, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('interface-bindings/:bindingId/connection-links')
  async listConnectionLinks(@Param('bindingId') bindingId: string, @Req() req: any) {
    await this.assertUnrestrictedApplicationReader(req);
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.listConnectionLinks(bindingId, tenantId ?? '', { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('interface-bindings/:bindingId/connection-links')
  createConnectionLink(@Param('bindingId') bindingId: string, @Body() body: any, @Req() req: any) {
    const tenantId: string | undefined = req?.tenant?.id;
    return this.svc.createConnectionLink(
      bindingId,
      body,
      tenantId ?? '',
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('interface-bindings/:bindingId/connection-links/:linkId')
  deleteConnectionLink(
    @Param('bindingId') bindingId: string,
    @Param('linkId') linkId: string,
    @Req() req: any,
  ) {
    return this.svc.deleteConnectionLink(bindingId, linkId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }
}

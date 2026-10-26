import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { AppInstancesService } from './app-instances.service';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';

@UseGuards(JwtAuthGuard)
@Controller()
export class AppInstancesController {
  constructor(private readonly svc: AppInstancesService) {}

  /** The request's manager and tenant: every query of the service names the tenant. */
  private opts(req: any) {
    return { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id ?? null };
  }

  private async listForApplication(applicationId: string, req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.list(applicationId, { ...this.opts(req), accessScope });
  }

  private createForApplication(applicationId: string, body: any, req: any) {
    return this.svc.create(applicationId, body, req.user?.sub ?? null, this.opts(req));
  }

  private updateDeployment(instanceId: string, body: any, req: any) {
    return this.svc.update(instanceId, body, req.user?.sub ?? null, this.opts(req));
  }

  private deleteDeployment(instanceId: string, req: any) {
    return this.svc.delete(instanceId, req.user?.sub ?? null, this.opts(req));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('applications/:applicationId/deployments')
  listDeployments(@Param('applicationId') applicationId: string, @Req() req: any) {
    return this.listForApplication(applicationId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('applications/:applicationId/instances')
  listInstancesCompatibility(@Param('applicationId') applicationId: string, @Req() req: any) {
    return this.listForApplication(applicationId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('applications/:applicationId/deployments')
  createDeployment(@Param('applicationId') applicationId: string, @Body() body: any, @Req() req: any) {
    return this.createForApplication(applicationId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('applications/:applicationId/instances')
  createInstanceCompatibility(@Param('applicationId') applicationId: string, @Body() body: any, @Req() req: any) {
    return this.createForApplication(applicationId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-deployments/:instanceId')
  updateDeploymentRoute(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.updateDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-instances/:instanceId')
  updateInstanceCompatibility(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.updateDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-deployments/:instanceId')
  deleteDeploymentRoute(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.deleteDeployment(instanceId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-instances/:instanceId')
  deleteInstanceCompatibility(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.deleteDeployment(instanceId, req);
  }
}

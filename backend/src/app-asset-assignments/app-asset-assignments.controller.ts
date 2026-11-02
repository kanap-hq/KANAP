import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { moduleRightRequired } from '../auth/module-right-required';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { AppAssetAssignmentsService } from './app-asset-assignments.service';
import { resolveBusinessContributorScope } from '../auth/business-contributor-scope';
import { hasLevel } from '../common/relations/relations-access';

@UseGuards(JwtAuthGuard)
@Controller()
export class AppAssetAssignmentsController {
  constructor(private readonly svc: AppAssetAssignmentsService) {}

  /** The request's manager and tenant: every query of the service names the tenant. */
  private opts(req: any) {
    return { manager: req?.queryRunner?.manager, tenantId: req?.tenant?.id ?? null };
  }

  private async listForDeployment(instanceId: string, req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.list(instanceId, { ...this.opts(req), accessScope });
  }

  /**
   * A server assignment changes the application and the server: the routes require
   * `applications:member` (guard), and this the same level on the infrastructure, as the screen does.
   */
  private assertInfrastructureMember(req: any): void {
    if (!hasLevel(req ?? {}, 'infrastructure', 'member')) {
      throw moduleRightRequired('infrastructure', 'member', 'Changing the servers of a deployment needs the member level on the infrastructure.');
    }
  }

  private createForDeployment(instanceId: string, body: any, req: any) {
    this.assertInfrastructureMember(req);
    return this.svc.create(instanceId, body, req.user?.sub ?? null, this.opts(req));
  }

  private updateForDeployment(instanceId: string, assignmentId: string, body: any, req: any) {
    this.assertInfrastructureMember(req);
    return this.svc.update(instanceId, assignmentId, body, req.user?.sub ?? null, this.opts(req));
  }

  private deleteForDeployment(instanceId: string, assignmentId: string, req: any) {
    this.assertInfrastructureMember(req);
    return this.svc.delete(instanceId, assignmentId, req.user?.sub ?? null, this.opts(req));
  }

  /** The servers of all the deployments of an application, in one call (the Deployments tab). */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('applications/:applicationId/deployment-servers')
  async listApplicationDeploymentServers(@Param('applicationId') applicationId: string, @Req() req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listByApplication(applicationId, { ...this.opts(req), accessScope });
  }

  // New asset-based endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('app-deployments/:instanceId/assets')
  listDeploymentAssets(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.listForDeployment(instanceId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('app-instances/:instanceId/assets')
  listInstanceAssetsCompatibility(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.listForDeployment(instanceId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('app-deployments/:instanceId/assets')
  createDeploymentAsset(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.createForDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('app-instances/:instanceId/assets')
  createInstanceAssetCompatibility(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.createForDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-deployments/:instanceId/assets/:assignmentId')
  updateDeploymentAsset(
    @Param('instanceId') instanceId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.updateForDeployment(instanceId, assignmentId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-instances/:instanceId/assets/:assignmentId')
  updateInstanceAssetCompatibility(
    @Param('instanceId') instanceId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.updateForDeployment(instanceId, assignmentId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-deployments/:instanceId/assets/:assignmentId')
  deleteDeploymentAsset(@Param('instanceId') instanceId: string, @Param('assignmentId') assignmentId: string, @Req() req: any) {
    return this.deleteForDeployment(instanceId, assignmentId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-instances/:instanceId/assets/:assignmentId')
  deleteInstanceAssetCompatibility(@Param('instanceId') instanceId: string, @Param('assignmentId') assignmentId: string, @Req() req: any) {
    return this.deleteForDeployment(instanceId, assignmentId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('assets/:assetId/assignments/groupable')
  async listGroupableByAsset(@Param('assetId') assetId: string, @Req() req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listGroupableByAsset(assetId, { ...this.opts(req), accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('assets/:assetId/assignments')
  async listByAsset(@Param('assetId') assetId: string, @Req() req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listByAsset(assetId, { ...this.opts(req), accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Post('app-asset-assignments/assets-by-apps')
  async listAssetsByApps(@Body() body: { applicationIds: string[]; environments: string[] }, @Req() req: any) {
    const applicationIds = Array.isArray(body?.applicationIds) ? body.applicationIds : [];
    const environments = Array.isArray(body?.environments) ? body.environments : [];
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listAssetsByApps(applicationIds, environments, { manager: req?.queryRunner?.manager, accessScope });
  }

  // Backwards compatibility endpoints (servers → assets)
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('app-deployments/:instanceId/servers')
  listDeploymentServers(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.listForDeployment(instanceId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('app-instances/:instanceId/servers')
  listInstanceServersCompatibility(@Param('instanceId') instanceId: string, @Req() req: any) {
    return this.listForDeployment(instanceId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('app-deployments/:instanceId/servers')
  createDeploymentServer(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.createForDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('app-instances/:instanceId/servers')
  createInstanceServerCompatibility(@Param('instanceId') instanceId: string, @Body() body: any, @Req() req: any) {
    return this.createForDeployment(instanceId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-deployments/:instanceId/servers/:assignmentId')
  updateDeploymentServer(
    @Param('instanceId') instanceId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.updateForDeployment(instanceId, assignmentId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('app-instances/:instanceId/servers/:assignmentId')
  updateInstanceServerCompatibility(
    @Param('instanceId') instanceId: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    return this.updateForDeployment(instanceId, assignmentId, body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-deployments/:instanceId/servers/:assignmentId')
  deleteDeploymentServer(@Param('instanceId') instanceId: string, @Param('assignmentId') assignmentId: string, @Req() req: any) {
    return this.deleteForDeployment(instanceId, assignmentId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('app-instances/:instanceId/servers/:assignmentId')
  deleteInstanceServerCompatibility(@Param('instanceId') instanceId: string, @Param('assignmentId') assignmentId: string, @Req() req: any) {
    return this.deleteForDeployment(instanceId, assignmentId, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('servers/:serverId/assignments')
  async listByServerLegacy(@Param('serverId') serverId: string, @Req() req: any) {
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listByAsset(serverId, { ...this.opts(req), accessScope });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Post('app-server-assignments/servers-by-apps')
  async listServersByAppsLegacy(@Body() body: { applicationIds: string[]; environments: string[] }, @Req() req: any) {
    const applicationIds = Array.isArray(body?.applicationIds) ? body.applicationIds : [];
    const environments = Array.isArray(body?.environments) ? body.environments : [];
    const accessScope = await resolveBusinessContributorScope(req, 'applications', 'reader');
    return this.svc.listAssetsByApps(applicationIds, environments, { manager: req?.queryRunner?.manager, accessScope });
  }
}

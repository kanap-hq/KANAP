import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { requestContextMissing, businessContributorNoAccess } from '../auth/module-right-required';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { InterfaceMappingsService } from './services/interface-mappings.service';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';

@UseGuards(JwtAuthGuard)
@Controller('interfaces')
export class InterfaceMappingsController {
  constructor(private readonly mappings: InterfaceMappingsService) {}

  private async assertUnrestrictedApplicationReader(ctx: TenantRequest) {
    if (!ctx.manager) {
      throw requestContextMissing('Access scope could not be resolved');
    }
    const accessScope = await resolveBusinessContributorScopeForUser({
      manager: ctx.manager,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
    }, 'applications', 'reader');
    if (accessScope) {
      throw businessContributorNoAccess('interface_mappings', 'Business Contributor cannot access interface mappings');
    }
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get(':id/mapping-sets')
  async listSets(
    @Param('id') id: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.listSets(id, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post(':id/mapping-sets')
  createSet(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string | null; is_default?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.createSet(id, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('mapping-sets/:mappingSetId')
  async getSet(
    @Param('mappingSetId') mappingSetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.getSet(mappingSetId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('mapping-sets/:mappingSetId')
  updateSet(
    @Param('mappingSetId') mappingSetId: string,
    @Body() body: { name?: string; description?: string | null; is_default?: boolean },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.updateSet(mappingSetId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('mapping-sets/:mappingSetId')
  deleteSet(
    @Param('mappingSetId') mappingSetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.deleteSet(mappingSetId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('mapping-sets/:mappingSetId/groups')
  async listGroups(
    @Param('mappingSetId') mappingSetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.listGroups(mappingSetId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('mapping-sets/:mappingSetId/groups')
  createGroup(
    @Param('mappingSetId') mappingSetId: string,
    @Body() body: { title?: string; description?: string | null; order_index?: number },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.createGroup(mappingSetId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('mapping-groups/:groupId')
  async getGroup(
    @Param('groupId') groupId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.getGroup(groupId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('mapping-groups/:groupId')
  updateGroup(
    @Param('groupId') groupId: string,
    @Body() body: { title?: string; description?: string | null; order_index?: number },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.updateGroup(groupId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('mapping-groups/:groupId')
  deleteGroup(
    @Param('groupId') groupId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.deleteGroup(groupId, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('mapping-sets/:mappingSetId/rules')
  async listRules(
    @Param('mappingSetId') mappingSetId: string,
    @Query('group_id') groupId: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.listRules(mappingSetId, groupId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Post('mapping-sets/:mappingSetId/rules')
  createRule(
    @Param('mappingSetId') mappingSetId: string,
    @Body()
    body: {
      group_id?: string | null;
      rule_key?: string | null;
      title?: string;
      order_index?: number;
      applies_to_leg_id?: string | null;
      operation_kind?: string | null;
      lifecycle?: string | null;
      environment_scope?: string[] | string | null;
      source_bindings?: Array<Record<string, unknown>>;
      target_bindings?: Array<Record<string, unknown>>;
      condition_text?: string | null;
      business_rule_text?: string | null;
      middleware_rule_text?: string | null;
      remarks?: string | null;
      example_input?: string | null;
      example_output?: string | null;
      implementation_status?: string | null;
      test_status?: string | null;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.createRule(mappingSetId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'reader')
  @Get('mapping-rules/:ruleId')
  async getRule(
    @Param('ruleId') ruleId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    await this.assertUnrestrictedApplicationReader(ctx);
    return this.mappings.getRule(ruleId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Patch('mapping-rules/:ruleId')
  updateRule(
    @Param('ruleId') ruleId: string,
    @Body()
    body: {
      group_id?: string | null;
      rule_key?: string | null;
      title?: string;
      order_index?: number;
      applies_to_leg_id?: string | null;
      operation_kind?: string | null;
      lifecycle?: string | null;
      environment_scope?: string[] | string | null;
      source_bindings?: Array<Record<string, unknown>>;
      target_bindings?: Array<Record<string, unknown>>;
      condition_text?: string | null;
      business_rule_text?: string | null;
      middleware_rule_text?: string | null;
      remarks?: string | null;
      example_input?: string | null;
      example_output?: string | null;
      implementation_status?: string | null;
      test_status?: string | null;
    },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.updateRule(ruleId, body, ctx.userId || null, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'member')
  @Delete('mapping-rules/:ruleId')
  deleteRule(
    @Param('ruleId') ruleId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.mappings.deleteRule(ruleId, ctx.userId || null, { manager: ctx.manager });
  }
}

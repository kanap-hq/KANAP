import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { OnboardingService, OnboardingState } from './onboarding.service';

/**
 * The onboarding of a workspace (`doc/onboarding.md`): every signed-in user of the tenant, no
 * module level (like the personal dashboard settings). The request transaction carries the
 * tenant; every route answers 200 with the state after the operation, for the calling user.
 */
@UseGuards(JwtAuthGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  get(@Tenant() ctx: TenantRequest): Promise<OnboardingState> {
    return this.onboarding.getState(ctx.manager!, ctx.tenantId, ctx.userId);
  }

  /**
   * `{ angle?, mode? }`: at least one; a field left out keeps its value. A new mode acts on the
   * sample data (OnboardingService.applyMode); a load gets the request's Host header
   * (`req.headers.host`, as the sample data routes).
   */
  @Put('choice')
  choose(@Tenant() ctx: TenantRequest, @Body() body: unknown, @Req() req: any): Promise<OnboardingState> {
    return this.onboarding.setChoice(ctx.manager!, ctx.tenantId, ctx.userId, body, { host: String(req?.headers?.host ?? '') });
  }

  @Post('steps/:key/done')
  @HttpCode(HttpStatus.OK)
  stepDone(@Tenant() ctx: TenantRequest, @Param('key') key: string): Promise<OnboardingState> {
    return this.onboarding.setStepDone(ctx.manager!, ctx.tenantId, ctx.userId, key, true);
  }

  @Delete('steps/:key/done')
  stepUndone(@Tenant() ctx: TenantRequest, @Param('key') key: string): Promise<OnboardingState> {
    return this.onboarding.setStepDone(ctx.manager!, ctx.tenantId, ctx.userId, key, false);
  }

  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  dismiss(@Tenant() ctx: TenantRequest): Promise<OnboardingState> {
    return this.onboarding.setDismissed(ctx.manager!, ctx.tenantId, ctx.userId, true);
  }

  @Delete('dismiss')
  undismiss(@Tenant() ctx: TenantRequest): Promise<OnboardingState> {
    return this.onboarding.setDismissed(ctx.manager!, ctx.tenantId, ctx.userId, false);
  }
}

import { Body, Controller, Get, Patch, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { BillingService } from './billing.service';
import { Features } from '../config/features';
import { throwFeatureDisabled } from '../common/feature-gates';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, ValidateIf, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { PlanKey, IntervalKey } from './plans.config';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';

export class CreateCheckoutSessionDto {
  @IsIn(['max'])
  plan_key!: PlanKey;

  @IsIn(['monthly', 'annual'])
  interval!: IntervalKey;

  @IsOptional()
  @IsString()
  success_url?: string;

  @IsOptional()
  @IsString()
  cancel_url?: string;

  @IsOptional()
  @IsBoolean()
  allow_promotion_codes?: boolean;

  /**
   * The version of the general terms of sale the user accepted (`terms.version` of
   * `GET /billing/plans`). Required: the service refuses a missing or outdated one with
   * TERMS_NOT_ACCEPTED, one stable code for the client.
   */
  @IsOptional()
  @IsString()
  terms_version?: string;
}

export class ChangePlanDto {
  @IsIn(['max'])
  plan_key!: PlanKey;

  @IsIn(['monthly', 'annual'])
  subscription_type!: IntervalKey;

  /** Required, checked by the service like `CreateCheckoutSessionDto.terms_version`. */
  @IsOptional()
  @IsString()
  terms_version?: string;

  /** Where the card setup page returns (`requires_card`), as for `/billing/checkout`. */
  @IsOptional()
  @IsString()
  success_url?: string;

  @IsOptional()
  @IsString()
  cancel_url?: string;
}

export class RequestInvoiceDto {
  @IsIn(['max'])
  plan_key!: PlanKey;

  @IsIn(['monthly', 'annual'])
  subscription_type!: IntervalKey;

  /** Required, checked by the service like `CreateCheckoutSessionDto.terms_version`. */
  @IsOptional()
  @IsString()
  terms_version?: string;
}

class BillingAddressDto {
  @IsOptional()
  @IsString()
  line1?: string | null;

  @IsOptional()
  @IsString()
  line2?: string | null;

  @IsOptional()
  @IsString()
  city?: string | null;

  @IsOptional()
  @IsString()
  state?: string | null;

  @IsOptional()
  @IsString()
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  country?: string | null;
}

class BillingContactDto {
  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @IsString()
  company?: string | null;

  // Empty or null clears the email; anything else must be an email address.
  @ValidateIf((_dto, value) => value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === ''))
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  vatNumber?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingAddressDto)
  address?: BillingAddressDto | null;
}

class OpenPortalDto {
  @IsOptional()
  @IsString()
  returnUrl?: string;
}

/**
 * A field present in `customer` or `invoice` replaces the stored value; an empty string or
 * null clears it. A field left out stays as it is.
 */
export class UpdateBillingProfileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => BillingContactDto)
  customer?: BillingContactDto | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingContactDto)
  invoice?: BillingContactDto | null;
}

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  async getPlans() {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    return this.billing.getPlans();
  }

  /** The full summary (payment method, invoices): billing readers only, like `GET /billing/profile`. */
  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'reader')
  @Get('subscription')
  async subscription(@Req() req: any) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    return this.billing.getSubscriptionSummary({ manager: req?.queryRunner?.manager, forceStripeRefresh: true });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('change-plan')
  async changePlan(@Req() req: any, @Body() body: ChangePlanDto) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    return this.billing.changePlan(
      tenantId,
      body.plan_key,
      body.subscription_type,
      req.user?.sub ?? null,
      mg,
      body.terms_version ?? null,
      { successUrl: body.success_url ?? null, cancelUrl: body.cancel_url ?? null },
    );
  }

  /** "Keep annual": cancels a planned switch to monthly; returns the subscription summary. */
  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('scheduled-change/cancel')
  async cancelScheduledChange(@Req() req: any) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    return this.billing.cancelScheduledChange({ tenantId, userId: req.user?.sub ?? null, manager: mg });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('request-invoice')
  async requestInvoice(@Req() req: any, @Body() body: RequestInvoiceDto) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    return this.billing.requestInvoice(
      tenantId,
      body.plan_key,
      body.subscription_type,
      req.user?.sub ?? null,
      mg,
      body.terms_version ?? null,
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'reader')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Get('profile')
  async profile(@Req() req: any) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    const subscription = await this.billing.getSubscriptionSummary({ manager: mg, forceStripeRefresh: true });
    const profile = await this.billing.getBillingProfile({ tenantId });
    return { subscription, ...profile };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('portal')
  async openPortal(@Req() req: any, @Body() body: OpenPortalDto) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    const session = await this.billing.createCustomerPortalSession({ tenantId, manager: mg, returnUrl: body?.returnUrl });
    return { url: session.url };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('checkout')
  async createCheckout(@Req() req: any, @Body() body: CreateCheckoutSessionDto) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    const session = await this.billing.createCheckoutSession({
      tenantId,
      manager: mg,
      planKey: body.plan_key,
      interval: body.interval,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
      allowPromotionCodes: body.allow_promotion_codes,
      termsVersion: body.terms_version ?? null,
      userId: req.user?.sub ?? null,
    });
    return { url: session.url, id: session.id };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('billing', 'admin')
  @Patch('profile')
  async updateProfile(@Req() req: any, @Body() body: UpdateBillingProfileDto) {
    if (!Features.STRIPE_BILLING) throwFeatureDisabled('billing');
    const tenantId = req?.tenant?.id as string | undefined;
    if (!tenantId) {
      throw new BadRequestException('Tenant context not resolved');
    }
    const mg = req?.queryRunner?.manager as import('typeorm').EntityManager | undefined;
    const profile = await this.billing.updateBillingProfile({
      tenantId,
      customer: body.customer ?? undefined,
      invoice: body.invoice ?? undefined,
      userId: req.user?.sub ?? null,
      manager: mg,
    });
    return profile;
  }
}

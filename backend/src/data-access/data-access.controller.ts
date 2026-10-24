import { Controller, Get, InternalServerErrorException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../common/decorators';
import { readPlacementOptions } from './placement-options';

/** The person's own data access, for the screens (not reserved: it reads nothing beyond it). */
@UseGuards(JwtAuthGuard)
@Controller('data-access')
export class DataAccessController {
  /** The companies and cost centers the person may place a budget line on (`placement-options.ts`). */
  @Get('placement-options')
  placementOptions(@Tenant() ctx: TenantRequest) {
    if (!ctx.manager) throw new InternalServerErrorException('Missing request transaction.');
    return readPlacementOptions(ctx.manager);
  }
}

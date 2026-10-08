import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MultiTenantOnlyGuard } from '../common/feature-gates';
import { RATE_LIMITS } from '../common/rate-limit';
import { UserRateLimitGuard } from '../common/rate-limit.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { DemoDataOverview, DemoDataService, DemoDataState } from './demo-data.service';

/**
 * Sample data of a cloud workspace (Administration > Sample data, and the home banner).
 *
 * Who: the Administrator role of the workspace, checked by DemoDataService on every route (403
 * `administrator_required`). No `@RequireLevel`: PermissionGuard's freeze would refuse the reset
 * of a frozen workspace, which stays allowed (the load is refused by the service instead).
 * Cloud only (MultiTenantOnlyGuard: 404 on-premise), never on the platform host or another
 * system tenant (404).
 *
 * No request transaction (`@SkipTenantTransaction`): the service opens its own, tenant-scoped
 * where it reads tenant tables. A request transaction that wrote a row referencing the tenant
 * would hold a KEY SHARE lock on the tenant row, which the reset's FOR UPDATE would wait for.
 *
 * The load gets the request's Host header (`req.headers.host`, never `req.hostname`, which the
 * trusted proxy takes from X-Forwarded-Host): the loader calls this API with it. The reverse
 * proxies keep the browser's host: prod and QA nginx send `Host $host` (`<slug>.kanap.net`,
 * `<slug>.qa.kanap.net`), the dev nginx `Host $host` on `<slug>.lvh.me` and
 * `<slug>.dev.kanap.net`, and `<slug>.lvh.me` for `<slug>.localhost`.
 */
@UseGuards(MultiTenantOnlyGuard, JwtAuthGuard)
@SkipTenantTransaction()
@Controller('admin/sample-data')
export class DemoDataController {
  constructor(private readonly demo: DemoDataService) {}

  /**
   * The state, whether a load can start, the objects created since a load, the workspace name.
   * `?view=banner`: the light answer of the home banner (`DemoOverviewView`).
   */
  @Get()
  async overview(@Req() req: any, @Query('view') view?: string): Promise<DemoDataOverview> {
    const tenantId = await this.workspaceOf(req);
    return this.demo.getOverview({ tenantId, actorId: req.user?.sub, view: view === 'banner' ? 'banner' : 'page' });
  }

  /** Starts the load and answers at once with the `loading` state; the page polls `GET`. */
  @Post('load')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  async load(@Req() req: any): Promise<DemoDataState> {
    const tenantId = await this.workspaceOf(req);
    return this.demo.load({ tenantId, actorId: req.user?.sub, host: String(req.headers?.host ?? '') });
  }

  /**
   * `{ confirm_name }`: the workspace name, spaces around it and case ignored (400
   * `confirmation_mismatch` otherwise). Starts the reset and answers with the `resetting` state;
   * the page polls `GET`. Once the reset has committed, the administrators get an e-mail
   * (DemoDataService, also when another API process finishes the reset).
   */
  @Post('reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  async reset(@Req() req: any, @Body() body: { confirm_name?: unknown }): Promise<DemoDataState> {
    const tenantId = await this.workspaceOf(req);
    const { state } = await this.demo.startReset({
      tenantId,
      actorId: req.user?.sub,
      requireConfirmation: true,
      confirmName: body?.confirm_name,
    });
    // The reset goes on in the background (tracked, never rejects); the service logs a failure
    // and keeps it in the state for the page.
    return state;
  }

  /** Hides the home banner for the workspace's administrators. */
  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  async dismiss(@Req() req: any): Promise<DemoDataState> {
    const tenantId = await this.workspaceOf(req);
    return this.demo.dismissBanner({ tenantId, actorId: req.user?.sub });
  }

  /** The workspace of the request; the platform host, system tenants and tenant-less hosts have none. */
  private async workspaceOf(req: any): Promise<string> {
    const tenantId = req?.tenant?.id;
    if (req?.isPlatformHost || typeof tenantId !== 'string' || !tenantId) throw new NotFoundException();
    if (await this.demo.isSystemTenant(tenantId)) throw new NotFoundException();
    return tenantId;
  }
}

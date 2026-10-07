import { Body, Controller, Get, HttpCode, HttpStatus, Logger, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { trackBackgroundWork } from '../common/background-work';
import { MultiTenantOnlyGuard } from '../common/feature-gates';
import { RATE_LIMITS } from '../common/rate-limit';
import { UserRateLimitGuard } from '../common/rate-limit.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { DemoDataOverview, DemoDataService, DemoDataState } from './demo-data.service';

/**
 * Sample data of a cloud workspace (Administration > Sample data, and the home banner).
 *
 * Who: the Administrator role of the workspace, checked by DemoDataService on every route (403
 * `administrator_required`). No `@RequireLevel`: PermissionGuard's freeze would refuse the reset
 * of a frozen workspace, which stays allowed (the load is refused by the service instead).
 * Cloud only (MultiTenantOnlyGuard: 404 on-premise), never on the platform host (404).
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
  private readonly logger = new Logger(DemoDataController.name);

  constructor(
    private readonly demo: DemoDataService,
    private readonly notifications: NotificationsService,
  ) {}

  /** The state, whether a load can start, the objects created since a load, the workspace name. */
  @Get()
  overview(@Req() req: any): Promise<DemoDataOverview> {
    return this.demo.getOverview({ tenantId: tenantOf(req), actorId: req.user?.sub });
  }

  /** Starts the load and answers at once with the `loading` state; the page polls `GET`. */
  @Post('load')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  load(@Req() req: any): Promise<DemoDataState> {
    return this.demo.load({ tenantId: tenantOf(req), actorId: req.user?.sub, host: String(req.headers?.host ?? '') });
  }

  /**
   * `{ confirm_name }`: the workspace name, spaces around it and case ignored (400
   * `confirmation_mismatch` otherwise). Starts the reset and answers with the `resetting` state;
   * the page polls `GET`. Once the reset has committed, the administrators get an e-mail.
   */
  @Post('reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  async reset(@Req() req: any, @Body() body: { confirm_name?: unknown }): Promise<DemoDataState> {
    const tenantId = tenantOf(req);
    const actorId = req.user?.sub;
    const { state, done } = await this.demo.startReset({ tenantId, actorId, confirmName: body?.confirm_name });
    trackBackgroundWork(done.then(
      () => this.notifications.notifyWorkspaceReset({ tenantId, actorId, resetAt: new Date() }),
      (error) => {
        this.logger.error(`Sample data reset of tenant ${tenantId} failed: ${error instanceof Error ? error.message : error}`);
      },
    ));
    return state;
  }

  /** Hides the home banner for the workspace's administrators. */
  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.sampleDataAction })
  dismiss(@Req() req: any): Promise<DemoDataState> {
    return this.demo.dismissBanner({ tenantId: tenantOf(req), actorId: req.user?.sub });
  }
}

/** The workspace of the request; the platform host and tenant-less hosts have none. */
function tenantOf(req: any): string {
  const tenantId = req?.tenant?.id;
  if (req?.isPlatformHost || typeof tenantId !== 'string' || !tenantId) throw new NotFoundException();
  return tenantId;
}

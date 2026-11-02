import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { MultiTenantOnlyGuard } from '../common/feature-gates';
import { discoveryCallConfig } from './discovery-call.config';
import { DiscoveryCallService, isDiscoveryCallPlacement, validCalcomSignature } from './discovery-call.service';

/**
 * The discovery call of trial workspaces (`doc/discovery-call.md`), cloud only.
 * - `POST /discovery-call/clicks { placement }`: a signed-in user clicked the button
 *   (audit entry `trial.discovery_call_clicked`). 204.
 * - `POST /discovery-call/calcom`: the Cal.com webhook, signed with DISCOVERY_CALL_WEBHOOK_SECRET
 *   (`x-cal-signature-256`). No tenant: the booking finds it by the attendee's address. 404 while
 *   no secret is set, 401 on a bad signature, 200 otherwise, an ignored
 *   event included, so Cal.com does not retry it.
 * Both answer 404 on-premise (MultiTenantOnlyGuard).
 */
@UseGuards(MultiTenantOnlyGuard)
@Controller('discovery-call')
export class DiscoveryCallController {
  constructor(private readonly discoveryCall: DiscoveryCallService) {}

  @UseGuards(JwtAuthGuard)
  @Post('clicks')
  @HttpCode(HttpStatus.NO_CONTENT)
  async click(@Tenant() ctx: TenantRequest, @Body() body: unknown): Promise<void> {
    const placement = (body as { placement?: unknown } | null)?.placement;
    if (!isDiscoveryCallPlacement(placement)) {
      throw new BadRequestException({ code: 'discovery_call_placement_invalid', message: 'Unknown placement.' });
    }
    await this.discoveryCall.recordClick(ctx.manager!, ctx.tenantId, ctx.userId, placement);
  }

  @Public()
  @Post('calcom')
  @HttpCode(HttpStatus.OK)
  async calcom(@Req() req: Request, @Headers('x-cal-signature-256') signature?: string) {
    const { webhookSecret } = discoveryCallConfig();
    if (!webhookSecret) throw new NotFoundException();
    const raw: Buffer | undefined = (req as any).rawBody;
    if (!raw || !validCalcomSignature(raw, signature, webhookSecret)) {
      throw new UnauthorizedException({ code: 'discovery_call_signature_invalid', message: 'Invalid signature.' });
    }
    const outcome = await this.discoveryCall.applyCalcomEvent(req.body);
    return { received: true, outcome };
  }
}

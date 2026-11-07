import { Controller, Get, Header, HttpCode, HttpStatus, NotFoundException, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../../auth/public.decorator';
import { MultiTenantOnlyGuard } from '../../common/feature-gates';
import { discoveryCallConfig } from '../../discovery-call/discovery-call.config';
import type { DiscoveryCallPlacement } from '../../discovery-call/discovery-call.service';
import { getEmailStrings, interpolate } from '../../i18n/email-i18n';
import { frenchSpacing } from './trial-mail-templates';
import { TrialMailsService } from './trial-mails.service';
import { PRODUCT_NAME } from '../../config/product';

/** The placements of the call links in the e-mails. */
const MAIL_PLACEMENTS = new Set<string>(['mail_j0', 'mail_j5']);

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/** A small page in the style of the e-mails: one sentence, optionally one button. */
function page(locale: string, title: string, message: string, form?: { action: string; label: string }): string {
  const spaced = (text: string) => escapeHtml(locale === 'fr' ? frenchSpacing(text) : text);
  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="robots" content="noindex"><title>${spaced(title)} · ${PRODUCT_NAME}</title></head>
<body style="margin:0;padding:48px 16px;background:#FAFAFA;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">
<main style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #D1D5DB;border-radius:10px;padding:28px 32px;">
<h1 style="margin:0 0 12px 0;font-size:20px;line-height:28px;font-weight:600;">${spaced(title)}</h1>
<p style="margin:0;font-size:14px;line-height:22px;">${spaced(message)}</p>
${form ? `<form method="post" action="${escapeHtml(form.action)}" style="margin:20px 0 0 0;"><button type="submit" style="background:#1A6B7A;color:#FFFFFF;border:0;border-radius:8px;padding:10px 16px;font-size:13px;font-weight:600;cursor:pointer;">${spaced(form.label)}</button></form>` : ''}
</main></body></html>`;
}

/**
 * The links of the trial e-mails (`doc/trial-mails.md`), public, cloud only (404 on-premise). The
 * token is `<tenant>.<secret>`, the secret stored in the workspace's `trial_mails` row.
 * - `GET /trial-mails/unsubscribe?t=`: a page that asks to confirm (a link scanner that opens it
 *   unsubscribes nobody). `POST` on the same address unsubscribes: the page's button, and the
 *   one-click unsubscribe of mail clients (`List-Unsubscribe-Post`, RFC 8058). 404 on a bad token.
 * - `GET /trial-mails/call?t=&from=`: counts the click (`trial.discovery_call_clicked`, placement
 *   `from`) when the token is valid, then redirects to the booking page (or the fallback address)
 *   in every case. 404 only when neither is set.
 */
@UseGuards(MultiTenantOnlyGuard)
@Controller('trial-mails')
export class TrialMailsController {
  constructor(private readonly trialMails: TrialMailsService) {}

  private async unsubscribeTarget(token: unknown) {
    const tenantId = await this.trialMails.linkTenant(token);
    const workspace = tenantId ? await this.trialMails.workspace(tenantId) : null;
    if (!tenantId || !workspace) throw new NotFoundException();
    return { tenantId, ...workspace, strings: getEmailStrings(workspace.locale).trialMails.unsubscribe };
  }

  @Public()
  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribePage(@Query('t') token: string) {
    const target = await this.unsubscribeTarget(token);
    return page(
      target.locale,
      target.strings.title,
      interpolate(target.strings.question, { workspace: target.name }),
      { action: `?t=${encodeURIComponent(token)}`, label: target.strings.confirm },
    );
  }

  @Public()
  @Post('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Query('t') token: string) {
    const target = await this.unsubscribeTarget(token);
    await this.trialMails.unsubscribe(target.tenantId);
    return page(target.locale, target.strings.title, interpolate(target.strings.done, { workspace: target.name }));
  }

  @Public()
  @Get('call')
  async call(@Query('t') token: string, @Query('from') from: string, @Res() res: Response) {
    const { url, fallbackEmail } = discoveryCallConfig();
    const target = url || (fallbackEmail ? `mailto:${fallbackEmail}` : '');
    if (!target) throw new NotFoundException();
    // The count never stands in the way of the booking page.
    const tenantId = await this.trialMails.linkTenant(token).catch(() => null);
    if (tenantId && MAIL_PLACEMENTS.has(from)) await this.trialMails.recordCallClick(tenantId, from as DiscoveryCallPlacement);
    res.redirect(HttpStatus.FOUND, target);
  }
}

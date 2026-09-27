/**
 * Email template functions for notifications.
 * Each returns { subject, html, text, attachments } for use with EmailService.
 */
import type { EmailAttachment } from '../email/email.service';
import type { EmailBranding } from '../email/email-branding';
import { DEFAULT_EMAIL_PRIMARY_COLOR, getDefaultEmailBranding } from '../email/email-branding';
import { getEmailStrings, interpolate } from '../i18n/email-i18n';
import type { EmailStrings } from '../i18n/email-locales/en';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachment[];
}

export interface EmailWrapperResult {
  html: string;
  attachments: EmailAttachment[];
}

export interface ActionButton {
  label: string;
  url: string;
}

type ItemTypeLabelKey = 'request' | 'project' | 'task' | 'contract' | 'opex' | 'capex' | 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document';
type EmailTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'testing';

const EMAIL_TOKENS = {
  background: '#FAFAFA',
  paper: '#FFFFFF',
  surface: '#F9FAFB',
  surfaceMuted: '#F3F4F6',
  borderSubtle: '#E5E7EB',
  border: '#D1D5DB',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textTertiary: '#9CA3AF',
  attention: '#E8920F',
  attentionSoft: '#FFF4E0',
  info: '#1D4ED8',
  infoSoft: '#EFF6FF',
  success: '#15803D',
  successSoft: '#F0FDF4',
  testing: '#7C3AED',
  testingSoft: '#F5F3FF',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
} as const;

const EMAIL_UI_FONT =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif";
const EMAIL_MONO_FONT =
  "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

// Helper functions
function formatStatus(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatRole(role: string): string {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getBaseUrl(url: string): string {
  const match = url.match(/^(https?:\/\/[^/]+)/);
  return match ? match[1] : '';
}

function getItemTypeStrings(strings: EmailStrings, itemType: ItemTypeLabelKey) {
  return strings.common.itemTypes[itemType];
}

function buildManagePreferencesText(
  locale: string | null | undefined,
  preferencesUrl: string,
): string {
  return interpolate(getEmailStrings(locale).common.footer.managePreferencesText, {
    url: preferencesUrl,
  });
}

function buildViewText(locale: string | null | undefined, url: string): string {
  return interpolate(getEmailStrings(locale).common.labels.viewText, { url });
}

function buildOpenDocumentText(locale: string | null | undefined, url: string): string {
  return interpolate(getEmailStrings(locale).common.labels.openDocumentText, { url });
}

function joinTextBlocks(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim().length > 0)).join('\n\n');
}

function getPrimaryColor(branding?: EmailBranding): string {
  return branding?.primaryColor ?? DEFAULT_EMAIL_PRIMARY_COLOR;
}

function getToneColors(tone: EmailTone): { background: string; text: string; border: string } {
  switch (tone) {
    case 'info':
      return {
        background: EMAIL_TOKENS.infoSoft,
        text: EMAIL_TOKENS.info,
        border: '#BFDBFE',
      };
    case 'success':
      return {
        background: EMAIL_TOKENS.successSoft,
        text: EMAIL_TOKENS.success,
        border: '#BBF7D0',
      };
    case 'warning':
      return {
        background: EMAIL_TOKENS.attentionSoft,
        text: '#B45309',
        border: '#FCD34D',
      };
    case 'danger':
      return {
        background: EMAIL_TOKENS.dangerSoft,
        text: EMAIL_TOKENS.danger,
        border: '#FECACA',
      };
    case 'testing':
      return {
        background: EMAIL_TOKENS.testingSoft,
        text: EMAIL_TOKENS.testing,
        border: '#DDD6FE',
      };
    case 'neutral':
    default:
      return {
        background: EMAIL_TOKENS.surface,
        text: EMAIL_TOKENS.textPrimary,
        border: EMAIL_TOKENS.borderSubtle,
      };
  }
}

/**
 * Compute a readable foreground color (white or dark) for text on a given background.
 * Uses relative luminance per WCAG 2.0.
 */
function contrastTextColor(hexBg: string): string {
  const hex = hexBg.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.4 ? '#111827' : '#ffffff';
}

export function buildActionButtons(
  buttons: ActionButton[] | undefined,
  primaryColor: string,
  options?: {
    align?: 'left' | 'center' | 'right';
    marginTop?: number;
  },
): string {
  if (!buttons || buttons.length === 0) return '';
  const textColor = contrastTextColor(primaryColor);
  const rendered = buttons
    .map((button) => (
      `<a href="${escapeHtml(button.url)}" style="display:inline-block;background-color:${primaryColor};color:${textColor};text-decoration:none;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;line-height:20px;margin-right:8px;margin-bottom:8px;">${escapeHtml(button.label)}</a>`
    ))
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${options?.marginTop ?? 24}px;">
<tr><td align="${options?.align ?? 'left'}">${rendered}</td></tr>
</table>`;
}

export function buildEmailIntro(params: {
  eyebrow?: string;
  title: string;
  summaryHtml?: string;
  badgeHtml?: string;
}): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;">
<tr><td>
${params.eyebrow
    ? `<div style="margin:0 0 10px 0;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(params.eyebrow)}</div>`
    : ''}
${params.badgeHtml ? `<div style="margin:0 0 12px 0;">${params.badgeHtml}</div>` : ''}
<h1 style="margin:0;font-size:24px;line-height:30px;font-weight:600;color:${EMAIL_TOKENS.textPrimary};font-family:${EMAIL_UI_FONT};">${escapeHtml(params.title)}</h1>
${params.summaryHtml
    ? `<div style="margin:12px 0 0 0;font-size:14px;line-height:22px;color:${EMAIL_TOKENS.textSecondary};">${params.summaryHtml}</div>`
    : ''}
</td></tr>
</table>`;
}

export function buildSurfacePanel(params: {
  contentHtml: string;
  labelHtml?: string;
  tone?: EmailTone;
  marginTop?: number;
  padding?: number;
}): string {
  const tone = getToneColors(params.tone ?? 'neutral');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:${params.marginTop ?? 0}px;background-color:${tone.background};border:1px solid ${tone.border};border-radius:10px;">
<tr><td style="padding:${params.padding ?? 16}px;">
${params.labelHtml
    ? `<div style="margin:0 0 10px 0;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_TOKENS.textSecondary};">${params.labelHtml}</div>`
    : ''}
<div style="font-size:14px;line-height:22px;color:${tone.text};">${params.contentHtml}</div>
</td></tr>
</table>`;
}

export function buildUrlPanel(
  introText: string,
  url: string,
  primaryColor: string,
  options?: {
    marginTop?: number;
  },
): string {
  const safeUrl = escapeHtml(url);
  return buildSurfacePanel({
    marginTop: options?.marginTop ?? 20,
    contentHtml: `<p style="margin:0 0 10px 0;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(introText)}</p>
<a href="${safeUrl}" style="color:${primaryColor};text-decoration:none;word-break:break-all;">${safeUrl}</a>`,
  });
}

function buildDataPanel(rows: Array<{
  label: string;
  value: string;
  mono?: boolean;
  html?: boolean;
}>): string {
  const renderedRows = rows
    .map((row, index) => (
      `<tr>
<td style="padding:12px 16px;${index > 0 ? `border-top:1px solid ${EMAIL_TOKENS.borderSubtle};` : ''}">
<div style="margin:0 0 4px 0;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(row.label)}</div>
<div style="font-size:14px;line-height:20px;font-weight:500;color:${EMAIL_TOKENS.textPrimary};font-family:${row.mono ? EMAIL_MONO_FONT : EMAIL_UI_FONT};">${row.html ? row.value : escapeHtml(row.value)}</div>
</td>
</tr>`
    ))
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_TOKENS.surface};border:1px solid ${EMAIL_TOKENS.borderSubtle};border-radius:10px;margin-top:20px;">
${renderedRows}
</table>`;
}

function buildToneBadge(label: string, tone: EmailTone): string {
  const colors = getToneColors(tone);
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background-color:${colors.background};color:${colors.text};font-size:12px;line-height:14px;font-weight:500;border:1px solid ${colors.border};">${escapeHtml(label)}</span>`;
}

/**
 * Shared email wrapper.
 * Returns { html, attachments } — the logo is always included as a CID inline attachment.
 */
export function emailWrapper(
  body: string,
  options?: {
    preferencesUrl?: string;
    branding?: EmailBranding;
    locale?: string;
  },
): EmailWrapperResult {
  const branding = options?.branding ?? getDefaultEmailBranding();
  const strings = getEmailStrings(options?.locale);
  const pc = getPrimaryColor(branding);
  const hasLogo = branding.logoBuffer.length > 0;
  const preferencesLink = options?.preferencesUrl
    ? `<a href="${escapeHtml(options.preferencesUrl)}" style="color:${pc};text-decoration:none;font-size:11px;line-height:16px;">${escapeHtml(strings.common.footer.managePreferencesLink)}</a>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(strings.common.htmlLang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:${EMAIL_TOKENS.background};font-family:${EMAIL_UI_FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_TOKENS.background};">
<tr><td align="center" style="padding:24px 16px 32px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">
<tr><td style="padding:0 0 12px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr>
<td align="left" style="font-size:0;line-height:0;">
${hasLogo
    ? `<img src="cid:${branding.logoCid}" alt="KANAP" height="26" style="display:block;height:26px;width:auto;max-width:180px;" />`
    : `<span style="font-size:13px;line-height:20px;font-weight:600;color:${EMAIL_TOKENS.textPrimary};">${escapeHtml(strings.common.footer.poweredBy)}</span>`}
</td>
<td align="right" style="font-size:11px;line-height:16px;color:${EMAIL_TOKENS.textTertiary};">${branding.isCustom ? escapeHtml(strings.common.footer.poweredBy) : '&nbsp;'}</td>
</tr>
</table>
</td></tr>
<tr><td style="background-color:${EMAIL_TOKENS.paper};border:1px solid ${EMAIL_TOKENS.border};border-radius:10px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:28px 32px 8px 32px;font-size:14px;line-height:22px;color:${EMAIL_TOKENS.textPrimary};">
${body}
</td></tr>
<tr><td style="padding:0 32px 24px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${EMAIL_TOKENS.borderSubtle};">
<tr>
<td align="left" style="padding-top:16px;font-size:11px;line-height:16px;color:${EMAIL_TOKENS.textTertiary};">${escapeHtml(strings.common.footer.poweredBy)}</td>
<td align="right" style="padding-top:16px;font-size:11px;line-height:16px;">${preferencesLink}</td>
</tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const attachments: EmailAttachment[] = hasLogo
    ? [
      {
        filename: 'logo.png',
        content: branding.logoBuffer.toString('base64'),
        encoding: 'base64',
        contentType: branding.logoContentType,
        contentId: branding.logoCid,
      },
    ]
    : [];

  return { html, attachments };
}

// Template: Status Change
export function buildStatusChangeEmail(params: {
  itemType: 'request' | 'project' | 'task' | 'contract' | 'opex' | 'capex';
  itemName: string;
  itemUrl: string;
  oldStatus: string;
  newStatus: string;
  actionButtons?: ActionButton[];
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.statusChange.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const actionButtons = params.actionButtons && params.actionButtons.length > 0
    ? params.actionButtons
    : [{ label: typeLabel.view, url: params.itemUrl }];

  const updatedHtml = interpolate(strings.notifications.statusChange.updatedHtml, {
    itemTypeLower: typeLabel.lower,
    itemName: escapeHtml(params.itemName),
  });
  const statusChangedHtml = interpolate(strings.notifications.statusChange.statusChangedHtml, {
    oldStatus: formatStatus(params.oldStatus),
    newStatus: formatStatus(params.newStatus),
  });
  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(strings.notifications.statusChange.heading, {
        itemType: typeLabel.label,
      }),
      summaryHtml: `<p style="margin:0;">${updatedHtml}</p>`,
    })}
    ${buildSurfacePanel({
      tone: 'info',
      contentHtml: `<p style="margin:0;">${statusChangedHtml}</p>`,
    })}
    ${buildActionButtons(actionButtons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const actionText = actionButtons.map((b) => `${b.label}: ${b.url}`).join('\n');
  const text = joinTextBlocks([
    interpolate(strings.notifications.statusChange.text, {
      itemType: typeLabel.label,
      itemName: params.itemName,
      oldStatus: formatStatus(params.oldStatus),
      newStatus: formatStatus(params.newStatus),
    }),
    actionText,
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Status Change with Comment
export function buildStatusChangeWithCommentEmail(params: {
  itemType: 'request' | 'project' | 'task' | 'contract' | 'opex' | 'capex';
  itemName: string;
  itemUrl: string;
  oldStatus: string;
  newStatus: string;
  authorName: string;
  commentHtml: string;
  commentTextPreview: string;
  actionButtons?: ActionButton[];
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.statusChangeWithComment.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
    newStatus: formatStatus(params.newStatus),
  });
  const safeHtml = params.commentHtml || strings.common.labels.noCommentContentHtml;
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const actionButtons = params.actionButtons && params.actionButtons.length > 0
    ? params.actionButtons
    : [{ label: typeLabel.view, url: params.itemUrl }];

  const updatedHtml = interpolate(strings.notifications.statusChange.updatedHtml, {
    itemTypeLower: typeLabel.lower,
    itemName: escapeHtml(params.itemName),
  });
  const statusChangedHtml = interpolate(strings.notifications.statusChange.statusChangedHtml, {
    oldStatus: formatStatus(params.oldStatus),
    newStatus: formatStatus(params.newStatus),
  });
  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(strings.notifications.statusChange.heading, {
        itemType: typeLabel.label,
      }),
      summaryHtml: `<p style="margin:0 0 10px 0;">${updatedHtml}</p><p style="margin:0;">${statusChangedHtml}</p>`,
    })}
    ${buildSurfacePanel({
      marginTop: 20,
      labelHtml: interpolate(strings.notifications.statusChangeWithComment.commentIntroHtml, {
        authorName: escapeHtml(params.authorName),
      }),
      contentHtml: safeHtml,
    })}
    ${buildActionButtons(actionButtons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const actionText = actionButtons.map((b) => `${b.label}: ${b.url}`).join('\n');
  const text = joinTextBlocks([
    interpolate(strings.notifications.statusChange.text, {
      itemType: typeLabel.label,
      itemName: params.itemName,
      oldStatus: formatStatus(params.oldStatus),
      newStatus: formatStatus(params.newStatus),
    }),
    interpolate(strings.notifications.statusChangeWithComment.textComment, {
      authorName: params.authorName,
      commentPreview: params.commentTextPreview,
    }),
    actionText,
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Team Addition
export function buildTeamAddedEmail(params: {
  itemType: 'request' | 'project';
  itemName: string;
  itemUrl: string;
  role: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.teamAdded.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(strings.notifications.teamAdded.heading, {
        itemType: typeLabel.label,
      }),
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.teamAdded.bodyHtml, {
        role: formatRole(params.role),
        itemName: escapeHtml(params.itemName),
      })}</p>`,
    })}
    ${buildActionButtons([{ label: typeLabel.view, url: params.itemUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(strings.notifications.teamAdded.text, {
      role: formatRole(params.role),
      itemType: typeLabel.label,
      itemName: params.itemName,
    }),
    buildViewText(params.locale, params.itemUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Team Member Added (for IT Lead notification)
export function buildTeamMemberAddedEmail(params: {
  itemType: 'request' | 'project';
  itemName: string;
  itemUrl: string;
  addedUserName: string;
  role: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.teamMemberAdded.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: strings.notifications.teamMemberAdded.heading,
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.teamMemberAdded.bodyHtml, {
        addedUserName: escapeHtml(params.addedUserName),
        role: formatRole(params.role),
        itemTypeLower: typeLabel.lower,
        itemName: escapeHtml(params.itemName),
      })}</p>`,
    })}
    ${buildActionButtons([{ label: typeLabel.view, url: params.itemUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(strings.notifications.teamMemberAdded.text, {
      addedUserName: params.addedUserName,
      role: formatRole(params.role),
      itemType: typeLabel.label,
      itemName: params.itemName,
    }),
    buildViewText(params.locale, params.itemUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Comment Added
export function buildCommentEmail(params: {
  itemType: 'request' | 'project' | 'task';
  itemName: string;
  itemUrl: string;
  authorName: string;
  commentHtml: string;
  commentTextPreview: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.comment.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
  });
  const safeHtml = params.commentHtml || strings.common.labels.noCommentContentHtml;
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: strings.notifications.comment.heading,
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.comment.introHtml, {
        authorName: escapeHtml(params.authorName),
        itemTypeLower: typeLabel.lower,
        itemName: escapeHtml(params.itemName),
      })}</p>`,
    })}
    ${buildSurfacePanel({
      marginTop: 20,
      contentHtml: safeHtml,
    })}
    ${buildActionButtons([{ label: typeLabel.view, url: params.itemUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(strings.notifications.comment.text, {
      authorName: params.authorName,
      itemType: typeLabel.label,
      itemName: params.itemName,
      commentPreview: params.commentTextPreview,
    }),
    buildViewText(params.locale, params.itemUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Share Item
export function buildShareEmail(params: {
  itemType: 'request' | 'project' | 'task' | 'opex' | 'capex' | 'asset' | 'application' | 'location' | 'connection' | 'interface' | 'document';
  itemName: string;
  itemUrl: string;
  senderName: string;
  message?: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.share.subject, {
    senderName: params.senderName,
    itemType: typeLabel.label,
    itemName: params.itemName,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';

  const messageBlock = params.message
    ? buildSurfacePanel({
      marginTop: 20,
      contentHtml: `<div style="white-space:pre-wrap;">${escapeHtml(params.message)}</div>`,
    })
    : '';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(strings.notifications.share.heading, {
        itemType: typeLabel.label,
      }),
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.share.introHtml, {
        senderName: escapeHtml(params.senderName),
        itemTypeLower: typeLabel.lower,
        itemName: escapeHtml(params.itemName),
      })}</p>`,
    })}
    ${messageBlock}
    ${buildActionButtons([{ label: typeLabel.view, url: params.itemUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(strings.notifications.share.text, {
      senderName: params.senderName,
      itemType: typeLabel.label,
      itemName: params.itemName,
    }),
    params.message
      ? interpolate(strings.common.labels.messageText, { message: params.message })
      : null,
    buildViewText(params.locale, params.itemUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Task Assigned
export function buildTaskAssignedEmail(params: {
  taskTitle: string;
  taskUrl: string;
  assignerName: string;
  dueDate?: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const taskType = strings.common.itemTypes.task;
  const subject = interpolate(strings.notifications.taskAssigned.subject, {
    taskTitle: params.taskTitle,
  });
  const preferencesUrl = getBaseUrl(params.taskUrl) + '/settings/notifications';

  const duePanel = params.dueDate
    ? buildSurfacePanel({
      marginTop: 20,
      tone: 'info',
      contentHtml: `<p style="margin:0;">${interpolate(strings.common.labels.dueDateHtml, { value: params.dueDate })}</p>`,
    })
    : '';

  const body = `
    ${buildEmailIntro({
      eyebrow: taskType.label,
      title: strings.notifications.taskAssigned.heading,
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.taskAssigned.introHtml, {
        assignerName: escapeHtml(params.assignerName),
        taskTitle: escapeHtml(params.taskTitle),
      })}</p>`,
    })}
    ${duePanel}
    ${buildActionButtons([{ label: taskType.view, url: params.taskUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    `${interpolate(strings.notifications.taskAssigned.text, {
      assignerName: params.assignerName,
      taskTitle: params.taskTitle,
    })}${params.dueDate
      ? interpolate(strings.notifications.taskAssigned.dueTextSuffix, { dueDate: params.dueDate })
      : ''}`,
    buildViewText(params.locale, params.taskUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Knowledge Workflow Requested
export function buildKnowledgeWorkflowRequestedEmail(params: {
  documentRef: string;
  documentTitle: string;
  documentUrl?: string | null;
  requesterName: string;
  stage: 'review' | 'approval';
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const subject = interpolate(
    params.stage === 'review'
      ? strings.knowledge.requested.subjectReview
      : strings.knowledge.requested.subjectApproval,
    {
      documentRef: params.documentRef,
      documentTitle: params.documentTitle,
    },
  );
  const preferencesUrl = params.documentUrl ? `${getBaseUrl(params.documentUrl)}/settings/notifications` : undefined;
  const introHtml = interpolate(
    params.stage === 'review'
      ? strings.knowledge.requested.introReviewHtml
      : strings.knowledge.requested.introApprovalHtml,
    {
      requesterName: escapeHtml(params.requesterName),
      documentRef: escapeHtml(params.documentRef),
    },
  );
  const body = `
    ${buildEmailIntro({
      eyebrow: params.documentRef,
      title: params.stage === 'review'
        ? strings.knowledge.requested.headingReview
        : strings.knowledge.requested.headingApproval,
      summaryHtml: `<p style="margin:0 0 10px 0;">${introHtml}</p><p style="margin:0;">${interpolate(strings.common.labels.titleHtml, { value: escapeHtml(params.documentTitle) })}</p>`,
    })}
    ${buildActionButtons(
      params.documentUrl
        ? [{ label: strings.common.labels.openDocument, url: params.documentUrl }]
        : undefined,
      pc,
    )}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
  const text = joinTextBlocks([
    interpolate(
      params.stage === 'review'
        ? strings.knowledge.requested.introReviewText
        : strings.knowledge.requested.introApprovalText,
      {
        requesterName: params.requesterName,
        documentRef: params.documentRef,
      },
    ),
    interpolate(strings.common.labels.titleText, { value: params.documentTitle }),
    params.documentUrl ? buildOpenDocumentText(params.locale, params.documentUrl) : null,
    preferencesUrl ? buildManagePreferencesText(params.locale, preferencesUrl) : null,
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Knowledge Workflow Approved
export function buildKnowledgeWorkflowApprovedEmail(params: {
  documentRef: string;
  documentTitle: string;
  documentUrl?: string | null;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const subject = interpolate(strings.knowledge.approved.subject, {
    documentRef: params.documentRef,
    documentTitle: params.documentTitle,
  });
  const preferencesUrl = params.documentUrl ? `${getBaseUrl(params.documentUrl)}/settings/notifications` : undefined;
  const body = `
    ${buildEmailIntro({
      eyebrow: params.documentRef,
      title: strings.knowledge.approved.heading,
      summaryHtml: `<p style="margin:0 0 10px 0;">${interpolate(strings.knowledge.approved.bodyHtml, {
        documentRef: escapeHtml(params.documentRef),
      })}</p><p style="margin:0;">${interpolate(strings.common.labels.titleHtml, { value: escapeHtml(params.documentTitle) })}</p>`,
    })}
    ${buildActionButtons(
      params.documentUrl
        ? [{ label: strings.common.labels.openDocument, url: params.documentUrl }]
        : undefined,
      pc,
    )}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
  const text = joinTextBlocks([
    interpolate(strings.knowledge.approved.text, { documentRef: params.documentRef }),
    interpolate(strings.common.labels.titleText, { value: params.documentTitle }),
    params.documentUrl ? buildOpenDocumentText(params.locale, params.documentUrl) : null,
    preferencesUrl ? buildManagePreferencesText(params.locale, preferencesUrl) : null,
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Knowledge Workflow Changes Requested
export function buildKnowledgeWorkflowChangesRequestedEmail(params: {
  documentRef: string;
  documentTitle: string;
  documentUrl?: string | null;
  actorName: string;
  comment: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const subject = interpolate(strings.knowledge.changesRequested.subject, {
    documentRef: params.documentRef,
    documentTitle: params.documentTitle,
  });
  const preferencesUrl = params.documentUrl ? `${getBaseUrl(params.documentUrl)}/settings/notifications` : undefined;
  const body = `
    ${buildEmailIntro({
      eyebrow: params.documentRef,
      title: strings.knowledge.changesRequested.heading,
      summaryHtml: `<p style="margin:0 0 10px 0;">${interpolate(strings.knowledge.changesRequested.introHtml, {
        actorName: escapeHtml(params.actorName),
        documentRef: escapeHtml(params.documentRef),
      })}</p><p style="margin:0;">${interpolate(strings.common.labels.titleHtml, { value: escapeHtml(params.documentTitle) })}</p>`,
    })}
    ${buildSurfacePanel({
      marginTop: 20,
      tone: 'warning',
      contentHtml: `<div style="white-space:pre-wrap;">${escapeHtml(params.comment)}</div>`,
    })}
    ${buildActionButtons(
      params.documentUrl
        ? [{ label: strings.common.labels.openDocument, url: params.documentUrl }]
        : undefined,
      pc,
    )}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
  const text = joinTextBlocks([
    interpolate(strings.knowledge.changesRequested.text, {
      actorName: params.actorName,
      documentRef: params.documentRef,
    }),
    interpolate(strings.common.labels.titleText, { value: params.documentTitle }),
    interpolate(strings.knowledge.changesRequested.commentText, { comment: params.comment }),
    params.documentUrl ? buildOpenDocumentText(params.locale, params.documentUrl) : null,
    preferencesUrl ? buildManagePreferencesText(params.locale, preferencesUrl) : null,
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Knowledge Workflow Cancelled
export function buildKnowledgeWorkflowCancelledEmail(params: {
  documentRef: string;
  documentTitle: string;
  documentUrl?: string | null;
  actorName: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const subject = interpolate(strings.knowledge.cancelled.subject, {
    documentRef: params.documentRef,
    documentTitle: params.documentTitle,
  });
  const preferencesUrl = params.documentUrl ? `${getBaseUrl(params.documentUrl)}/settings/notifications` : undefined;
  const body = `
    ${buildEmailIntro({
      eyebrow: params.documentRef,
      title: strings.knowledge.cancelled.heading,
      summaryHtml: `<p style="margin:0 0 10px 0;">${interpolate(strings.knowledge.cancelled.introHtml, {
        actorName: escapeHtml(params.actorName),
        documentRef: escapeHtml(params.documentRef),
      })}</p><p style="margin:0;">${interpolate(strings.common.labels.titleHtml, { value: escapeHtml(params.documentTitle) })}</p>`,
    })}
    ${buildActionButtons(
      params.documentUrl
        ? [{ label: strings.common.labels.openDocument, url: params.documentUrl }]
        : undefined,
      pc,
    )}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
  const text = joinTextBlocks([
    interpolate(strings.knowledge.cancelled.text, {
      actorName: params.actorName,
      documentRef: params.documentRef,
    }),
    interpolate(strings.common.labels.titleText, { value: params.documentTitle }),
    params.documentUrl ? buildOpenDocumentText(params.locale, params.documentUrl) : null,
    preferencesUrl ? buildManagePreferencesText(params.locale, preferencesUrl) : null,
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Expiration Warning
export function buildExpirationWarningEmail(params: {
  itemType: 'contract' | 'opex' | 'capex';
  itemName: string;
  itemUrl: string;
  expirationDate: string;
  daysRemaining: number;
  warningType: 'expiration' | 'cancellation_deadline';
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const warningStrings = strings.notifications.expirationWarning.warningTypes[params.warningType];
  const branding = params.branding;
  const pc = getPrimaryColor(branding);

  const subject = interpolate(strings.notifications.expirationWarning.subject, {
    itemType: typeLabel.label,
    itemName: params.itemName,
    warningLabel: warningStrings.label,
    daysRemaining: params.daysRemaining,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(strings.notifications.expirationWarning.heading, {
        itemType: typeLabel.label,
        warningHeading: warningStrings.heading,
      }),
      badgeHtml: buildToneBadge(warningStrings.label, 'warning'),
      summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.expirationWarning.bodyHtml, {
        itemTypeLower: typeLabel.lower,
        itemName: escapeHtml(params.itemName),
        warningLabel: warningStrings.label,
        expirationDate: params.expirationDate,
        daysRemaining: params.daysRemaining,
      })}</p>`,
    })}
    ${buildActionButtons([{ label: typeLabel.view, url: params.itemUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(strings.notifications.expirationWarning.text, {
      itemType: typeLabel.label,
      itemName: params.itemName,
      warningLabel: warningStrings.label,
      expirationDate: params.expirationDate,
      daysRemaining: params.daysRemaining,
    }),
    buildViewText(params.locale, params.itemUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// ============================================
// Weekly Review — helper functions
// ============================================

function buildStatsBar(stats: Array<{ label: string; count: number }>, pc: string): string {
  const cells = stats
    .map(
      (s, index) => `<td align="center" style="padding:16px 10px;width:${Math.floor(100 / stats.length)}%;${index > 0 ? `border-left:1px solid ${EMAIL_TOKENS.borderSubtle};` : ''}">
<div style="font-size:30px;font-weight:600;color:${pc};line-height:1.1;">${s.count}</div>
<div style="font-size:11px;line-height:16px;color:${EMAIL_TOKENS.textSecondary};text-transform:uppercase;letter-spacing:0.06em;margin-top:6px;">${escapeHtml(s.label)}</div>
</td>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${EMAIL_TOKENS.surface};border-radius:10px;margin-bottom:24px;border:1px solid ${EMAIL_TOKENS.borderSubtle};">
<tr>${cells}</tr>
</table>`;
}

function buildSection(title: string, contentHtml: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr><td style="padding-bottom:10px;border-bottom:1px solid ${EMAIL_TOKENS.borderSubtle};">
<span style="font-size:13px;line-height:18px;font-weight:600;color:${EMAIL_TOKENS.textPrimary};letter-spacing:0.01em;">${escapeHtml(title)}</span>
</td></tr>
<tr><td style="padding-top:12px;">
${contentHtml}
</td></tr>
</table>`;
}

function buildItemRow(linkHtml: string, metaHtml?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
<tr><td style="padding:12px 14px;background-color:${EMAIL_TOKENS.surface};border:1px solid ${EMAIL_TOKENS.borderSubtle};border-radius:10px;">
<div style="font-size:14px;line-height:20px;color:${EMAIL_TOKENS.textPrimary};">${linkHtml}</div>
${metaHtml ? `<div style="font-size:12px;line-height:18px;color:${EMAIL_TOKENS.textSecondary};margin-top:6px;">${metaHtml}</div>` : ''}
</td></tr>
</table>`;
}

function priorityBadge(priority: string): string {
  const tones: Record<string, EmailTone> = {
    blocker: 'danger',
    high: 'warning',
    normal: 'info',
    low: 'neutral',
    optional: 'neutral',
  };
  return buildToneBadge(formatStatus(priority), tones[priority] ?? 'info');
}

function statusBadge(status: string): string {
  const tones: Record<string, EmailTone> = {
    planned: 'neutral',
    open: 'neutral',
    draft: 'neutral',
    in_progress: 'info',
    pending: 'warning',
    on_hold: 'warning',
    in_testing: 'testing',
    completed: 'success',
    approved: 'success',
    done: 'success',
    cancelled: 'danger',
    rejected: 'danger',
  };
  return buildToneBadge(formatStatus(status), tones[status] ?? 'neutral');
}

function buildCtaButton(appUrl: string, pc: string, label: string): string {
  return buildActionButtons([{ label, url: appUrl }], pc, { align: 'center', marginTop: 28 });
}

// Template: Weekly Review
export function buildWeeklyReviewEmail(params: {
  userName: string;
  weekLabel: string;
  appUrl: string;
  tasksClosed: Array<{ id: string; title: string }>;
  projectsWithChanges: Array<{ id: string; name: string; oldStatus: string; newStatus: string }>;
  tasksClosedOnProjects: Array<{ id: string; title: string; projectName: string }>;
  topTasks: Array<{ id: string; title: string; priority: string; dueDate?: string }>;
  topProjectsAsLead: Array<{ id: string; name: string; status: string }>;
  topProjectsAsContributor: Array<{ id: string; name: string; status: string }>;
  newRequests: Array<{ id: string; name: string }>;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const subject = interpolate(strings.notifications.weeklyReview.subject, {
    weekLabel: params.weekLabel,
  });
  const preferencesUrl = params.appUrl + '/settings/notifications';

  const hasContent =
    params.tasksClosed.length > 0 ||
    params.projectsWithChanges.length > 0 ||
    params.tasksClosedOnProjects.length > 0 ||
    params.topTasks.length > 0 ||
    params.topProjectsAsLead.length > 0 ||
    params.topProjectsAsContributor.length > 0 ||
    params.newRequests.length > 0;

  let body = buildEmailIntro({
    eyebrow: params.weekLabel,
    title: subject,
    summaryHtml: `<p style="margin:0;">${interpolate(strings.notifications.weeklyReview.introHtml, {
      userName: escapeHtml(params.userName),
      weekLabel: escapeHtml(params.weekLabel),
    })}</p>`,
  });

  if (!hasContent) {
    body += buildSurfacePanel({
      marginTop: 8,
      padding: 24,
      contentHtml: `<p style="margin:0;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(strings.notifications.weeklyReview.empty)}</p>`,
    });
    body += buildCtaButton(params.appUrl, pc, strings.common.buttons.goToKanap);
    const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });
    const text = joinTextBlocks([
      interpolate(strings.notifications.weeklyReview.introText, {
        userName: params.userName,
        weekLabel: params.weekLabel,
      }),
      strings.notifications.weeklyReview.empty,
      `${strings.common.buttons.goToKanap}: ${params.appUrl}`,
      buildManagePreferencesText(params.locale, preferencesUrl),
    ]);
    return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
  }

  // Stats bar
  body += buildStatsBar([
    { label: strings.notifications.weeklyReview.stats.completed, count: params.tasksClosed.length },
    { label: strings.notifications.weeklyReview.stats.statusChanges, count: params.projectsWithChanges.length },
    { label: strings.notifications.weeklyReview.stats.openTasks, count: params.topTasks.length },
  ], pc);

  // Section 1: Tasks You Completed
  if (params.tasksClosed.length > 0) {
    const items = params.tasksClosed
      .map((t) =>
        buildItemRow(`<a href="${params.appUrl}/tasks/${t.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(t.title)}</a>`),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.tasksCompleted, items);
  }

  // Section 2: Project Status Changes
  if (params.projectsWithChanges.length > 0) {
    const items = params.projectsWithChanges
      .map((p) =>
        buildItemRow(
          `<a href="${params.appUrl}/portfolio/projects/${p.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(p.name)}</a>`,
          `${statusBadge(p.oldStatus)} &rarr; ${statusBadge(p.newStatus)}`,
        ),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.projectStatusChanges, items);
  }

  // Section 3: Tasks Completed on Your Projects
  if (params.tasksClosedOnProjects.length > 0) {
    const items = params.tasksClosedOnProjects
      .map((t) =>
        buildItemRow(
          `<a href="${params.appUrl}/tasks/${t.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(t.title)}</a>`,
          escapeHtml(t.projectName),
        ),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.tasksCompletedOnProjects, items);
  }

  // Section 4: Your Top Priority Tasks
  if (params.topTasks.length > 0) {
    const items = params.topTasks
      .map((t) => {
        const due = t.dueDate
          ? escapeHtml(interpolate(strings.notifications.weeklyReview.dueLabel, { dueDate: t.dueDate }))
          : '';
        const meta = [priorityBadge(t.priority), due].filter(Boolean).join(' &middot; ');
        return buildItemRow(
          `<a href="${params.appUrl}/tasks/${t.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(t.title)}</a>`,
          meta,
        );
      })
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.topTasks, items);
  }

  // Section 5: Projects You Lead
  if (params.topProjectsAsLead.length > 0) {
    const items = params.topProjectsAsLead
      .map((p) =>
        buildItemRow(
          `<a href="${params.appUrl}/portfolio/projects/${p.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(p.name)}</a>`,
          statusBadge(p.status),
        ),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.projectsLead, items);
  }

  // Section 6: Projects You Contribute To
  if (params.topProjectsAsContributor.length > 0) {
    const items = params.topProjectsAsContributor
      .map((p) =>
        buildItemRow(
          `<a href="${params.appUrl}/portfolio/projects/${p.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(p.name)}</a>`,
          statusBadge(p.status),
        ),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.projectsContribute, items);
  }

  // Section 7: New Requests
  if (params.newRequests.length > 0) {
    const items = params.newRequests
      .map((r) =>
        buildItemRow(`<a href="${params.appUrl}/portfolio/requests/${r.id}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(r.name)}</a>`),
      )
      .join('');
    body += buildSection(strings.notifications.weeklyReview.sections.newRequests, items);
  }

  body += buildCtaButton(params.appUrl, pc, strings.common.buttons.goToKanap);

  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  // Build plaintext fallback
  let text = `${subject}\n\n`;
  text += `${interpolate(strings.notifications.weeklyReview.introText, {
    userName: params.userName,
    weekLabel: params.weekLabel,
  })}\n\n`;

  if (params.tasksClosed.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.tasksCompleted} (${params.tasksClosed.length})\n`;
    for (const t of params.tasksClosed) {
      text += `  - ${t.title}: ${params.appUrl}/tasks/${t.id}\n`;
    }
    text += '\n';
  }

  if (params.projectsWithChanges.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.projectStatusChanges} (${params.projectsWithChanges.length})\n`;
    for (const p of params.projectsWithChanges) {
      text += `  - ${p.name}: ${formatStatus(p.oldStatus)} -> ${formatStatus(p.newStatus)}: ${params.appUrl}/portfolio/projects/${p.id}\n`;
    }
    text += '\n';
  }

  if (params.tasksClosedOnProjects.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.tasksCompletedOnProjects} (${params.tasksClosedOnProjects.length})\n`;
    for (const t of params.tasksClosedOnProjects) {
      text += `  - ${t.title} (${t.projectName}): ${params.appUrl}/tasks/${t.id}\n`;
    }
    text += '\n';
  }

  if (params.topTasks.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.topTasks} (${params.topTasks.length})\n`;
    for (const t of params.topTasks) {
      const due = t.dueDate
        ? ` (${interpolate(strings.notifications.weeklyReview.dueLabel, { dueDate: t.dueDate })})`
        : '';
      text += `  - [${formatStatus(t.priority)}] ${t.title}${due}: ${params.appUrl}/tasks/${t.id}\n`;
    }
    text += '\n';
  }

  if (params.topProjectsAsLead.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.projectsLead} (${params.topProjectsAsLead.length})\n`;
    for (const p of params.topProjectsAsLead) {
      text += `  - ${p.name} (${formatStatus(p.status)}): ${params.appUrl}/portfolio/projects/${p.id}\n`;
    }
    text += '\n';
  }

  if (params.topProjectsAsContributor.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.projectsContribute} (${params.topProjectsAsContributor.length})\n`;
    for (const p of params.topProjectsAsContributor) {
      text += `  - ${p.name} (${formatStatus(p.status)}): ${params.appUrl}/portfolio/projects/${p.id}\n`;
    }
    text += '\n';
  }

  if (params.newRequests.length > 0) {
    text += `${strings.notifications.weeklyReview.sections.newRequests} (${params.newRequests.length})\n`;
    for (const r of params.newRequests) {
      text += `  - ${r.name}: ${params.appUrl}/portfolio/requests/${r.id}\n`;
    }
    text += '\n';
  }

  text += `${strings.common.buttons.goToKanap}: ${params.appUrl}\n\n`;
  text += buildManagePreferencesText(params.locale, preferencesUrl);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Trial Activation Email
export function buildActivationEmail(params: {
  greeting: string;
  activationUrl: string;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const subject = strings.auth.activation.subject;
  const body = `
    ${buildEmailIntro({
      title: subject,
      summaryHtml: `<p style="margin:0 0 10px 0;">${interpolate(strings.common.labels.greetingHelloName, { name: escapeHtml(params.greeting) })}</p><p style="margin:0;">${strings.auth.activation.intro}</p>`,
    })}
    ${buildActionButtons(
      [{ label: strings.common.buttons.activateWorkspace, url: params.activationUrl }],
      DEFAULT_EMAIL_PRIMARY_COLOR,
    )}
    ${buildUrlPanel(strings.auth.activation.copyPaste, params.activationUrl, DEFAULT_EMAIL_PRIMARY_COLOR)}
    ${buildSurfacePanel({
      marginTop: 20,
      tone: 'warning',
      contentHtml: `<p style="margin:0;">${interpolate(strings.auth.activation.expires, {})}</p>`,
    })}
  `;
  // Activation emails always use KANAP default branding (no tenant yet)
  const wrapper = emailWrapper(body, { locale: params.locale });
  const text = joinTextBlocks([
    interpolate(strings.common.labels.greetingHelloName, { name: params.greeting }),
    strings.auth.activation.textIntro,
    interpolate(strings.auth.activation.textAction, { url: params.activationUrl }),
    strings.auth.activation.expires,
  ]);
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Contact Form (internal to support@kanap.net)
export function buildContactFormEmail(params: {
  name: string;
  email: string;
  company: string;
  message: string;
}): EmailContent {
  const subject = `Contact form submission from ${params.name} (${params.company})`;
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Contact',
      title: 'New contact form submission',
      summaryHtml: `<p style="margin:0;color:${EMAIL_TOKENS.textSecondary};">A new website contact form has been submitted.</p>`,
    })}
    ${buildDataPanel([
      { label: 'Name', value: params.name },
      { label: 'Email', value: params.email },
      { label: 'Company', value: params.company },
    ])}
    ${buildSurfacePanel({
      marginTop: 20,
      contentHtml: `<div style="white-space:pre-wrap;color:${EMAIL_TOKENS.textPrimary};">${escapeHtml(params.message)}</div>`,
      labelHtml: 'Message',
    })}
  `;
  const wrapper = emailWrapper(body);
  const text =
    `New contact form submission\n\n` +
    `Name: ${params.name}\nEmail: ${params.email}\nCompany: ${params.company}\n\n` +
    `Message:\n${params.message}`;
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Enterprise Support Admin Notification (internal)
export function buildSupportRequestEmail(params: {
  companyName: string;
  contactName: string;
  billingEmail: string;
  country: string;
  vatId?: string;
}): EmailContent {
  const subject = `New Enterprise Support request: ${params.companyName}`;
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Support',
      title: 'New Enterprise Support request',
      summaryHtml: `<p style="margin:0;color:${EMAIL_TOKENS.textSecondary};">A new enterprise billing/support request is waiting for review.</p>`,
    })}
    ${buildDataPanel([
      { label: 'Company', value: params.companyName },
      { label: 'Contact', value: params.contactName },
      { label: 'Email', value: params.billingEmail },
      { label: 'Country', value: params.country },
      { label: 'VAT', value: params.vatId || 'N/A' },
    ])}
  `;
  const wrapper = emailWrapper(body);
  const text =
    `Company: ${params.companyName}\nContact: ${params.contactName}\n` +
    `Email: ${params.billingEmail}\nCountry: ${params.country}\n` +
    `VAT: ${params.vatId || 'N/A'}`;
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: New Tenant Admin Notification (internal)
export function buildNewTenantNotificationEmail(params: {
  tenantName: string;
  slug: string;
  email: string;
  countryIso: string;
}): EmailContent {
  const subject = `New tenant created: ${params.tenantName} (${params.slug})`;
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Tenant',
      title: 'New tenant created',
      summaryHtml: `<p style="margin:0;color:${EMAIL_TOKENS.textSecondary};">A new tenant has been provisioned from self-service signup.</p>`,
    })}
    ${buildDataPanel([
      { label: 'Name', value: params.tenantName },
      { label: 'Slug', value: params.slug, mono: true },
      { label: 'Registered email', value: params.email },
      { label: 'Country', value: params.countryIso },
    ])}
  `;
  const wrapper = emailWrapper(body);
  const text =
    `New tenant created\n\nName: ${params.tenantName}\nSlug: ${params.slug}\n` +
    `Registered email: ${params.email}\nCountry: ${params.countryIso}`;
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

export function buildSsoUserProvisionedEmail(params: {
  userName: string;
  userEmail: string;
  usersUrl: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const s = strings.auth.ssoUserProvisioned;
  const pc = getPrimaryColor(params.branding);

  const body = `
    ${buildEmailIntro({
      title: s.heading,
      summaryHtml: `<p style="margin:0;">${interpolate(s.bodyHtml, {
        userName: escapeHtml(params.userName),
        userEmail: escapeHtml(params.userEmail),
      })}</p>`,
    })}
    ${buildActionButtons([{ label: s.cta, url: params.usersUrl }], pc)}
  `;
  const wrapper = emailWrapper(body, { branding: params.branding, locale: params.locale });

  const text = joinTextBlocks([
    interpolate(s.text, {
      userName: params.userName,
      userEmail: params.userEmail,
      url: params.usersUrl,
    }),
  ]);

  return { subject: s.subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

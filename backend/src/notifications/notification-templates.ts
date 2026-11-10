/**
 * Email template functions for notifications.
 * Each returns { subject, html, text, attachments } for use with EmailService.
 */
import type { EmailAttachment } from '../email/email.service';
import type { EmailBranding } from '../email/email-branding';
import { DEFAULT_EMAIL_PRIMARY_COLOR, getDefaultEmailBranding } from '../email/email-branding';
import { getEmailStrings, interpolate, resolveEmailLocale } from '../i18n/email-i18n';
import { PRODUCT_NAME } from '../config/product';
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
/** A value the locale has no label for, readable: `in_progress` gives "In progress". */
function humanize(value: string): string {
  const text = value.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

type StatusItemType = 'request' | 'project' | 'task' | 'contract' | 'opex' | 'capex';
const STATUS_FAMILY: Record<StatusItemType, keyof EmailStrings['common']['statuses']> = {
  request: 'request',
  project: 'project',
  task: 'task',
  contract: 'lifecycle',
  opex: 'lifecycle',
  capex: 'lifecycle',
};

/** A status as the application names it, in the reader's language. */
function statusLabel(strings: EmailStrings, itemType: StatusItemType, status: string): string {
  const labels: Record<string, string> = strings.common.statuses[STATUS_FAMILY[itemType]];
  return labels[status] ?? humanize(status);
}

function priorityLabel(strings: EmailStrings, priority: string): string {
  const labels: Record<string, string> = strings.common.priorities;
  return labels[priority] ?? humanize(priority);
}

/**
 * A team role of a request or project: a sponsor or a lead ('Business Sponsor', 'IT Lead'), or a
 * team ('business_team', 'it_team'), which the sentences name differently.
 */
function teamRole(strings: EmailStrings, role: string): { team: boolean; label: string } {
  const key = role.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const teams: Record<string, string> = strings.common.teams;
  if (teams[key]) return { team: true, label: teams[key] };
  const roles: Record<string, string> = strings.common.teamRoles;
  return { team: false, label: roles[key] ?? humanize(role) };
}

/** The language of the dates: British English for English. */
export function dateLanguage(locale?: string | null): string {
  const language = resolveEmailLocale(locale);
  return language === 'en' ? 'en-GB' : language;
}

/**
 * A calendar day in the reader's language ("20 November 2026"): a `YYYY-MM-DD` string, or the
 * `Date` a PostgreSQL `date` column gives (midnight, local time).
 */
export function formatEmailDate(value: string | Date, locale?: string | null): string {
  let day: number | null = null;
  if (value instanceof Date) {
    day = Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match) day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  if (day === null || Number.isNaN(day)) return String(value);
  return new Intl.DateTimeFormat(dateLanguage(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(day);
}

/** How long a link stays valid, in the reader's language: "7 days", "1 hour", "60 minutes". */
export function formatEmailDuration(minutes: number, locale?: string | null): string {
  const labels = getEmailStrings(locale).common.labels;
  const day = 24 * 60;
  if (minutes >= day && minutes % day === 0) {
    return minutes === day ? labels.oneDay : interpolate(labels.days, { count: minutes / day });
  }
  if (minutes >= 60 && minutes % 60 === 0 && minutes !== 60) return interpolate(labels.hours, { count: minutes / 60 });
  if (minutes === 60) return labels.oneHour;
  return interpolate(labels.minutes, { count: minutes });
}

type SentenceValue = string | { name: string } | { strong: string };

/**
 * A sentence of the locale, in HTML and in text: a `name` (a record) is bold in the HTML and quoted
 * in the text, a `strong` value (a person, a status) bold in the HTML only, a plain value as it is.
 */
function sentence(strings: EmailStrings, template: string, values: Record<string, SentenceValue>): { html: string; text: string } {
  const html = escapeHtml(template).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) return '';
    if (typeof value === 'string') return escapeHtml(value);
    return `<strong>${escapeHtml('name' in value ? value.name : value.strong)}</strong>`;
  });
  const text = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = values[key];
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    return 'name' in value ? quoted(strings, value.name) : value.strong;
  });
  return { html, text };
}

function quoted(strings: EmailStrings, value: string): string {
  return interpolate(strings.common.labels.quoted, { value });
}

/** The buttons of an e-mail in its text version, one per line. */
function buttonsText(strings: EmailStrings, buttons: ActionButton[]): string {
  return buttons.map((button) => interpolate(strings.common.labels.linkText, { label: button.label, url: button.url })).join('\n');
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

function joinTextBlocks(lines: Array<string | null | undefined>): string {
  return lines.filter((line): line is string => Boolean(line && line.trim().length > 0)).join('\n\n');
}

/** The name that identifies the workspace in an e-mail: its organisation name, else the product name. */
export function emailWorkspaceName(branding?: EmailBranding): string {
  return branding?.organisationName || PRODUCT_NAME;
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
 * Returns { html, attachments }; the logo the header shows is included as a CID inline attachment.
 * The header shows the tenant's logo, else its organisation name, else the product logo; the footer
 * says "Powered by" the product, once.
 * `footer` (the trial e-mails): a line under "Powered by", followed by a link that takes the place
 * of the notification preferences link (the unsubscribe link).
 */
export function emailWrapper(
  body: string,
  options?: {
    preferencesUrl?: string;
    branding?: EmailBranding;
    locale?: string;
    footer?: { note?: string; link?: ActionButton };
  },
): EmailWrapperResult {
  const branding = options?.branding ?? getDefaultEmailBranding();
  const strings = getEmailStrings(options?.locale);
  const pc = getPrimaryColor(branding);
  const organisationName = branding.organisationName ?? null;
  // A tenant without its own logo is named in text rather than shown under the product logo.
  const hasLogo = branding.logoBuffer.length > 0 && (branding.hasTenantLogo || !organisationName);
  const logoAlt = branding.hasTenantLogo ? emailWorkspaceName(branding) : PRODUCT_NAME;
  const footerLink = options?.footer?.link
    ?? (options?.preferencesUrl ? { label: strings.common.footer.managePreferencesLink, url: options.preferencesUrl } : null);
  const linkHtml = footerLink
    ? `<a href="${escapeHtml(footerLink.url)}" style="color:${pc};text-decoration:none;font-size:11px;line-height:16px;">${escapeHtml(footerLink.label)}</a>`
    : '';
  // With a note, the link follows it ("why this message. Stop receiving them"); else it sits on the right.
  const note = options?.footer?.note;
  const preferencesLink = note ? '' : linkHtml;
  const footerNote = note
    ? `<tr><td colspan="2" style="padding-top:8px;font-size:11px;line-height:16px;color:${EMAIL_TOKENS.textTertiary};">${escapeHtml(note)}${linkHtml ? ` ${linkHtml}` : ''}</td></tr>`
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
    ? `<img src="cid:${branding.logoCid}" alt="${escapeHtml(logoAlt)}" height="26" style="display:block;height:26px;width:auto;max-width:180px;" />`
    : `<span style="font-size:16px;line-height:26px;font-weight:600;color:${EMAIL_TOKENS.textPrimary};">${escapeHtml(emailWorkspaceName(branding))}</span>`}
</td>
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
${footerNote}
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
  itemType: StatusItemType;
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
  const s = strings.notifications.statusChange;
  const newStatus = statusLabel(strings, params.itemType, params.newStatus);
  const change = sentence(strings, s.sentences[params.itemType], {
    itemName: { name: params.itemName },
    oldStatus: { strong: statusLabel(strings, params.itemType, params.oldStatus) },
    newStatus: { strong: newStatus },
  });

  const subject = interpolate(s.subject, { itemName: params.itemName, newStatus });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const actionButtons = params.actionButtons && params.actionButtons.length > 0
    ? params.actionButtons
    : [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(s.heading, { newStatus }),
    })}
    ${buildSurfacePanel({
      tone: 'info',
      contentHtml: `<p style="margin:0;">${change.html}</p>`,
    })}
    ${buildActionButtons(actionButtons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    change.text,
    buttonsText(strings, actionButtons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Status Change with Comment
export function buildStatusChangeWithCommentEmail(params: {
  itemType: StatusItemType;
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
  const s = strings.notifications.statusChange;
  const c = strings.notifications.statusChangeWithComment;
  const newStatus = statusLabel(strings, params.itemType, params.newStatus);
  const change = sentence(strings, s.sentences[params.itemType], {
    itemName: { name: params.itemName },
    oldStatus: { strong: statusLabel(strings, params.itemType, params.oldStatus) },
    newStatus: { strong: newStatus },
  });

  const subject = interpolate(s.subject, { itemName: params.itemName, newStatus });
  const safeHtml = params.commentHtml || strings.common.labels.noCommentContentHtml;
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const actionButtons = params.actionButtons && params.actionButtons.length > 0
    ? params.actionButtons
    : [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(s.heading, { newStatus }),
    })}
    ${buildSurfacePanel({
      tone: 'info',
      contentHtml: `<p style="margin:0;">${change.html}</p>`,
    })}
    ${buildSurfacePanel({
      marginTop: 20,
      labelHtml: escapeHtml(interpolate(c.commentLabel, { authorName: params.authorName })),
      contentHtml: safeHtml,
    })}
    ${buildActionButtons(actionButtons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    change.text,
    interpolate(c.commentText, {
      authorName: params.authorName,
      comment: quoted(strings, params.commentTextPreview),
    }),
    buttonsText(strings, actionButtons),
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
  const s = strings.notifications.teamAdded;
  const role = teamRole(strings, params.role);
  const joined = role.team
    ? sentence(strings, s.teamSentences[params.itemType], { itemName: { name: params.itemName }, team: { strong: role.label } })
    : sentence(strings, s.sentences[params.itemType], { itemName: { name: params.itemName }, role: { strong: role.label } });

  const subject = interpolate(s.subjects[params.itemType], { itemName: params.itemName });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const buttons = [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: subject,
      summaryHtml: `<p style="margin:0;">${joined.html}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    joined.text,
    buttonsText(strings, buttons),
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
  const s = strings.notifications.teamMemberAdded;
  const role = teamRole(strings, params.role);
  const values = { addedUserName: { strong: params.addedUserName }, itemName: { name: params.itemName } };
  const joined = role.team
    ? sentence(strings, s.teamSentences[params.itemType], { ...values, team: { strong: role.label } })
    : sentence(strings, s.sentences[params.itemType], { ...values, role: { strong: role.label } });

  const subject = interpolate(s.subjects[params.itemType], { addedUserName: params.addedUserName, itemName: params.itemName });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const buttons = [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: subject,
      summaryHtml: `<p style="margin:0;">${joined.html}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    joined.text,
    buttonsText(strings, buttons),
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
  const s = strings.notifications.comment;
  const intro = sentence(strings, s.intros[params.itemType], {
    authorName: { strong: params.authorName },
    itemName: { name: params.itemName },
  });

  const subject = interpolate(s.subjects[params.itemType], { authorName: params.authorName, itemName: params.itemName });
  const safeHtml = params.commentHtml || strings.common.labels.noCommentContentHtml;
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const buttons = [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: s.heading,
      summaryHtml: `<p style="margin:0;">${intro.html}</p>`,
    })}
    ${buildSurfacePanel({
      marginTop: 20,
      contentHtml: safeHtml,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    `${intro.text} ${quoted(strings, params.commentTextPreview)}`,
    buttonsText(strings, buttons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Share Item
export function buildShareEmail(params: {
  itemType: ItemTypeLabelKey;
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
  const s = strings.notifications.share;
  const shared = sentence(strings, s.sentence, {
    senderName: { strong: params.senderName },
    theItem: typeLabel.the,
    itemName: { name: params.itemName },
  });

  const subject = interpolate(s.subject, {
    senderName: params.senderName,
    theItem: typeLabel.the,
    itemName: params.itemName,
  });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const buttons = [{ label: typeLabel.view, url: params.itemUrl }];

  const messageBlock = params.message
    ? buildSurfacePanel({
      marginTop: 20,
      contentHtml: `<div style="white-space:pre-wrap;">${escapeHtml(params.message)}</div>`,
    })
    : '';

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(s.heading, { senderName: params.senderName }),
      summaryHtml: `<p style="margin:0;">${shared.html}</p>`,
    })}
    ${messageBlock}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    shared.text,
    params.message
      ? interpolate(strings.common.labels.message, { message: quoted(strings, params.message) })
      : null,
    buttonsText(strings, buttons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Task Assigned
export function buildTaskAssignedEmail(params: {
  taskTitle: string;
  taskUrl: string;
  assignerName: string;
  /** A calendar day, `YYYY-MM-DD`. */
  dueDate?: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const taskType = strings.common.itemTypes.task;
  const s = strings.notifications.taskAssigned;
  const assigned = sentence(strings, s.sentence, {
    assignerName: { strong: params.assignerName },
    taskTitle: { name: params.taskTitle },
  });
  const due = params.dueDate
    ? sentence(strings, strings.common.labels.dueDate, { value: { strong: formatEmailDate(params.dueDate, params.locale) } })
    : null;
  const subject = interpolate(s.subject, {
    assignerName: params.assignerName,
    taskTitle: params.taskTitle,
  });
  const preferencesUrl = getBaseUrl(params.taskUrl) + '/settings/notifications';
  const buttons = [{ label: taskType.view, url: params.taskUrl }];

  const duePanel = due
    ? buildSurfacePanel({
      marginTop: 20,
      tone: 'info',
      contentHtml: `<p style="margin:0;">${due.html}</p>`,
    })
    : '';

  const body = `
    ${buildEmailIntro({
      eyebrow: taskType.label,
      title: s.heading,
      summaryHtml: `<p style="margin:0;">${assigned.html}</p>`,
    })}
    ${duePanel}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    assigned.text,
    due?.text,
    buttonsText(strings, buttons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

/** A document e-mail: its reference and title as one name. */
function documentName(params: { documentRef: string; documentTitle: string }): string {
  return [params.documentRef, params.documentTitle].filter(Boolean).join(' ');
}

/** The body of a document e-mail: the reference above, a title, one sentence, a panel, the button. */
function buildDocumentEmail(params: {
  strings: EmailStrings;
  documentRef: string;
  documentUrl?: string | null;
  subject: string;
  heading: string;
  sentence: { html: string; text: string };
  panelHtml?: string;
  textExtra?: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const pc = getPrimaryColor(params.branding);
  const preferencesUrl = params.documentUrl ? `${getBaseUrl(params.documentUrl)}/settings/notifications` : undefined;
  const buttons = params.documentUrl ? [{ label: params.strings.common.labels.openDocument, url: params.documentUrl }] : [];
  const body = `
    ${buildEmailIntro({
      eyebrow: params.documentRef,
      title: params.heading,
      summaryHtml: `<p style="margin:0;">${params.sentence.html}</p>`,
    })}
    ${params.panelHtml ?? ''}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding: params.branding, locale: params.locale });
  const text = joinTextBlocks([
    params.textExtra ? `${params.sentence.text} ${params.textExtra}` : params.sentence.text,
    buttonsText(params.strings, buttons),
    preferencesUrl ? buildManagePreferencesText(params.locale, preferencesUrl) : null,
  ]);
  return { subject: params.subject, html: wrapper.html, text, attachments: wrapper.attachments };
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
  const s = strings.knowledge.requested;
  const review = params.stage === 'review';
  return buildDocumentEmail({
    ...params,
    strings,
    subject: interpolate(review ? s.subjectReview : s.subjectApproval, {
      documentRef: params.documentRef,
      documentTitle: params.documentTitle,
    }),
    heading: review ? s.headingReview : s.headingApproval,
    sentence: sentence(strings, review ? s.sentenceReview : s.sentenceApproval, {
      requesterName: { strong: params.requesterName },
      document: { name: documentName(params) },
    }),
  });
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
  const s = strings.knowledge.approved;
  return buildDocumentEmail({
    ...params,
    strings,
    subject: interpolate(s.subject, { documentRef: params.documentRef, documentTitle: params.documentTitle }),
    heading: s.heading,
    sentence: sentence(strings, s.sentence, { document: { name: documentName(params) } }),
  });
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
  const s = strings.knowledge.changesRequested;
  return buildDocumentEmail({
    ...params,
    strings,
    subject: interpolate(s.subject, { documentRef: params.documentRef, documentTitle: params.documentTitle }),
    heading: s.heading,
    sentence: sentence(strings, s.intro, {
      actorName: { strong: params.actorName },
      document: { name: documentName(params) },
    }),
    panelHtml: buildSurfacePanel({
      marginTop: 20,
      tone: 'warning',
      contentHtml: `<div style="white-space:pre-wrap;">${escapeHtml(params.comment)}</div>`,
    }),
    textExtra: quoted(strings, params.comment),
  });
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
  const s = strings.knowledge.cancelled;
  return buildDocumentEmail({
    ...params,
    strings,
    subject: interpolate(s.subject, { documentRef: params.documentRef, documentTitle: params.documentTitle }),
    heading: s.heading,
    sentence: sentence(strings, s.sentence, {
      actorName: { strong: params.actorName },
      document: { name: documentName(params) },
    }),
  });
}

// Template: Expiration Warning
export function buildExpirationWarningEmail(params: {
  itemType: 'contract' | 'opex' | 'capex';
  itemName: string;
  itemUrl: string;
  /** A calendar day, `YYYY-MM-DD` (or the `Date` of a `date` column). */
  expirationDate: string | Date;
  daysRemaining: number;
  warningType: 'expiration' | 'cancellation_deadline';
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const typeLabel = getItemTypeStrings(strings, params.itemType);
  const warnings = strings.notifications.expirationWarning;
  const s = params.warningType === 'cancellation_deadline'
    ? warnings.cancellation
    : (params.itemType === 'contract' ? warnings.contractEnd : warnings.budgetLineEnd);
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const labels = strings.common.labels;
  const when = params.daysRemaining === 1 ? labels.tomorrow : interpolate(labels.inDays, { count: params.daysRemaining });
  const warned = sentence(strings, s.sentence, {
    itemName: { name: params.itemName },
    date: { strong: formatEmailDate(params.expirationDate, params.locale) },
  });

  const subject = interpolate(s.subject, { itemName: params.itemName, when });
  const preferencesUrl = getBaseUrl(params.itemUrl) + '/settings/notifications';
  const buttons = [{ label: typeLabel.view, url: params.itemUrl }];

  const body = `
    ${buildEmailIntro({
      eyebrow: typeLabel.label,
      title: interpolate(s.heading, { when }),
      badgeHtml: buildToneBadge(s.badge, 'warning'),
      summaryHtml: `<p style="margin:0;">${warned.html}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  const text = joinTextBlocks([
    warned.text,
    buttonsText(strings, buttons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

/** One CVE found on one technology, for the vulnerability notification (lot T6b). */
export type VulnerabilityDigestItem = {
  cveId: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none' | null;
  /** Known to be exploited (CISA KEV or EU KEV), whatever the severity. */
  exploited?: boolean;
  /** Found earlier, and entered a catalog of exploited CVE since: said "now known to be exploited". */
  nowExploited?: boolean;
  score: number | null;
  summary: string | null;
  technologyName: string;
  technologyReference: string;
  /** The concerned versions; null is a link that names no version (potentially concerned). */
  versions: Array<string | null>;
};

/** The lines of a vulnerability email; the others are counted and left to the page. */
export const VULNERABILITY_DIGEST_MAX_ITEMS = 25;

/**
 * The vulnerabilities newly found on the technologies a user owns for IT (critical or high, or
 * known to be exploited): one email per recipient and per run of the feed, every CVE listed once
 * per technology, at most `VULNERABILITY_DIGEST_MAX_ITEMS` lines then "and N more" (the button
 * comes before the list).
 */
export function buildVulnerabilityDigestEmail(params: {
  items: VulnerabilityDigestItem[];
  pageUrl: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const s = strings.notifications.vulnerabilities;
  const pc = getPrimaryColor(params.branding);
  const count = params.items.length;
  const preferencesUrl = getBaseUrl(params.pageUrl) + '/settings/notifications';
  const score = new Intl.NumberFormat(dateLanguage(params.locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const intro = count === 1 ? s.introOne : interpolate(s.intro, { count });
  const buttons = [{ label: s.view, url: params.pageUrl }];
  const versionsOf = (item: VulnerabilityDigestItem) =>
    interpolate(s.versions, { versions: item.versions.map((v) => v ?? s.unknownVersion).join(', ') });
  const severityOf = (item: VulnerabilityDigestItem) => {
    const name = item.severity && item.severity in s.severities ? item.severity : 'unknown';
    const label = `${s.severities[name]}${item.score != null ? ` ${score.format(item.score)}` : ''}`;
    if (!item.exploited) return label;
    return `${label} · ${item.nowExploited ? s.nowExploited : s.exploited}`;
  };
  const shortSummary = (summary: string | null) => {
    const text = (summary ?? '').trim();
    return text.length > 220 ? `${text.slice(0, 219)}…` : text;
  };

  const shown = params.items.slice(0, VULNERABILITY_DIGEST_MAX_ITEMS);
  const more = count - shown.length;
  const moreText = more > 0 ? interpolate(s.more, { count: more }) : null;
  const rows = shown.map((item) => buildItemRow(
    `<span style="font-family:${EMAIL_MONO_FONT};">${escapeHtml(item.cveId)}</span> · ${escapeHtml(item.technologyReference)} ${escapeHtml(item.technologyName)}`,
    [escapeHtml(severityOf(item)), escapeHtml(versionsOf(item)), shortSummary(item.summary) ? escapeHtml(shortSummary(item.summary)) : null]
      .filter(Boolean)
      .join('<br>'),
  )).join('');

  const body = `
    ${buildEmailIntro({
      title: s.heading,
      badgeHtml: buildToneBadge(String(count), 'warning'),
      summaryHtml: `<p style="margin:0;">${escapeHtml(intro)}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
    ${rows}
    ${moreText ? `<p style="margin:8px 0 0 0;font-size:13px;line-height:20px;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(moreText)}</p>` : ''}
  `;
  const wrapper = emailWrapper(body, { preferencesUrl, branding: params.branding, locale: params.locale });

  const text = joinTextBlocks([
    intro,
    ...shown.map((item) => [
      `${item.cveId} · ${item.technologyReference} ${item.technologyName}`,
      severityOf(item),
      versionsOf(item),
    ].join(' · ')),
    moreText,
    buttonsText(strings, buttons),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  const subject = count === 1 ? s.subjectOne : interpolate(s.subject, { count });
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

function priorityBadge(strings: EmailStrings, priority: string): string {
  const tones: Record<string, EmailTone> = {
    blocker: 'danger',
    high: 'warning',
    normal: 'info',
    low: 'neutral',
    optional: 'neutral',
  };
  return buildToneBadge(priorityLabel(strings, priority), tones[priority] ?? 'info');
}

function statusBadge(strings: EmailStrings, status: string): string {
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
  return buildToneBadge(statusLabel(strings, 'project', status), tones[status] ?? 'neutral');
}

function buildCtaButton(appUrl: string, pc: string, label: string): string {
  return buildActionButtons([{ label, url: appUrl }], pc, { align: 'center', marginTop: 28 });
}

/** The week of a weekly review, "from 2 to 8 November": its first and last days, `YYYY-MM-DD`. */
function weekRange(strings: EmailStrings, locale: string | undefined, start: string, end: string): string {
  const day = (value: string) => {
    const [year, month, date] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, date));
  };
  const format = (date: Date, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(dateLanguage(locale), { ...options, timeZone: 'UTC' }).format(date);
  const first = day(start);
  const last = day(end);
  const range = strings.notifications.weeklyReview.range;
  if (first.getUTCMonth() === last.getUTCMonth()) {
    return interpolate(range.sameMonth, {
      startDay: format(first, { day: 'numeric' }),
      endDay: format(last, { day: 'numeric' }),
      month: format(last, { month: 'long' }),
    });
  }
  return interpolate(range.twoMonths, {
    start: format(first, { day: 'numeric', month: 'long' }),
    end: format(last, { day: 'numeric', month: 'long' }),
  });
}

/** Template: Weekly Review. Null for a week with nothing to report: no e-mail is sent. */
export function buildWeeklyReviewEmail(params: {
  firstName: string | null;
  /** The first and the last day of the week, `YYYY-MM-DD`, in the reader's time zone. */
  weekStart: string;
  weekEnd: string;
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
}): EmailContent | null {
  const hasContent =
    params.tasksClosed.length > 0 ||
    params.projectsWithChanges.length > 0 ||
    params.tasksClosedOnProjects.length > 0 ||
    params.topTasks.length > 0 ||
    params.topProjectsAsLead.length > 0 ||
    params.topProjectsAsContributor.length > 0 ||
    params.newRequests.length > 0;
  if (!hasContent) return null;

  const strings = getEmailStrings(params.locale);
  const s = strings.notifications.weeklyReview;
  const branding = params.branding;
  const pc = getPrimaryColor(branding);
  const range = weekRange(strings, params.locale, params.weekStart, params.weekEnd);
  const subject = interpolate(s.subject, { range, organisation: emailWorkspaceName(branding) });
  const intro = params.firstName ? interpolate(s.intro, { userName: params.firstName }) : s.introNoName;
  const openWorkspace = interpolate(strings.common.buttons.openWorkspace, { organisation: emailWorkspaceName(branding) });
  const preferencesUrl = params.appUrl + '/settings/notifications';
  const taskUrl = (id: string) => `${params.appUrl}/portfolio/tasks/${id}`;
  const projectUrl = (id: string) => `${params.appUrl}/portfolio/projects/${id}`;
  const requestUrl = (id: string) => `${params.appUrl}/portfolio/requests/${id}`;
  const link = (url: string, label: string) =>
    `<a href="${escapeHtml(url)}" style="color:${pc};text-decoration:none;font-weight:600;">${escapeHtml(label)}</a>`;
  const projectStatus = (status: string) => statusLabel(strings, 'project', status);
  const dueOf = (dueDate: string) => interpolate(s.dueLabel, { dueDate: formatEmailDate(dueDate, params.locale) });

  let body = buildEmailIntro({
    title: interpolate(s.heading, { range }),
    summaryHtml: `<p style="margin:0;">${escapeHtml(intro)}</p>`,
  });

  // Stats bar
  body += buildStatsBar([
    { label: s.stats.completed, count: params.tasksClosed.length },
    { label: s.stats.statusChanges, count: params.projectsWithChanges.length },
    { label: s.stats.openTasks, count: params.topTasks.length },
  ], pc);

  // Section 1: Tasks You Completed
  if (params.tasksClosed.length > 0) {
    const items = params.tasksClosed.map((t) => buildItemRow(link(taskUrl(t.id), t.title))).join('');
    body += buildSection(s.sections.tasksCompleted, items);
  }

  // Section 2: Project Status Changes
  if (params.projectsWithChanges.length > 0) {
    const items = params.projectsWithChanges
      .map((p) => buildItemRow(link(projectUrl(p.id), p.name), `${statusBadge(strings, p.oldStatus)} &rarr; ${statusBadge(strings, p.newStatus)}`))
      .join('');
    body += buildSection(s.sections.projectStatusChanges, items);
  }

  // Section 3: Tasks Completed on Your Projects
  if (params.tasksClosedOnProjects.length > 0) {
    const items = params.tasksClosedOnProjects
      .map((t) => buildItemRow(link(taskUrl(t.id), t.title), escapeHtml(t.projectName)))
      .join('');
    body += buildSection(s.sections.tasksCompletedOnProjects, items);
  }

  // Section 4: Your Top Priority Tasks
  if (params.topTasks.length > 0) {
    const items = params.topTasks
      .map((t) => {
        const meta = [priorityBadge(strings, t.priority), t.dueDate ? escapeHtml(dueOf(t.dueDate)) : ''].filter(Boolean).join(' &middot; ');
        return buildItemRow(link(taskUrl(t.id), t.title), meta);
      })
      .join('');
    body += buildSection(s.sections.topTasks, items);
  }

  // Section 5: Projects You Lead
  if (params.topProjectsAsLead.length > 0) {
    const items = params.topProjectsAsLead
      .map((p) => buildItemRow(link(projectUrl(p.id), p.name), statusBadge(strings, p.status)))
      .join('');
    body += buildSection(s.sections.projectsLead, items);
  }

  // Section 6: Projects You Contribute To
  if (params.topProjectsAsContributor.length > 0) {
    const items = params.topProjectsAsContributor
      .map((p) => buildItemRow(link(projectUrl(p.id), p.name), statusBadge(strings, p.status)))
      .join('');
    body += buildSection(s.sections.projectsContribute, items);
  }

  // Section 7: New Requests
  if (params.newRequests.length > 0) {
    const items = params.newRequests.map((r) => buildItemRow(link(requestUrl(r.id), r.name))).join('');
    body += buildSection(s.sections.newRequests, items);
  }

  body += buildCtaButton(params.appUrl, pc, openWorkspace);

  const wrapper = emailWrapper(body, { preferencesUrl, branding, locale: params.locale });

  // Plain-text version: one block per section, one line per record.
  const section = (title: string, lines: string[]) => (lines.length > 0 ? `${title} (${lines.length})\n${lines.map((line) => `  - ${line}`).join('\n')}` : null);
  const linkLine = (label: string, url: string) => interpolate(strings.common.labels.linkText, { label, url });
  const text = joinTextBlocks([
    subject,
    intro,
    section(s.sections.tasksCompleted, params.tasksClosed.map((t) => linkLine(t.title, taskUrl(t.id)))),
    section(s.sections.projectStatusChanges, params.projectsWithChanges.map((p) =>
      linkLine(`${p.name} (${projectStatus(p.oldStatus)} → ${projectStatus(p.newStatus)})`, projectUrl(p.id)))),
    section(s.sections.tasksCompletedOnProjects, params.tasksClosedOnProjects.map((t) => linkLine(`${t.title} (${t.projectName})`, taskUrl(t.id)))),
    section(s.sections.topTasks, params.topTasks.map((t) =>
      linkLine(`[${priorityLabel(strings, t.priority)}] ${t.title}${t.dueDate ? ` (${dueOf(t.dueDate)})` : ''}`, taskUrl(t.id)))),
    section(s.sections.projectsLead, params.topProjectsAsLead.map((p) => linkLine(`${p.name} (${projectStatus(p.status)})`, projectUrl(p.id)))),
    section(s.sections.projectsContribute, params.topProjectsAsContributor.map((p) => linkLine(`${p.name} (${projectStatus(p.status)})`, projectUrl(p.id)))),
    section(s.sections.newRequests, params.newRequests.map((r) => linkLine(r.name, requestUrl(r.id)))),
    linkLine(openWorkspace, params.appUrl),
    buildManagePreferencesText(params.locale, preferencesUrl),
  ]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

/** Paragraphs of a letter: the text colour, one paragraph per text (not the grey summary). */
export function buildParagraphs(texts: string[]): string {
  return texts.map((text) => `<p style="margin:0 0 14px 0;">${escapeHtml(text)}</p>`).join('\n');
}

// Template: Trial Activation Email
export function buildActivationEmail(params: {
  greeting: string;
  activationUrl: string;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const s = strings.auth.activation;
  const labels = strings.common.labels;
  const greeting = interpolate(labels.greetingHelloName, { name: params.greeting });
  const button = { label: strings.common.buttons.activateWorkspace, url: params.activationUrl };
  const body = `
    ${buildEmailIntro({ title: s.subject })}
    ${buildParagraphs([greeting, s.intro, s.sample])}
    ${buildActionButtons([button], DEFAULT_EMAIL_PRIMARY_COLOR, { marginTop: 4 })}
    ${buildUrlPanel(labels.copyLink, params.activationUrl, DEFAULT_EMAIL_PRIMARY_COLOR)}
    <p style="margin:20px 0 14px 0;">${escapeHtml(s.ignore)}</p>
  `;
  // Activation emails always use the product's default branding (no tenant yet)
  const wrapper = emailWrapper(body, { locale: params.locale });
  const text = joinTextBlocks([greeting, s.intro, s.sample, buttonsText(strings, [button]), s.ignore]);
  return { subject: s.subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

/** The rows of an internal e-mail, as a data panel and as text lines. */
function internalRows(rows: Array<{ label: string; value: string; mono?: boolean; url?: string }>): { html: string; text: string } {
  return {
    html: buildDataPanel(rows.map((row) => (row.url
      ? { label: row.label, value: `<a href="${escapeHtml(row.url)}" style="color:${DEFAULT_EMAIL_PRIMARY_COLOR};text-decoration:none;">${escapeHtml(row.value)}</a>`, html: true }
      : row))),
    text: rows.map((row) => `${row.label}: ${row.value}${row.url ? ` (${row.url})` : ''}`).join('\n'),
  };
}

// Template: Contact Form (internal to contact@kadratis.com)
export function buildContactFormEmail(params: {
  name: string;
  email: string;
  company: string;
  message: string;
  /** The language of the site page the form was sent from. */
  language?: string | null;
}): EmailContent {
  const subject = `Contact form: ${params.name} (${params.company})`;
  const rows = internalRows([
    { label: 'Name', value: params.name },
    { label: 'Email', value: params.email },
    { label: 'Company', value: params.company },
    { label: 'Language', value: params.language || 'N/A' },
  ]);
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Contact',
      title: 'New contact form submission',
    })}
    ${rows.html}
    ${buildSurfacePanel({
      marginTop: 20,
      contentHtml: `<div style="white-space:pre-wrap;color:${EMAIL_TOKENS.textPrimary};">${escapeHtml(params.message)}</div>`,
      labelHtml: 'Message',
    })}
  `;
  const wrapper = emailWrapper(body);
  const text = `New contact form submission\n\n${rows.text}\n\nMessage:\n${params.message}`;
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: Enterprise Support Admin Notification (internal)
export function buildSupportRequestEmail(params: {
  companyName: string;
  contactName: string;
  billingEmail: string;
  country: string;
  vatId?: string;
  /** The first invoice in the Stripe dashboard. */
  invoiceUrl?: string | null;
  invoiceId?: string | null;
}): EmailContent {
  const subject = `Enterprise Support ordered: ${params.companyName}`;
  const summary = `The annual Enterprise Support subscription is created and Stripe has sent its first invoice to ${params.billingEmail}.`;
  const rows = internalRows([
    { label: 'Company', value: params.companyName },
    { label: 'Contact', value: params.contactName },
    { label: 'Email', value: params.billingEmail },
    { label: 'Country', value: params.country },
    { label: 'VAT', value: params.vatId || 'N/A' },
    params.invoiceUrl
      ? { label: 'Invoice', value: params.invoiceId || params.invoiceUrl, url: params.invoiceUrl }
      : { label: 'Invoice', value: 'N/A' },
  ]);
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Support',
      title: 'Enterprise Support ordered',
      summaryHtml: `<p style="margin:0;color:${EMAIL_TOKENS.textSecondary};">${escapeHtml(summary)}</p>`,
    })}
    ${rows.html}
  `;
  const wrapper = emailWrapper(body);
  const text = `${summary}\n\n${rows.text}`;
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

// Template: New Tenant Admin Notification (internal)
export function buildNewTenantNotificationEmail(params: {
  tenantName: string;
  slug: string;
  adminName?: string | null;
  email: string;
  language?: string | null;
  countryIso: string;
  /** The trials page of the platform administration. */
  trialsUrl?: string | null;
}): EmailContent {
  const subject = `New trial: ${params.tenantName} (${params.slug})`;
  const rows = internalRows([
    { label: 'Name', value: params.tenantName },
    { label: 'Slug', value: params.slug, mono: true },
    { label: 'Administrator', value: params.adminName ? `${params.adminName} (${params.email})` : params.email },
    { label: 'Language', value: params.language || 'N/A' },
    { label: 'Country', value: params.countryIso },
  ]);
  const buttons = params.trialsUrl ? [{ label: 'Open trials', url: params.trialsUrl }] : [];
  const body = `
    ${buildEmailIntro({
      eyebrow: 'Trial',
      title: 'New trial',
    })}
    ${rows.html}
    ${buildActionButtons(buttons, DEFAULT_EMAIL_PRIMARY_COLOR)}
  `;
  const wrapper = emailWrapper(body);
  const text = [`New trial\n\n${rows.text}`, ...buttons.map((button) => `${button.label}: ${button.url}`)].join('\n\n');
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
  const subject = interpolate(s.subject, { userName: params.userName });
  const provisioned = sentence(strings, s.sentence, { userName: { strong: params.userName }, userEmail: params.userEmail });
  const buttons = [{ label: s.cta, url: params.usersUrl }];

  const body = `
    ${buildEmailIntro({
      title: subject,
      summaryHtml: `<p style="margin:0;">${provisioned.html}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { branding: params.branding, locale: params.locale });
  const text = joinTextBlocks([provisioned.text, buttonsText(strings, buttons)]);

  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

/** The date and time of a workspace event in an e-mail, in the reader's language, in UTC. */
export function formatEmailDateTime(date: Date, locale?: string): string {
  const language = (locale || 'en') === 'en' ? 'en-GB' : locale || 'en-GB';
  const text = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date);
  return `${text} UTC`;
}

export function buildWorkspaceResetEmail(params: {
  actorName: string;
  workspaceName: string;
  resetAt: Date;
  workspaceUrl: string;
  branding?: EmailBranding;
  locale?: string;
}): EmailContent {
  const strings = getEmailStrings(params.locale);
  const s = strings.workspace.reset;
  const pc = getPrimaryColor(params.branding);
  const reset = sentence(strings, s.sentence, {
    actorName: { strong: params.actorName },
    workspaceName: { name: params.workspaceName },
    date: formatEmailDateTime(params.resetAt, params.locale),
  });
  const subject = interpolate(s.subject, { organisation: emailWorkspaceName(params.branding) });
  const buttons = [{ label: s.cta, url: params.workspaceUrl }];

  const body = `
    ${buildEmailIntro({
      title: subject,
      summaryHtml: `<p style="margin:0;">${reset.html}</p>`,
    })}
    ${buildActionButtons(buttons, pc)}
  `;
  const wrapper = emailWrapper(body, { branding: params.branding, locale: params.locale });
  const text = joinTextBlocks([reset.text, buttonsText(strings, buttons)]);
  return { subject, html: wrapper.html, text, attachments: wrapper.attachments };
}

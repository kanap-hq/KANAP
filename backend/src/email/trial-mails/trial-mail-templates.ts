import { buildActionButtons, buildEmailIntro, dateLanguage, emailWrapper, type ActionButton, type EmailContent } from '../../notifications/notification-templates';
import { getEmailStrings, interpolate, resolveEmailLocale, type SupportedEmailLocale } from '../../i18n/email-i18n';
import type { EmailStrings } from '../../i18n/email-locales/en';
import { DEFAULT_EMAIL_PRIMARY_COLOR } from '../email-branding';
import { PLANS } from '../../billing/plans.config';

/**
 * The trial e-mails (`doc/trial-mails.md`), in the style of the KANAP e-mails (`emailWrapper`):
 * a letter signed by Friedrich, one button at most, an HTML and a text version. The texts are in
 * `trialMails` of the e-mail locales. Nothing here reads the workspace: every value comes in the
 * parameters.
 */

export const TRIAL_ANGLES = ['budget', 'cartography', 'portfolio'] as const;
export type TrialAngle = typeof TRIAL_ANGLES[number];
export type TrialMode = 'example' | 'own_data';

const DOC_BASE_URL = 'https://doc.kanap.net';
const SUPPORT_EMAIL = 'support@kanap.net';
/**
 * A sign-up trial ends at the last instant of a UTC day (`trialEndFromSignup`), and its deletion
 * date follows it: dates are written as that UTC day, the day the app shows.
 */
const DATE_TIME_ZONE = 'UTC';

/** The guides of the first steps, by angle and mode (`doc/help/docs/<lang>/first-steps/`). */
const GUIDE_ANGLE: Record<TrialAngle, string> = { budget: 'budget', cartography: 'landscape', portfolio: 'portfolio' };
const GUIDE_MODE: Record<TrialMode, string> = { example: 'example', own_data: 'own-data' };

/**
 * A link in the text. The text version writes `label (address)`; `bare`: the address alone (or
 * the label of a `mailto:` link); `line`: the address alone, on a line of its own.
 */
type Link = { link: ActionButton; bare?: boolean; line?: boolean };
type Strong = { strong: string };
type Value = string | Link | Strong;
type Block = { text: string; values?: Record<string, Value> } | { list: Block[] } | { button: ActionButton };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** An address as a reader sees it: no scheme, no trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^mailto:/, '').replace(/\/$/, '');
}

function docPrefix(locale: SupportedEmailLocale): string {
  return locale === 'en' ? '' : `/${locale}`;
}

export function trialGuideUrl(locale: string, angle: TrialAngle, mode: TrialMode | null): string {
  const lang = resolveEmailLocale(locale);
  return `${DOC_BASE_URL}${docPrefix(lang)}/first-steps/${GUIDE_ANGLE[angle]}-${GUIDE_MODE[mode ?? 'example']}/`;
}

export function onPremiseInstallUrl(locale: string): string {
  return `${DOC_BASE_URL}${docPrefix(resolveEmailLocale(locale))}/on-premise/installation/`;
}

export function offerUrl(locale: string, marketingUrl: string): string {
  return `${marketingUrl.replace(/\/$/, '')}${docPrefix(resolveEmailLocale(locale))}/offer`;
}

export function formatTrialDate(locale: string, date: Date): string {
  // Written like the dates of the notifications: "23 November 2026" in English.
  return new Intl.DateTimeFormat(dateLanguage(locale), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: DATE_TIME_ZONE,
  }).format(date);
}

function formatEuros(locale: string, cents: number): string {
  return new Intl.NumberFormat(resolveEmailLocale(locale), {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100);
}

class Letter {
  readonly locale: SupportedEmailLocale;
  readonly strings: EmailStrings;
  readonly blocks: Block[] = [];

  constructor(locale: string) {
    this.locale = resolveEmailLocale(locale);
    this.strings = getEmailStrings(this.locale);
  }

  paragraph(text: string, values?: Record<string, Value>): this {
    this.blocks.push({ text, values });
    return this;
  }

  list(items: Array<{ text: string; values?: Record<string, Value> }>): this {
    this.blocks.push({ list: items });
    return this;
  }

  button(button: ActionButton | null): this {
    if (button) this.blocks.push({ button });
    return this;
  }

  private html(block: Block): string {
    if ('button' in block) return `<div style="margin:4px 0 12px 0;">${buildActionButtons([block.button], DEFAULT_EMAIL_PRIMARY_COLOR, { marginTop: 0 })}</div>`;
    if ('list' in block) {
      return `<ul style="margin:0 0 14px 0;padding-left:20px;">${block.list.map((item) => `<li style="margin:0 0 6px 0;">${this.html(item)}</li>`).join('')}</ul>`;
    }
    const html = escapeHtml(block.text).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = block.values?.[key];
      if (value === undefined) return '';
      if (typeof value === 'string') return escapeHtml(value);
      if ('strong' in value) return `<strong>${escapeHtml(value.strong)}</strong>`;
      return `<a href="${escapeHtml(value.link.url)}" style="color:${DEFAULT_EMAIL_PRIMARY_COLOR};text-decoration:none;">${escapeHtml(value.link.label)}</a>`;
    });
    return html;
  }

  private text(block: Block): string {
    const linkText = this.strings.common.labels.linkText;
    if ('button' in block) return interpolate(linkText, { label: block.button.label, url: block.button.url });
    if ('list' in block) return block.list.map((item) => `- ${this.text(item)}`).join('\n');
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(block.values ?? {})) {
      if (typeof value === 'string') vars[key] = value;
      else if ('strong' in value) vars[key] = value.strong;
      else {
        const { label, url } = value.link;
        if (value.line) vars[key] = `\n${url}`;
        else if (value.bare || label === displayUrl(url)) vars[key] = url.startsWith('mailto:') ? label : url;
        // A link already between parentheses: no second pair around its address.
        else if (block.text.includes(`({{${key}}})`)) vars[key] = interpolate(linkText, { label, url });
        else vars[key] = `${label} (${url})`;
      }
    }
    // An address on a line of its own leaves no space at the end of the line before it.
    return interpolate(block.text, vars).replace(/[ \u00a0\u202f]+\n/g, '\n');
  }

  /**
   * The e-mail: optional title, greeting, the blocks, the signature. `unsubscribeUrl` puts the
   * trial footer (why this message, the unsubscribe link); without it the footer is the plain one.
   */
  render(params: { subject: string; title: boolean; firstName: string | null; unsubscribeUrl: string | null }): EmailContent {
    const common = this.strings.common.labels;
    const t = this.strings.trialMails;
    const greeting = params.firstName
      ? interpolate(common.greetingHelloName, { name: params.firstName })
      : common.greetingHello;
    // The greeting holds the person's name: a value, never a template.
    const blocks: Block[] = [
      { text: '{{greeting}}', values: { greeting } },
      ...this.blocks,
      { text: t.signOff },
      { text: t.signature },
    ];
    const paragraph = (inner: string) => `<p style="margin:0 0 14px 0;">${inner}</p>`;
    const body = [
      params.title ? buildEmailIntro({ title: params.subject }) : '',
      ...blocks.map((block) => ('text' in block ? paragraph(this.html(block)) : this.html(block))),
    ].join('\n');
    const footer = params.unsubscribeUrl
      ? { note: t.footer.reason, link: { label: t.footer.unsubscribe, url: params.unsubscribeUrl } }
      : undefined;
    const wrapper = emailWrapper(body, { locale: this.locale, footer });
    const text = [
      ...blocks.map((block) => this.text(block)),
      params.unsubscribeUrl ? `--\n${t.footer.reason}\n${interpolate(t.footer.unsubscribeText, { url: params.unsubscribeUrl })}` : null,
    ].filter(Boolean).join('\n\n');
    return { subject: params.subject, html: wrapper.html, text, attachments: wrapper.attachments };
  }
}

export type TrialMailCommon = {
  locale: string;
  firstName: string | null;
  workspace: string;
  /** The workspace's address (`https://<slug>.kanap.net`). */
  appUrl: string;
};

/** The discovery call link of an e-mail: the click is counted (`/trial-mails/call`), then Cal.com. */
export type TrialCallLink = { url: string; display: string } | null;

function pathLinks(letter: Letter, mode: TrialMode | null, angles: readonly TrialAngle[]): Record<string, Link> {
  const names = letter.strings.trialMails.pathNames;
  return Object.fromEntries(angles.map((angle) => [angle, { link: { label: names[angle], url: trialGuideUrl(letter.locale, angle, mode) } }]));
}

/** J0: the welcome, after the choice of a path (or an hour after the first sign-in without one). */
export function buildTrialWelcomeEmail(params: TrialMailCommon & {
  angle: TrialAngle | null;
  mode: TrialMode | null;
  call: TrialCallLink;
  unsubscribeUrl: string;
}): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails.j0;
  letter.paragraph(t.ready, { workspace: params.workspace });
  if (params.angle) {
    const others = TRIAL_ANGLES.filter((angle) => angle !== params.angle);
    const links = pathLinks(letter, params.mode, others);
    letter.paragraph(t.angle, {
      angle: letter.strings.trialMails.angleChosen[params.angle],
      guide: { link: { label: t.guide, url: trialGuideUrl(letter.locale, params.angle, params.mode) } },
      other1: links[others[0]],
      other2: links[others[1]],
    });
  } else {
    letter.paragraph(t.noAngle, pathLinks(letter, params.mode, TRIAL_ANGLES));
  }
  if (params.call) {
    letter.paragraph(t.call).button({ label: t.button, url: params.call.url });
  }
  letter.paragraph(params.call ? t.reply : t.replyAlone);
  return letter.render({ subject: t.subject, title: true, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
}

/** J+5: the personal note, sent only when no discovery call is booked. No button. */
export function buildTrialFollowUpEmail(params: TrialMailCommon & {
  mode: TrialMode | null;
  call: TrialCallLink;
  unsubscribeUrl: string;
}): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails.j5;
  letter.paragraph(t.question);
  letter.paragraph(params.call ? `${t.paths} ${t.call}` : t.paths, {
    ...pathLinks(letter, params.mode, TRIAL_ANGLES),
    ...(params.call ? { call: { link: { label: params.call.display, url: params.call.url }, line: true } } : {}),
  });
  letter.paragraph(t.available);
  return letter.render({ subject: t.subject, title: false, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
}

/** J+12: the trial ends in two days, and the two ways to go on. */
export function buildTrialEndingEmail(params: TrialMailCommon & {
  trialEnd: Date;
  marketingUrl: string;
  unsubscribeUrl: string;
}): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails.j12;
  const prices = PLANS.max.prices;
  letter
    .paragraph(t.end, { date: formatTrialDate(letter.locale, params.trialEnd) })
    .paragraph(t.options)
    .list([
      {
        text: t.hosted,
        values: { label: { strong: t.hostedLabel }, monthly: formatEuros(letter.locale, prices.monthly), annual: formatEuros(letter.locale, prices.annual) },
      },
      {
        text: t.onPremise,
        values: {
          label: { strong: t.onPremiseLabel },
          install: { link: { label: letter.strings.trialMails.installGuide, url: onPremiseInstallUrl(letter.locale) } },
          offer: { link: { label: t.offer, url: offerUrl(letter.locale, params.marketingUrl) } },
        },
      },
    ])
    .button({ label: t.button, url: `${params.appUrl}/admin/billing` })
    .paragraph(t.closing);
  return letter.render({ subject: t.subject, title: true, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
}

/** The end-of-trial notice, when the workspace locks: the deletion date and the open question. */
export function buildTrialEndedEmail(params: TrialMailCommon & {
  deletionDate: Date;
  unsubscribeUrl: string;
}): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails;
  letter
    .paragraph(t.ended.body, {
      date: formatTrialDate(letter.locale, params.deletionDate),
      billing: { link: { label: t.billingPath, url: `${params.appUrl}/admin/billing` }, bare: true },
      install: { link: { label: t.installGuide, url: onPremiseInstallUrl(letter.locale) } },
    })
    .paragraph(t.ended.question)
    .paragraph(t.ended.thanks);
  return letter.render({ subject: t.ended.subject, title: true, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
}

/** The thank-you at the first subscription: a service e-mail, without the unsubscribe link. */
export function buildTrialThanksEmail(params: TrialMailCommon): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails.thanks;
  letter
    .paragraph(t.body, { workspace: params.workspace })
    .paragraph(t.help, { support: { link: { label: SUPPORT_EMAIL, url: `mailto:${SUPPORT_EMAIL}` } } })
    .button({ label: t.button, url: params.appUrl });
  // The subject thanks the person: no title repeats it.
  return letter.render({ subject: t.subject, title: false, firstName: params.firstName, unsubscribeUrl: null });
}

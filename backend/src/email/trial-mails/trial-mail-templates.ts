import { buildActionButtons, buildEmailIntro, emailWrapper, type ActionButton, type EmailContent } from '../../notifications/notification-templates';
import { getEmailStrings, interpolate, resolveEmailLocale, type SupportedEmailLocale } from '../../i18n/email-i18n';
import type { EmailStrings } from '../../i18n/email-locales/en';
import { DEFAULT_EMAIL_PRIMARY_COLOR } from '../email-branding';
import { PLANS } from '../../billing/plans.config';
import type { DiscoveryCallTiming } from '../../discovery-call/discovery-call.service';

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
/** Dates are written as a day of the calendar of KANAP's customers. */
const DATE_TIME_ZONE = 'Europe/Paris';

/** The guides of the first steps, by angle and mode (`doc/help/docs/<lang>/first-steps/`). */
const GUIDE_ANGLE: Record<TrialAngle, string> = { budget: 'budget', cartography: 'landscape', portfolio: 'portfolio' };
const GUIDE_MODE: Record<TrialMode, string> = { example: 'example', own_data: 'own-data' };

type Link = { link: ActionButton; bare?: boolean };
type Strong = { strong: string };
type Value = string | Link | Strong;
type Block = { text: string; values?: Record<string, Value> } | { list: Block[] } | { button: ActionButton };

const NO_BREAK_SPACE = ' ';
const NARROW_NO_BREAK_SPACE = ' ';

/** French typography, as the application applies it (`frontend/src/i18n/formatters.ts`). */
export function frenchSpacing(value: string): string {
  return value
    .replace(/« /g, `«${NO_BREAK_SPACE}`)
    .replace(/ »/g, `${NO_BREAK_SPACE}»`)
    .replace(/ :/g, `${NO_BREAK_SPACE}:`)
    .replace(/ ([;!?])/g, `${NARROW_NO_BREAK_SPACE}$1`);
}

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
  return new Intl.DateTimeFormat(resolveEmailLocale(locale), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: DATE_TIME_ZONE,
  }).format(date);
}

function formatEuros(locale: string, cents: number): string {
  return new Intl.NumberFormat(resolveEmailLocale(locale), {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(cents / 100);
}

const urlLink = (url: string): Link => ({ link: { label: displayUrl(url), url } });

class Letter {
  readonly locale: SupportedEmailLocale;
  readonly strings: EmailStrings;
  readonly blocks: Block[] = [];

  constructor(locale: string) {
    this.locale = resolveEmailLocale(locale);
    this.strings = getEmailStrings(this.locale);
  }

  /** A template of the locale: French typography applies to the text, never to the values. */
  private template(text: string): string {
    return this.locale === 'fr' ? frenchSpacing(text) : text;
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
    const html = escapeHtml(this.template(block.text)).replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const value = block.values?.[key];
      if (value === undefined) return '';
      if (typeof value === 'string') return escapeHtml(value);
      if ('strong' in value) return `<strong>${escapeHtml(this.template(value.strong))}</strong>`;
      return `<a href="${escapeHtml(value.link.url)}" style="color:${DEFAULT_EMAIL_PRIMARY_COLOR};text-decoration:none;">${escapeHtml(this.template(value.link.label))}</a>`;
    });
    return html;
  }

  private text(block: Block): string {
    if ('button' in block) return this.locale === 'fr' ? frenchSpacing(`${block.button.label} : ${block.button.url}`) : `${block.button.label}: ${block.button.url}`;
    if ('list' in block) return block.list.map((item) => `- ${this.text(item)}`).join('\n');
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(block.values ?? {})) {
      if (typeof value === 'string') vars[key] = value;
      else if ('strong' in value) vars[key] = this.template(value.strong);
      else if (value.bare || value.link.label === displayUrl(value.link.url)) vars[key] = value.link.url;
      else vars[key] = `${this.template(value.link.label)} (${value.link.url})`;
    }
    return interpolate(this.template(block.text), vars);
  }

  /**
   * The e-mail: optional title, greeting, the blocks, the signature. `unsubscribeUrl` puts the
   * trial footer (why this message, the unsubscribe link); without it the footer is the plain one.
   */
  render(params: { subject: string; title: boolean; firstName: string | null; unsubscribeUrl: string | null }): EmailContent {
    const common = this.strings.common.labels;
    const t = this.strings.trialMails;
    const greeting = params.firstName
      ? interpolate(this.template(common.greetingHelloName), { name: params.firstName })
      : this.template(common.greetingHello);
    // The greeting holds the person's name: a value, never a template.
    const blocks: Block[] = [
      { text: '{{greeting}}', values: { greeting } },
      ...this.blocks,
      { text: t.signOff },
      { text: t.signature },
    ];
    const paragraph = (inner: string) => `<p style="margin:0 0 14px 0;">${inner}</p>`;
    const body = [
      params.title ? buildEmailIntro({ title: this.template(params.subject) }) : '',
      ...blocks.map((block) => ('text' in block ? paragraph(this.html(block)) : this.html(block))),
    ].join('\n');
    const footer = params.unsubscribeUrl
      ? { note: this.template(t.footer.reason), link: { label: this.template(t.footer.unsubscribe), url: params.unsubscribeUrl } }
      : undefined;
    const wrapper = emailWrapper(body, { locale: this.locale, footer });
    const text = [
      ...blocks.map((block) => this.text(block)),
      params.unsubscribeUrl ? `--\n${this.template(t.footer.reason)}\n${this.template(interpolate(t.footer.unsubscribeText, { url: params.unsubscribeUrl }))}` : null,
    ].filter(Boolean).join('\n\n');
    return { subject: this.template(params.subject), html: wrapper.html, text, attachments: wrapper.attachments };
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
      guide: urlLink(trialGuideUrl(letter.locale, params.angle, params.mode)),
      other1: links[others[0]],
      other2: links[others[1]],
    });
  } else {
    letter.paragraph(t.noAngle, pathLinks(letter, params.mode, TRIAL_ANGLES));
  }
  if (params.call) {
    letter.paragraph(t.call).button({ label: t.button, url: params.call.url });
  }
  letter.paragraph(t.reply);
  return letter.render({ subject: t.subject, title: true, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
}

/** J+5: the personal note, by the discovery call (to come, past, none). No button. */
export function buildTrialFollowUpEmail(params: TrialMailCommon & {
  timing: DiscoveryCallTiming;
  callDate: Date | null;
  mode: TrialMode | null;
  call: TrialCallLink;
  unsubscribeUrl: string;
}): EmailContent {
  const letter = new Letter(params.locale);
  const t = letter.strings.trialMails.j5;
  const date = params.callDate ? formatTrialDate(letter.locale, params.callDate) : '';
  let subject: string;
  if (params.timing === 'upcoming') {
    subject = t.upcoming.subject;
    letter.paragraph(t.upcoming.body, { date }).paragraph(t.upcoming.reply);
  } else if (params.timing === 'past') {
    subject = t.past.subject;
    letter.paragraph(t.past.body, { date });
  } else {
    subject = t.none.subject;
    const paths = pathLinks(letter, params.mode, TRIAL_ANGLES);
    letter.paragraph(t.none.question);
    letter.paragraph(params.call ? `${t.none.paths} ${t.none.call}` : t.none.paths, {
      ...paths,
      ...(params.call ? { call: { link: { label: params.call.display, url: params.call.url }, bare: true } } : {}),
    });
    letter.paragraph(t.none.available);
  }
  return letter.render({ subject, title: false, firstName: params.firstName, unsubscribeUrl: params.unsubscribeUrl });
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
        values: { label: { strong: t.onPremiseLabel }, install: urlLink(onPremiseInstallUrl(letter.locale)), offer: urlLink(offerUrl(letter.locale, params.marketingUrl)) },
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
      install: urlLink(onPremiseInstallUrl(letter.locale)),
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
  return letter.render({ subject: t.subject, title: true, firstName: params.firstName, unsubscribeUrl: null });
}

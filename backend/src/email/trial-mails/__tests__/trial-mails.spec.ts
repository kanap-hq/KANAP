import * as assert from 'node:assert/strict';
import {
  TrialMailFacts,
  TrialMailMilestone,
  dueTrialMail,
} from '../trial-mail-schedule';
import {
  buildTrialEndedEmail,
  buildTrialEndingEmail,
  buildTrialFollowUpEmail,
  buildTrialThanksEmail,
  buildTrialWelcomeEmail,
} from '../trial-mail-templates';
import { frenchSpacing, getEmailStrings } from '../../../i18n/email-i18n';
import { parseTrialMailLinkToken, sameLinkToken, trialMailLinkToken, trialMailLinkUrl } from '../trial-mail-links';

const escapeForHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#039;');

// The trial e-mails (`doc/trial-mails.md`) without a database:
// - the schedule: each mail at its time, never one already sent, never a missed one late, nothing
//   after the subscription but the thank-you, nothing after the unsubscription, no J+5 once a
//   discovery call is booked, no J+12 or notice when no deletion is planned;
// - the templates in the four languages: every placeholder filled, the variants, one button at
//   most (none on J+5), the unsubscribe footer except on the thank-you, French typography;
// - the link tokens: their shape, the constant-time comparison with the stored secret, the addresses.

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-02T09:00:00Z');
const END = new Date(START.getTime() + 14 * DAY);
const at = (days: number, extraMs = 0) => new Date(START.getTime() + days * DAY + extraMs);

function facts(over: Partial<TrialMailFacts> = {}): TrialMailFacts {
  return {
    subscription: 'trialing',
    trialStart: START,
    trialEnd: END,
    deletionAt: new Date(END.getTime() + 30 * DAY),
    choiceMade: false,
    firstLoginAt: null,
    sent: new Set<TrialMailMilestone>(),
    unsubscribed: false,
    callBooked: false,
    ...over,
  };
}

function testWelcomeAfterTheChoiceOrAnHourAfterTheFirstSignIn() {
  assert.equal(dueTrialMail(facts(), at(0, 10 * 60 * 1000)), null, 'nothing before a choice or a sign-in');
  assert.equal(dueTrialMail(facts({ choiceMade: true }), at(0, 10 * 60 * 1000)), 'j0');
  const firstLoginAt = at(0, 60 * 60 * 1000);
  assert.equal(dueTrialMail(facts({ firstLoginAt }), at(0, 119 * 60 * 1000)), null, 'not before the hour');
  assert.equal(dueTrialMail(facts({ firstLoginAt }), at(0, 120 * 60 * 1000)), 'j0');
  assert.equal(dueTrialMail(facts({ choiceMade: true, sent: new Set(['j0']) }), at(1)), null, 'sent once');
}

function testEachMailAtItsTimeAndNeverLate() {
  const all = { choiceMade: true };
  assert.equal(dueTrialMail(facts(all), at(4.9)), 'j0');
  assert.equal(dueTrialMail(facts(all), at(5)), 'j5', 'J0 missed: J+5 instead, never both');
  assert.equal(dueTrialMail(facts({ ...all, sent: new Set(['j0']) }), at(11.9)), 'j5');
  assert.equal(dueTrialMail(facts({ ...all, sent: new Set(['j0']) }), at(12)), 'j12', 'J+12 is two days before the end');
  assert.equal(dueTrialMail(facts({ ...all, sent: new Set(['j0', 'j5', 'j12']) }), at(13.9)), null);
  assert.equal(dueTrialMail(facts({ ...all, sent: new Set(['j0', 'j5', 'j12']) }), at(14)), 'ended');
  assert.equal(dueTrialMail(facts({ ...all, sent: new Set(['j0', 'j5', 'j12', 'ended']) }), at(15)), null);
  // The notice stops a week before the deletion (thirty days after the end).
  assert.equal(dueTrialMail(facts(all), at(14 + 22.9)), 'ended');
  assert.equal(dueTrialMail(facts(all), at(14 + 23)), null);
  // A trial extended by the platform administrator moves J+12 with its end.
  const extended = { ...all, trialEnd: at(30), deletionAt: at(60), sent: new Set<TrialMailMilestone>(['j0', 'j5']) };
  assert.equal(dueTrialMail(facts(extended), at(13)), null);
  assert.equal(dueTrialMail(facts(extended), at(28)), 'j12');
  // No deletion planned (billing not enforced, a plan set by hand): J+5 still, no J+12 or notice.
  const kept = { ...all, deletionAt: null, sent: new Set<TrialMailMilestone>(['j0']) };
  assert.equal(dueTrialMail(facts(kept), at(5)), 'j5');
  assert.equal(dueTrialMail(facts(kept), at(12)), null);
  assert.equal(dueTrialMail(facts(kept), at(15)), null);
}

function testNoFollowUpOnceACallIsBooked() {
  const booked = { choiceMade: true, callBooked: true, sent: new Set<TrialMailMilestone>(['j0']) };
  assert.equal(dueTrialMail(facts(booked), at(5)), null, 'a booked call, to come or past: no J+5');
  assert.equal(dueTrialMail(facts(booked), at(12)), 'j12', 'the rest of the sequence goes on');
  assert.equal(dueTrialMail(facts({ ...booked, callBooked: false }), at(5)), 'j5');
}

function testSubscriptionAndUnsubscription() {
  assert.equal(dueTrialMail(facts({ subscription: 'subscribed', choiceMade: true }), at(6)), 'thanks');
  assert.equal(dueTrialMail(facts({ subscription: 'subscribed', sent: new Set(['thanks']) }), at(20)), null);
  assert.equal(dueTrialMail(facts({ subscription: 'subscribed', unsubscribed: true }), at(20)), 'thanks', 'the thank-you is a service e-mail');
  assert.equal(dueTrialMail(facts({ subscription: 'other', choiceMade: true }), at(1)), null);
  assert.equal(dueTrialMail(facts({ choiceMade: true, unsubscribed: true }), at(1)), null);
  assert.equal(dueTrialMail(facts({ choiceMade: true, trialEnd: null }), at(1)), null);
}

const LOCALES = ['fr', 'en', 'de', 'es'] as const;
const APP = 'https://acme.kanap.test';
const UNSUBSCRIBE = `${APP}/api/trial-mails/unsubscribe?t=tok`;
const CALL = { url: `${APP}/api/trial-mails/call?t=tok`, display: 'cal.com/kanap/decouverte' };

function allMails(locale: string) {
  const common = { locale, firstName: 'Camille', workspace: 'Acme <IT>', appUrl: APP };
  return {
    j0Angle: buildTrialWelcomeEmail({ ...common, angle: 'cartography', mode: 'own_data', call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
    j0None: buildTrialWelcomeEmail({ ...common, angle: null, mode: null, call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
    j0NoCall: buildTrialWelcomeEmail({ ...common, angle: 'budget', mode: 'example', call: null, unsubscribeUrl: UNSUBSCRIBE }),
    j5: buildTrialFollowUpEmail({ ...common, angle: 'portfolio', mode: 'example', call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
    j5NoCall: buildTrialFollowUpEmail({ ...common, angle: null, mode: null, call: null, unsubscribeUrl: UNSUBSCRIBE }),
    j12: buildTrialEndingEmail({ ...common, trialEnd: new Date('2026-11-16T10:00:00Z'), marketingUrl: 'https://www.kanap.test', unsubscribeUrl: UNSUBSCRIBE }),
    ended: buildTrialEndedEmail({ ...common, deletionDate: new Date('2026-12-16T10:00:00Z'), unsubscribeUrl: UNSUBSCRIBE }),
    thanks: buildTrialThanksEmail(common),
  };
}

const buttons = (html: string) => (html.match(/display:inline-block;background-color:/g) ?? []).length;

function testEveryMailInEveryLanguage() {
  for (const locale of LOCALES) {
    for (const [name, mail] of Object.entries(allMails(locale))) {
      const label = `${locale} ${name}`;
      for (const part of [mail.subject, mail.html, mail.text]) {
        assert.ok(!part.includes('{{'), `${label}: a placeholder is left`);
      }
      assert.ok(mail.html.includes('Camille') && mail.text.includes('Friedrich'), `${label}: greeting and signature`);
      assert.ok(!mail.html.includes('Acme <IT>'), `${label}: the workspace name is escaped`);
      assert.ok(buttons(mail.html) <= 1, `${label}: one button at most`);
      const unsubscribes = name !== 'thanks';
      assert.equal(mail.html.includes(UNSUBSCRIBE), unsubscribes, `${label}: unsubscribe link in the footer`);
      assert.equal(mail.text.includes(UNSUBSCRIBE), unsubscribes, `${label}: unsubscribe link in the text`);
      assert.ok(!mail.html.includes('/settings/notifications'), `${label}: no preferences link`);
    }
  }
}

function testVariants() {
  for (const locale of LOCALES) {
    const mails = allMails(locale);
    assert.equal(buttons(mails.j0Angle.html), 1, `${locale}: J0 books the call`);
    assert.equal(buttons(mails.j0NoCall.html), 0, `${locale}: no booking page, no button`);
    assert.ok(!mails.j0NoCall.text.includes(CALL.url));
    // The chosen path's guide in its mode, then the two others.
    assert.ok(mails.j0Angle.text.includes('/first-steps/landscape-own-data/'), `${locale}: guide of the path`);
    // Every path link reads as words: the chosen guide by the title of its page.
    const guide = getEmailStrings(locale).trialMails.j0.guideTitles.cartography;
    assert.ok(mails.j0Angle.html.includes(`>${escapeForHtml(guide)}</a>`), `${locale}: guide link by its words`);
    assert.ok(!/>https?:\/\/doc\.kadratis\.com/.test(mails.j0Angle.html) && !/>doc\.kadratis\.com/.test(mails.j0Angle.html), `${locale}: no address as link text`);
    assert.ok(mails.j0Angle.text.includes('/first-steps/budget-own-data/') && mails.j0Angle.text.includes('/first-steps/portfolio-own-data/'));
    assert.ok(mails.j0None.text.includes('/first-steps/budget-example/') && mails.j0None.text.includes('/first-steps/landscape-example/'));
    for (const name of ['j5', 'j5NoCall'] as const) {
      assert.equal(buttons(mails[name].html), 0, `${locale} ${name}: a personal note has no button`);
    }
    // J+5 names the workspace, then the chosen path's guide by its title, or the three paths.
    assert.ok(mails.j5.text.includes('Acme <IT>'), `${locale}: J+5 names the workspace`);
    const portfolioGuide = getEmailStrings(locale).trialMails.j0.guideTitles.portfolio;
    assert.ok(mails.j5.html.includes(`>${escapeForHtml(portfolioGuide)}</a>`), `${locale}: J+5 links the chosen guide by its title`);
    assert.ok(mails.j5.text.includes('/first-steps/portfolio-example/') && !mails.j5.text.includes('/first-steps/budget-example/'));
    assert.ok(['budget', 'landscape', 'portfolio'].every((path) => mails.j5NoCall.text.includes(`/first-steps/${path}-example/`)), `${locale}: J+5 without a path offers the three`);
    // The booking page on a line of its own, read as its short address.
    assert.ok(mails.j5.text.includes(`\n${CALL.url}`), `${locale}: J+5 offers the call on its own line`);
    assert.ok(mails.j5.html.includes(`>${CALL.display}</a>`), `${locale}: the call link reads as its address`);
    assert.ok(!mails.j5NoCall.text.includes(CALL.url) && !mails.j5NoCall.html.includes(CALL.url));
    assert.ok(mails.j12.text.includes(`${APP}/admin/billing`) && mails.j12.text.includes('/on-premise/installation/'));
    assert.ok(mails.ended.text.includes('2026'), `${locale}: the deletion date`);
    assert.ok(mails.thanks.text.includes('support@kadratis.com'));
  }
  const fr = allMails('fr');
  assert.ok(fr.j12.text.includes('249 €') && fr.j12.text.includes('2 490 €'), 'French prices');
  assert.ok(fr.ended.text.includes('16 décembre 2026'));
  assert.ok(allMails('en').j12.text.includes('€2,490'));
  assert.ok(allMails('de').ended.text.includes('16. Dezember 2026'));
  // A sign-up trial ends at the last instant of a UTC day: the mail names that day, as the app does.
  const lastInstant = buildTrialEndingEmail({
    locale: 'fr', firstName: 'Camille', workspace: 'Acme', appUrl: APP,
    trialEnd: new Date('2026-11-21T23:59:59.999Z'), marketingUrl: 'https://www.kanap.test', unsubscribeUrl: UNSUBSCRIBE,
  });
  assert.ok(lastInstant.text.includes('21 novembre 2026') && !lastInstant.text.includes('22 novembre'), 'the UTC day of the end');
  assert.ok(fr.j0Angle.text.includes('/fr/first-steps/') && allMails('en').j0Angle.text.includes('doc.kadratis.com/first-steps/'));
}

function testFrenchTypography() {
  assert.equal(frenchSpacing('« Vos pas » : oui ; non ? si !'), '« Vos pas » : oui ; non ? si !');
  const fr = allMails('fr');
  assert.ok(fr.j5.subject.includes(' :') && fr.j5.subject.endsWith(' ?'));
  assert.ok(!/ [:;?!»]/.test(fr.j0Angle.text.replace(/https?:\/\/\S+/g, '')), 'no ordinary space before French punctuation');
  // English keeps its own typography.
  assert.ok(!allMails('en').j0Angle.text.includes(' '));
}

function testLinkTokens() {
  const tenant = '6f1c2b0e-4d8a-4b3e-9a51-2f0f2b6c9d10';
  const secret = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);
  const token = trialMailLinkToken(tenant.toUpperCase(), secret);
  assert.equal(token, `${tenant}.${secret}`);
  assert.deepEqual(parseTrialMailLinkToken(token), { tenantId: tenant, linkToken: secret });
  assert.deepEqual(parseTrialMailLinkToken(` ${token.toUpperCase()} `), { tenantId: tenant, linkToken: secret }, 'case and spaces from a mail client');
  for (const bad of [undefined, 42, '', 'x'.repeat(300), 'not.a.token', `${tenant}.${secret.slice(1)}`, `${tenant}.${secret}g`, `nope.${secret}`]) {
    assert.equal(parseTrialMailLinkToken(bad), null, String(bad).slice(0, 20));
  }
  // The secret is compared with the stored one: another secret, or none stored, is refused.
  assert.ok(sameLinkToken(secret, secret));
  assert.ok(!sameLinkToken(secret, `${secret.slice(0, -1)}0`));
  assert.ok(!sameLinkToken(secret, null));
  assert.equal(trialMailLinkUrl('https://acme.kanap.test/', 'unsubscribe', 'a.b'), 'https://acme.kanap.test/api/trial-mails/unsubscribe?t=a.b');
  assert.equal(trialMailLinkUrl('https://acme.kanap.test', 'call', 'a.b', { from: 'mail_j0' }), 'https://acme.kanap.test/api/trial-mails/call?t=a.b&from=mail_j0');
}

function run() {
  testWelcomeAfterTheChoiceOrAnHourAfterTheFirstSignIn();
  testEachMailAtItsTimeAndNeverLate();
  testNoFollowUpOnceACallIsBooked();
  testSubscriptionAndUnsubscription();
  testEveryMailInEveryLanguage();
  testVariants();
  testFrenchTypography();
  testLinkTokens();
  // eslint-disable-next-line no-console
  console.log('trial-mails.spec: OK (8 cases)');
}

run();

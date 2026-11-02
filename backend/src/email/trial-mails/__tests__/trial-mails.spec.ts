import * as assert from 'node:assert/strict';
import {
  TrialMailFacts,
  TrialMailMilestone,
  dueTrialMail,
  trialDeletionDate,
} from '../trial-mail-schedule';
import {
  buildTrialEndedEmail,
  buildTrialEndingEmail,
  buildTrialFollowUpEmail,
  buildTrialThanksEmail,
  buildTrialWelcomeEmail,
  frenchSpacing,
} from '../trial-mail-templates';
import { getEmailStrings } from '../../../i18n/email-i18n';
import { signTrialMailLink, trialMailLinkUrl, verifyTrialMailLink } from '../trial-mail-links';

const escapeForHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/'/g, '&#039;');

// The trial e-mails (`doc/trial-mails.md`) without a database:
// - the schedule: each mail at its time, never one already sent, never a missed one late, nothing
//   after the subscription but the thank-you, nothing after the unsubscription;
// - the templates in the four languages: every placeholder filled, the variants, one button at
//   most (none on J+5), the unsubscribe footer except on the thank-you, French typography;
// - the signed links: valid, tampered, another purpose, another key.

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-11-02T09:00:00Z');
const END = new Date(START.getTime() + 14 * DAY);
const at = (days: number, extraMs = 0) => new Date(START.getTime() + days * DAY + extraMs);

function facts(over: Partial<TrialMailFacts> = {}): TrialMailFacts {
  return {
    subscription: 'trialing',
    trialStart: START,
    trialEnd: END,
    choiceMade: false,
    firstLoginAt: null,
    sent: new Set<TrialMailMilestone>(),
    unsubscribed: false,
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
  assert.equal(dueTrialMail(facts({ ...all, trialEnd: at(30), sent: new Set(['j0', 'j5']) }), at(13)), null);
  assert.equal(dueTrialMail(facts({ ...all, trialEnd: at(30), sent: new Set(['j0', 'j5']) }), at(28)), 'j12');
  assert.equal(trialDeletionDate(END).toISOString(), at(44).toISOString());
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
    j5Upcoming: buildTrialFollowUpEmail({ ...common, timing: 'upcoming', callDate: new Date('2026-11-12T15:00:00Z'), mode: null, call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
    j5Past: buildTrialFollowUpEmail({ ...common, timing: 'past', callDate: new Date('2026-11-04T09:00:00Z'), mode: null, call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
    j5None: buildTrialFollowUpEmail({ ...common, timing: 'none', callDate: null, mode: 'example', call: CALL, unsubscribeUrl: UNSUBSCRIBE }),
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
    // Every path link reads as a name, the chosen guide by its title.
    const title = getEmailStrings(locale).trialMails.guideTitles.cartography;
    assert.ok(mails.j0Angle.html.includes(`>${escapeForHtml(locale === 'fr' ? frenchSpacing(title) : title)}</a>`), `${locale}: guide link by its title`);
    assert.ok(!/>https?:\/\/doc\.kanap\.net/.test(mails.j0Angle.html) && !/>doc\.kanap\.net/.test(mails.j0Angle.html), `${locale}: no address as link text`);
    assert.ok(mails.j0Angle.text.includes('/first-steps/budget-own-data/') && mails.j0Angle.text.includes('/first-steps/portfolio-own-data/'));
    assert.ok(mails.j0None.text.includes('/first-steps/budget-example/') && mails.j0None.text.includes('/first-steps/landscape-example/'));
    for (const name of ['j5Upcoming', 'j5Past', 'j5None'] as const) {
      assert.equal(buttons(mails[name].html), 0, `${locale} ${name}: a personal note has no button`);
    }
    assert.ok(mails.j5None.text.includes(CALL.url), `${locale}: J+5 without a call offers one`);
    assert.ok(!mails.j5Upcoming.text.includes(CALL.url) && !mails.j5Past.text.includes(CALL.url));
    assert.notEqual(mails.j5Upcoming.subject, mails.j5Past.subject);
    assert.ok(mails.j12.text.includes(`${APP}/admin/billing`) && mails.j12.text.includes('/on-premise/installation/'));
    assert.ok(mails.ended.text.includes('2026'), `${locale}: the deletion date`);
    assert.ok(mails.thanks.text.includes('support@kanap.net'));
  }
  const fr = allMails('fr');
  assert.ok(fr.j12.text.includes('249 €') && fr.j12.text.includes('2 490 €'), 'French prices');
  assert.ok(fr.ended.text.includes('16 décembre 2026'));
  assert.ok(fr.j5Upcoming.text.includes('12 novembre 2026'));
  assert.ok(allMails('en').j12.text.includes('€2,490'));
  assert.ok(allMails('de').ended.text.includes('16. Dezember 2026'));
  assert.ok(fr.j0Angle.text.includes('/fr/first-steps/') && allMails('en').j0Angle.text.includes('doc.kanap.net/first-steps/'));
}

function testFrenchTypography() {
  assert.equal(frenchSpacing('« Vos pas » : oui ; non ? si !'), '« Vos pas » : oui ; non ? si !');
  const fr = allMails('fr');
  assert.ok(fr.j5None.subject.includes(' :') && fr.j5None.subject.endsWith(' ?'));
  assert.ok(!/ [:;?!»]/.test(fr.j0Angle.text.replace(/https?:\/\/\S+/g, '')), 'no ordinary space before French punctuation');
  // English keeps its own typography.
  assert.ok(!allMails('en').j0Angle.text.includes(' '));
}

function testSignedLinks() {
  const env = { JWT_SECRET: 'trial-mail-spec-secret' } as NodeJS.ProcessEnv;
  const tenant = '6f1c2b0e-4d8a-4b3e-9a51-2f0f2b6c9d10';
  const token = signTrialMailLink(tenant, 'unsubscribe', env);
  assert.deepEqual(verifyTrialMailLink(token, env), { tenantId: tenant, purpose: 'unsubscribe' });
  assert.deepEqual(verifyTrialMailLink(signTrialMailLink(tenant, 'mail_j5', env), env), { tenantId: tenant, purpose: 'mail_j5' });
  // Another tenant, another purpose, a tampered signature, another key: refused.
  const [, purpose, signature] = token.split('.');
  assert.equal(verifyTrialMailLink(`${tenant.replace('6f1c', '6f1d')}.${purpose}.${signature}`, env), null);
  assert.equal(verifyTrialMailLink(`${tenant}.mail_j0.${signature}`, env), null);
  assert.equal(verifyTrialMailLink(`${tenant}.${purpose}.${signature.slice(0, -2)}AA`, env), null);
  assert.equal(verifyTrialMailLink(token, { ...env, TRIAL_MAIL_LINK_SECRET: 'dedicated' } as NodeJS.ProcessEnv), null);
  assert.equal(verifyTrialMailLink(`${tenant}.anything.${signature}`, env), null);
  for (const bad of [undefined, 42, '', 'x'.repeat(300), 'not.a.token']) assert.equal(verifyTrialMailLink(bad, env), null);
  assert.equal(trialMailLinkUrl('https://acme.kanap.test/', 'call', 'a.b.c'), 'https://acme.kanap.test/api/trial-mails/call?t=a.b.c');
}

function run() {
  testWelcomeAfterTheChoiceOrAnHourAfterTheFirstSignIn();
  testEachMailAtItsTimeAndNeverLate();
  testSubscriptionAndUnsubscription();
  testEveryMailInEveryLanguage();
  testVariants();
  testFrenchTypography();
  testSignedLinks();
  // eslint-disable-next-line no-console
  console.log('trial-mails.spec: OK (7 cases)');
}

run();

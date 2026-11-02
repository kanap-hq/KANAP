import * as assert from 'node:assert/strict';
import { Logger, type LoggerService } from '@nestjs/common';
import { EmailService } from '../email.service';
import type { SendEmailOptions } from '../email.types';

/**
 * Nest prints every level, debug included, and these lines land in the application logs of every
 * installation. An e-mail log says what happened (transport, how many recipients, a redirection)
 * and never repeats an address or a subject.
 */

const SUBJECT = 'Quarterly budget review';
const ADDRESS = 'a@b.com';

const ENV_KEYS = [
  'DEPLOYMENT_MODE',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_SECURE',
  'SMTP_USER',
  'SMTP_PASSWORD',
  'SMTP_PASS',
  'SMTP_FROM',
  'EMAIL_OVERRIDE',
  'EMAIL_QUEUE_MIN_INTERVAL_MS',
  'EMAIL_RATE_LIMIT_MAX_RETRIES',
  'EMAIL_RATE_LIMIT_RETRY_BASE_MS',
  'EMAIL_RATE_LIMIT_RETRY_MAX_MS',
  'EMAIL_RATE_LIMIT_RETRY_JITTER_MS',
];

function installSpy(): string[] {
  const messages: string[] = [];
  const record = (message: unknown, ...rest: unknown[]) => {
    messages.push([message, ...rest].map((part) => String(part)).join(' '));
  };
  const logger: LoggerService = {
    log: record,
    error: record,
    warn: record,
    debug: record,
    verbose: record,
    fatal: record,
  };
  Logger.overrideLogger(logger);
  return messages;
}

function assertNoPersonalData(messages: string[]) {
  assert.ok(messages.length > 0, 'the send produced log lines');
  for (const line of messages) {
    assert.equal(line.includes('@'), false, `logged message contains an address: ${line}`);
    assert.equal(line.includes(SUBJECT), false, `logged message contains the subject: ${line}`);
  }
}

function has(messages: string[], fragment: string) {
  assert.ok(
    messages.some((line) => line.includes(fragment)),
    `missing log "${fragment}" in:\n${messages.join('\n')}`,
  );
}

interface CaptureHooks {
  /** First delivery attempt throws. The error names the recipient, so a log of it fails the spec. */
  failFirst?: boolean;
}

async function capture(override: string | null, options: SendEmailOptions, hooks: CaptureHooks = {}): Promise<{
  messages: string[];
  delivered: SendEmailOptions[];
}> {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) previous.set(key, process.env[key]);
  const messages = installSpy();
  const delivered: SendEmailOptions[] = [];
  try {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
    if (override) process.env.EMAIL_OVERRIDE = override;

    const service = new EmailService();
    let attempts = 0;
    (service as unknown as { transport: unknown }).transport = {
      name: 'smtp',
      defaultMinIntervalMs: 1,
      send: async (mail: SendEmailOptions) => {
        attempts += 1;
        if (hooks.failFirst && attempts === 1) throw new Error(`throttled for ${ADDRESS}`);
        delivered.push(mail);
      },
      getRetryDelayMs: () => (hooks.failFirst && attempts === 1 ? 1 : null),
    };

    await service.send(options);
    await service.drain(Date.now() + 5_000);
    return { messages: [...messages], delivered };
  } finally {
    Logger.overrideLogger(false);
    for (const key of ENV_KEYS) {
      const original = previous.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }
}

const mail = (to: SendEmailOptions['to']): SendEmailOptions => ({
  to,
  subject: SUBJECT,
  html: '<p>x</p>',
  text: 'x',
});

async function testSendWithoutOverride() {
  const { messages, delivered } = await capture(null, mail(ADDRESS));
  assertNoPersonalData(messages);
  has(messages, 'Sending email via smtp to 1 recipient(s)');
  assert.equal(messages.some((line) => /redirect/i.test(line)), false, 'no redirection is logged');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, ADDRESS);
  assert.equal(delivered[0].subject, SUBJECT);
}

async function testSendWithOverride() {
  const { messages, delivered } = await capture('sink@qa.test', mail(ADDRESS));
  assertNoPersonalData(messages);
  has(messages, 'Email override active: all emails will be sent to the override address');
  has(messages, 'Email redirected to the override address');
  has(messages, 'Sending email via smtp to 1 recipient(s)');
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].to, ['sink@qa.test']);
  assert.equal(delivered[0].subject, `[To: ${ADDRESS}] ${SUBJECT}`, 'the delivered message still names the original recipient');
}

async function testCountsEveryRecipient() {
  const { messages, delivered } = await capture(null, mail([ADDRESS, 'c@d.com']));
  assertNoPersonalData(messages);
  has(messages, 'Sending email via smtp to 2 recipient(s)');
  assert.deepEqual(delivered[0].to, [ADDRESS, 'c@d.com']);
}

async function testThrottleLogOmitsTheAddress() {
  const { messages, delivered } = await capture(null, mail(ADDRESS), { failFirst: true });
  assertNoPersonalData(messages);
  has(messages, 'smtp delivery throttled for 1 recipient(s); retry 1/5 in 1ms');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, ADDRESS);
}

async function main() {
  await testSendWithoutOverride();
  await testSendWithOverride();
  await testCountsEveryRecipient();
  await testThrottleLogOmitsTheAddress();
  console.log('email-log-hygiene.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

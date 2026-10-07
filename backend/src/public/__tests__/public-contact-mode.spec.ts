import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { PublicController } from '../public.controller';
import { Features } from '../../config/features';

// The contact form belongs to the marketing site of the cloud service. A single-tenant install
// answers it like the other cloud-only public routes (trial sign-up, support invoice): not found,
// before any CAPTCHA check or email. A multi-tenant install keeps checking the CAPTCHA and sending
// the message.

async function withSingleTenant(value: boolean, fn: () => Promise<void>) {
  const saved = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = value;
  try {
    await fn();
  } finally {
    (Features as any).SINGLE_TENANT = saved;
  }
}

function buildController() {
  const calls: string[] = [];
  const emails = {
    send: async (input: any) => {
      calls.push(`email:${input.to}`);
    },
  };
  const turnstile = {
    verifyOrThrow: async () => {
      calls.push('captcha');
    },
  };
  const controller = new PublicController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    emails as any,
    {} as any,
    {} as any,
    turnstile as any,
    {} as any,
    {} as any,
  );
  return { controller, calls };
}

const CONTACT_BODY = {
  name: 'Ada Example',
  email: 'ada@example.invalid',
  company: 'Example Co',
  message: 'Hello',
  captchaToken: 'captcha-token',
} as any;

const REQUEST = { ip: '127.0.0.1', headers: { host: 'kanap.example.test' } };

async function answerOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return undefined;
}

async function testSingleTenantRefusesContact() {
  await withSingleTenant(true, async () => {
    const { controller, calls } = buildController();
    const contactAnswer = await answerOf(() => controller.sendContact(CONTACT_BODY, REQUEST));
    const trialAnswer = await answerOf(() =>
      controller.startTrial({ org: 'Acme IT', slug: 'acme', email: 'owner@example.invalid' } as any, REQUEST),
    );

    assert.ok(contactAnswer instanceof NotFoundException);
    assert.ok(trialAnswer instanceof NotFoundException);
    assert.equal(contactAnswer.getStatus(), trialAnswer.getStatus());
    assert.deepEqual(contactAnswer.getResponse(), trialAnswer.getResponse());
    assert.deepEqual(calls, []);
  });
}

async function testMultiTenantSendsContact() {
  await withSingleTenant(false, async () => {
    const { controller, calls } = buildController();
    const result = await controller.sendContact(CONTACT_BODY, REQUEST);
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, ['captcha', 'email:support@kanap.net']);
  });
}

async function main() {
  await testSingleTenantRefusesContact();
  await testMultiTenantSendsContact();
  console.log('public-contact-mode.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

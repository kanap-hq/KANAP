import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { ShareItemDto, SHARE_MAX_RECIPIENTS, SHARE_MESSAGE_MAX_LENGTH } from '../dto/share-item.dto';
import { shareRecipientsOf } from '../share-recipients';
import { ShareRateLimit, ShareRateLimitGuard, shareLinkRateLimitKey } from '../share-rate-limit';
import { inertLinks } from '../share-message';
import { buildShareEmail } from '../notification-templates';
import { RATE_LIMITS } from '../../common/rate-limit';
import { consumeRateLimit, UserRateLimitGuard } from '../../common/rate-limit.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { Features } from '../../config/features';

/**
 * "Send link" (every object's `POST .../:id/share`): bounded recipient lists and message, one
 * total recipient limit in the service, a per-user rate limit declared on every share route, a
 * per-tenant budget on top of it in multi-tenant mode, and a message whose web addresses are not
 * clickable in the e-mail.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const emails = (count: number, prefix = 'person') => Array.from({ length: count }, (_, i) => `${prefix}${i}@example.com`);

function errorsOf(body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(ShareItemDto, body)).map((error) => error.property);
}

function testDtoBounds() {
  assert.equal(SHARE_MAX_RECIPIENTS, 20);
  assert.deepEqual(errorsOf({ recipient_emails: emails(20) }), [], '20 addresses are accepted');
  assert.deepEqual(errorsOf({ recipient_emails: emails(21) }), ['recipient_emails'], '21 addresses are refused');
  assert.deepEqual(
    errorsOf({ recipient_user_ids: Array.from({ length: 20 }, (_, i) => uuid(i)) }),
    [],
    '20 user ids are accepted',
  );
  assert.deepEqual(
    errorsOf({ recipient_user_ids: Array.from({ length: 21 }, (_, i) => uuid(i)) }),
    ['recipient_user_ids'],
    '21 user ids are refused',
  );
  assert.deepEqual(errorsOf({ recipient_user_ids: ['not-an-id'] }), ['recipient_user_ids'], 'user ids are UUIDs');
  assert.deepEqual(errorsOf({ recipient_emails: ['a@example.com'], message: 'x'.repeat(SHARE_MESSAGE_MAX_LENGTH) }), []);
  assert.deepEqual(
    errorsOf({ recipient_emails: ['a@example.com'], message: 'x'.repeat(SHARE_MESSAGE_MAX_LENGTH + 1) }),
    ['message'],
    'a message past the length limit is refused',
  );
}

function refusal(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BadRequestException, `expected a 400, got ${String(error)}`);
    return error.getResponse();
  }
  assert.fail('expected a 400');
}

function testTotalRecipientLimit() {
  // People and addresses count together, each list without duplicates.
  const ids = Array.from({ length: 12 }, (_, i) => uuid(i));
  assert.equal(refusal(() => shareRecipientsOf({ recipient_user_ids: ids, recipient_emails: emails(9) })).code, 'SHARE_TOO_MANY_RECIPIENTS');
  const accepted = shareRecipientsOf({ recipient_user_ids: [...ids, ids[0].toUpperCase()], recipient_emails: [...emails(8), 'PERSON0@example.com'] });
  assert.deepEqual(accepted.userIds, ids, 'duplicate ids collapse');
  assert.deepEqual(accepted.rawEmails, emails(8), 'duplicate addresses collapse, case ignored');
  // At least one recipient.
  refusal(() => shareRecipientsOf({}));
  refusal(() => shareRecipientsOf(undefined));
}

/** Every controller module of `src/`, from the source tree (ts-node) or the compiled one. */
function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...controllerFiles(full));
    else if (/\.controller\.(ts|js)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function testEveryShareRouteIsRateLimited() {
  const srcRoot = path.resolve(__dirname, '..', '..');
  const routes: string[] = [];
  for (const file of controllerFiles(srcRoot)) {
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (typeof value !== 'function') continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, value);
      if (controllerPath === undefined) continue;
      const proto = (value as any).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const routePaths = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, handler) ?? []);
        const paramTypes: unknown[] = Reflect.getMetadata('design:paramtypes', proto, name) ?? [];
        const isShareRoute = routePaths.some((p) => /(^|\/)share$/.test(p)) || paramTypes.includes(ShareItemDto);
        if (!isShareRoute) continue;
        const label: string = `${(value as any).name}.${name} (${controllerPath}/${routePaths.join(',')})`;
        routes.push(label);
        const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
        assert.ok(guards.includes(ShareRateLimitGuard), `${label} counts per user and per tenant`);
        assert.ok(guards.includes(PermissionGuard), `${label} checks the permission`);
        assert.ok(
          guards.indexOf(PermissionGuard) < guards.indexOf(ShareRateLimitGuard),
          `${label} checks the permission before counting the request`,
        );
        assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler), RATE_LIMITS.shareLink.limit, `${label} limit`);
        assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler), RATE_LIMITS.shareLink.ttl, `${label} window`);
        assert.equal(
          Reflect.getMetadata('THROTTLER:KEY_GENERATORdefault', handler),
          shareLinkRateLimitKey,
          `${label} shares the one "Send link" budget`,
        );
      }
    }
  }
  assert.ok(routes.length >= 12, `expected the 12 share routes at least, found ${routes.length}: ${routes.join('; ')}`);
  assert.deepEqual(RATE_LIMITS.shareLink, { limit: 30, ttl: 60 * 60_000 });
  assert.deepEqual(RATE_LIMITS.shareLinkTenant, { limit: 200, ttl: 60 * 60_000 });
  assert.ok(ShareRateLimitGuard.prototype instanceof UserRateLimitGuard, 'the per-user count is the one of the other user limits');
}

class ShareProbe {
  @ShareRateLimit()
  share() {}
}

/** A share request of `userId` in `tenantId`, as the guard sees it after authentication. */
function shareContext(tenantId: string, userId: string) {
  const req = { tenant: { id: tenantId }, user: { sub: userId }, ip: '203.0.113.7', headers: {} };
  const res = { header: () => res };
  return {
    getHandler: () => ShareProbe.prototype.share,
    getClass: () => ShareProbe,
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

async function shareGuard() {
  const guard = new ShareRateLimitGuard({ throttlers: [{ ttl: 60_000, limit: 10 }] }, new ThrottlerStorageService(), new Reflector());
  await guard.onModuleInit();
  return guard;
}

/** The HTTP status the guard answers: 200 when it lets the request through. */
async function statusOf(guard: ShareRateLimitGuard, tenantId: string, userId: string): Promise<number> {
  try {
    return (await guard.canActivate(shareContext(tenantId, userId))) ? 200 : 403;
  } catch (error: any) {
    return typeof error?.getStatus === 'function' ? error.getStatus() : 500;
  }
}

/** Every user of `tenantId` sends up to the per-user limit, until the tenant has sent `total`. */
async function fillTenant(guard: ShareRateLimitGuard, tenantId: string, total: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let sent = 0; sent < total; sent += 1) {
    const user = `u${Math.floor(sent / RATE_LIMITS.shareLink.limit)}`;
    statuses.push(await statusOf(guard, tenantId, user));
  }
  return statuses;
}

async function testTenantBudget() {
  const saved = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = false;
  try {
    const guard = await shareGuard();
    const limit = RATE_LIMITS.shareLinkTenant.limit;
    const statuses = await fillTenant(guard, 't1', limit);
    assert.deepEqual([...new Set(statuses)], [200], `the tenant's first ${limit} shares go, several users together`);
    assert.equal(await statusOf(guard, 't1', 'fresh-user'), HttpStatus.TOO_MANY_REQUESTS, 'past the tenant budget, a user who sent nothing is refused');
    assert.equal(await statusOf(guard, 't1', 'u0'), HttpStatus.TOO_MANY_REQUESTS, 'and so is a user who already sent');
    assert.equal(await statusOf(guard, 't2', 'fresh-user'), 200, 'another tenant keeps its own budget');
    // A user over the per-user limit is refused before the tenant count: the tenant keeps its budget.
    const other = await shareGuard();
    for (let i = 0; i < RATE_LIMITS.shareLink.limit; i += 1) assert.equal(await statusOf(other, 't3', 'busy'), 200);
    for (let i = 0; i < 50; i += 1) assert.equal(await statusOf(other, 't3', 'busy'), HttpStatus.TOO_MANY_REQUESTS);
    const rest = await fillTenant(other, 't3', limit - RATE_LIMITS.shareLink.limit);
    assert.deepEqual([...new Set(rest)], [200], 'refused requests of one user do not take the tenant budget');
  } finally {
    (Features as any).SINGLE_TENANT = saved;
  }
}

async function testNoTenantBudgetOnPremise() {
  const saved = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = true;
  try {
    const guard = await shareGuard();
    const limit = RATE_LIMITS.shareLinkTenant.limit;
    const statuses = await fillTenant(guard, 'only', limit + RATE_LIMITS.shareLink.limit);
    assert.deepEqual([...new Set(statuses)], [200], 'single-tenant: only the per-user limit applies');
    for (let i = 0; i < RATE_LIMITS.shareLink.limit; i += 1) assert.equal(await statusOf(guard, 'only', 'solo'), 200);
    assert.equal(await statusOf(guard, 'only', 'solo'), HttpStatus.TOO_MANY_REQUESTS, 'single-tenant: the per-user limit holds');
  } finally {
    (Features as any).SINGLE_TENANT = saved;
  }
}

async function testBudgetWindowReopens() {
  const storage = new ThrottlerStorageService();
  const budget = { limit: 2, ttl: 40 };
  await consumeRateLimit(storage, 'probe', budget, 'k');
  await consumeRateLimit(storage, 'probe', budget, 'k');
  await assert.rejects(consumeRateLimit(storage, 'probe', budget, 'k'), (error: any) => error?.getStatus?.() === HttpStatus.TOO_MANY_REQUESTS);
  await consumeRateLimit(storage, 'probe', budget, 'other-key');
  await new Promise((resolve) => setTimeout(resolve, 120));
  await consumeRateLimit(storage, 'probe', budget, 'k');
}

function testMessageLinksAreInert() {
  const message = [
    'Votre compte expire. Connectez-vous sur https://evil.example/login',
    'or www.example.org/path, example.com, mail me at someone@example.net',
    'HTTP://EXAMPLE.IO and xn--80ak6aa92e.com and 192.0.2.10',
    '<a href="https://evil.example">here</a>',
  ].join('\n');
  const inert = inertLinks(message);
  for (const clickable of ['https://', 'HTTP://', 'evil.example', 'www.example', 'example.org', 'example.com', 'example.net', 'example.io', '92e.com', '192.0.2.10']) {
    assert.ok(!inert.includes(clickable), `"${clickable}" no longer reads as an address: ${inert}`);
  }
  assert.ok(inert.includes('https[:]//evil[.]example/login'), inert);
  assert.ok(inert.includes('someone@example[.]net'), inert);
  // Ordinary text is left as it is.
  const plain = 'See the budget v2.0 (3.5 FTE, i.e. 12 days), e.g. by Friday. Merci !';
  assert.equal(inertLinks(plain), plain);

  const email = buildShareEmail({
    itemType: 'project',
    itemName: 'Data platform',
    itemUrl: 'https://acme.app.example/portfolio/projects/1',
    senderName: 'Ada',
    message,
    locale: 'en',
  });
  for (const part of [email.html, email.text]) {
    assert.ok(!part.includes('https://evil.example'), 'the message keeps no clickable address');
    assert.ok(part.includes('https[:]//evil[.]example/login'), 'the message keeps its words');
  }
  assert.ok(email.html.includes('href="https://acme.app.example/portfolio/projects/1"'), 'the link to the record stays');
  assert.ok(!/<a href="https:\/\/evil/.test(email.html), 'markup in the message stays text');
}

function testOneBudgetPerUser() {
  const route = (handler: string) => ({ getClass: () => ({ name: 'X' }), getHandler: () => ({ name: handler }) }) as any;
  const a = shareLinkRateLimitKey(route('shareContract'), 'user:t1:u1', 'default');
  assert.equal(a, shareLinkRateLimitKey(route('shareAsset'), 'user:t1:u1', 'default'), 'one budget across objects');
  assert.notEqual(a, shareLinkRateLimitKey(route('shareContract'), 'user:t1:u2', 'default'), 'one budget per user');
}

async function run() {
  testDtoBounds();
  testTotalRecipientLimit();
  testOneBudgetPerUser();
  testEveryShareRouteIsRateLimited();
  await testTenantBudget();
  await testNoTenantBudgetOnPremise();
  await testBudgetWindowReopens();
  testMessageLinksAreInert();
  console.log('share-limits.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

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
import { giveBackRateLimit, takeRateLimit, UserRateLimitGuard } from '../../common/rate-limit.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { Features } from '../../config/features';

/**
 * "Send link" (every object's `POST .../:id/share`): bounded recipient lists and message, one
 * total recipient limit in the service, a per-user request limit declared on every share route,
 * recipient budgets per user (both modes) and per tenant (multi-tenant mode), and a message whose
 * web addresses are not clickable in the e-mail.
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
  assert.deepEqual(RATE_LIMITS.shareLinkRecipientsPerUser, { limit: 200, ttl: 60 * 60_000 });
  assert.deepEqual(RATE_LIMITS.shareLinkRecipientsPerTenant, { limit: 1000, ttl: 60 * 60_000 });
  assert.ok(ShareRateLimitGuard.prototype instanceof UserRateLimitGuard, 'the per-user count is the one of the other user limits');
}

class ShareProbe {
  @ShareRateLimit()
  share() {}
}

/** `count` distinct addresses, unique to the call. */
let addressSeq = 0;
const freshEmails = (count: number) => Array.from({ length: count }, () => `r${addressSeq++}@example.com`);

/** A share request of `userId` in `tenantId` to `body`, as the guard sees it after authentication. */
function shareContext(tenantId: string, userId: string, body: unknown) {
  const req = { tenant: { id: tenantId }, user: { sub: userId }, ip: '203.0.113.7', headers: {}, body };
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

/** The HTTP status the guard answers to a share to `recipients` addresses: 200 when it lets the request through. */
async function statusOf(guard: ShareRateLimitGuard, tenantId: string, userId: string, recipients: number | unknown): Promise<number> {
  const body = typeof recipients === 'number' ? { recipient_emails: freshEmails(recipients) } : recipients;
  try {
    return (await guard.canActivate(shareContext(tenantId, userId, body))) ? 200 : 403;
  } catch (error: any) {
    return typeof error?.getStatus === 'function' ? error.getStatus() : 500;
  }
}

/** `userId` sends shares of 20 recipients, and a last smaller one, until `total` recipients. */
async function sendRecipients(guard: ShareRateLimitGuard, tenantId: string, userId: string, total: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let left = total; left > 0; left -= SHARE_MAX_RECIPIENTS) {
    statuses.push(await statusOf(guard, tenantId, userId, Math.min(SHARE_MAX_RECIPIENTS, left)));
  }
  return statuses;
}

const ok = (statuses: number[]) => [...new Set(statuses)].join(',') === '200';
const TOO_MANY = HttpStatus.TOO_MANY_REQUESTS;

async function withMode<T>(singleTenant: boolean, run: () => Promise<T>): Promise<T> {
  const saved = Features.SINGLE_TENANT;
  (Features as any).SINGLE_TENANT = singleTenant;
  try {
    return await run();
  } finally {
    (Features as any).SINGLE_TENANT = saved;
  }
}

/** Per user, in both modes: recipients are counted, the last request that would pass the budget is refused whole. */
async function testUserRecipientBudget(singleTenant: boolean) {
  await withMode(singleTenant, async () => {
    const mode = singleTenant ? 'single-tenant' : 'multi-tenant';
    const guard = await shareGuard();
    const perUser = RATE_LIMITS.shareLinkRecipientsPerUser.limit;
    assert.ok(ok(await sendRecipients(guard, 't1', 'ada', perUser - 10)), `${mode}: ${perUser - 10} recipients go`);
    assert.equal(await statusOf(guard, 't1', 'ada', 20), TOO_MANY, `${mode}: a share that would pass ${perUser} recipients is refused`);
    assert.equal(await statusOf(guard, 't1', 'ada', 10), 200, `${mode}: the refused share took nothing, 10 more go`);
    assert.equal(await statusOf(guard, 't1', 'ada', 1), TOO_MANY, `${mode}: the user's budget is spent`);
    assert.equal(await statusOf(guard, 't1', 'bob', 20), 200, `${mode}: another user keeps their own budget`);
    // A body the validation refuses counts nothing: the route answers 400.
    const other = await shareGuard();
    // 20 refused bodies and 10 full shares: the 30 requests of the request limit.
    for (let i = 0; i < 10; i += 1) {
      assert.equal(await statusOf(other, 't1', 'eve', { recipient_emails: freshEmails(SHARE_MAX_RECIPIENTS + 1) }), 200);
      assert.equal(await statusOf(other, 't1', 'eve', { recipient_emails: ['not an address'] }), 200);
    }
    assert.ok(ok(await sendRecipients(other, 't1', 'eve', perUser)), `${mode}: refused bodies left the budget whole`);
  });
}

/** Per tenant, multi-tenant only: all users together, refused whole, without taking from the user's budget. */
async function testTenantRecipientBudget() {
  await withMode(false, async () => {
    const guard = await shareGuard();
    const perUser = RATE_LIMITS.shareLinkRecipientsPerUser.limit;
    const perTenant = RATE_LIMITS.shareLinkRecipientsPerTenant.limit;
    const users = perTenant / perUser;
    for (let u = 0; u < users - 1; u += 1) assert.ok(ok(await sendRecipients(guard, 't1', `u${u}`, perUser)), `user ${u} sends ${perUser}`);
    assert.ok(ok(await sendRecipients(guard, 't1', 'last', perUser - 10)), 'the tenant reaches 10 recipients under its budget');
    assert.equal(await statusOf(guard, 't1', 'fresh', 20), TOO_MANY, 'a share that would pass the tenant budget is refused');
    assert.equal(await statusOf(guard, 't1', 'fresh', 10), 200, 'it took nothing from the tenant: 10 more go');
    assert.equal(await statusOf(guard, 't1', 'other', 1), TOO_MANY, 'past the tenant budget, a user who sent nothing is refused');
    assert.equal(await statusOf(guard, 't2', 'fresh', 20), 200, 'another tenant keeps its own budget');
  });
  await withMode(true, async () => {
    const guard = await shareGuard();
    const perUser = RATE_LIMITS.shareLinkRecipientsPerUser.limit;
    const perTenant = RATE_LIMITS.shareLinkRecipientsPerTenant.limit;
    for (let u = 0; u <= perTenant / perUser; u += 1) {
      assert.ok(ok(await sendRecipients(guard, 'only', `u${u}`, perUser)), `single-tenant: user ${u} sends ${perUser}, no tenant budget`);
    }
  });
}

/** All or nothing: a budget that refuses gives back what the others took; a window reopens. */
async function testBudgetsAllOrNothing() {
  const storage = new ThrottlerStorageService();
  const wide = { name: 'probe-wide', limit: 10, ttl: 60_000 };
  const narrow = { name: 'probe-narrow', limit: 5, ttl: 60_000 };
  const refused = await takeRateLimit(storage, [{ budget: wide, tracker: 'k', amount: 6 }, { budget: narrow, tracker: 'k', amount: 6 }]);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.refused, narrow, 'the narrow budget refuses');
  const whole = await takeRateLimit(storage, [{ budget: wide, tracker: 'k', amount: 10 }]);
  assert.equal(whole.ok, true, 'the wide budget was given back');
  assert.equal((await takeRateLimit(storage, [{ budget: wide, tracker: 'k', amount: 1 }])).ok, false);
  assert.equal((await takeRateLimit(storage, [{ budget: wide, tracker: 'other', amount: 10 }])).ok, true, 'another tracker has its own count');
  if (whole.ok) await giveBackRateLimit(storage, whole.taken);
  assert.equal((await takeRateLimit(storage, [{ budget: wide, tracker: 'k', amount: 10 }])).ok, true, 'given back');
  const short = { name: 'probe-short', limit: 2, ttl: 40 };
  assert.equal((await takeRateLimit(storage, [{ budget: short, tracker: 'k', amount: 2 }])).ok, true);
  assert.equal((await takeRateLimit(storage, [{ budget: short, tracker: 'k', amount: 1 }])).ok, false);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal((await takeRateLimit(storage, [{ budget: short, tracker: 'k', amount: 2 }])).ok, true, 'the window reopens');
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
  await testUserRecipientBudget(false);
  await testUserRecipientBudget(true);
  await testTenantRecipientBudget();
  await testBudgetsAllOrNothing();
  testMessageLinksAreInert();
  console.log('share-limits.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

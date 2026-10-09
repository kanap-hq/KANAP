import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, LoggerService, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { SecurityEventsService } from '../../audit/security-events.service';
import { BillingService } from '../../billing/billing.service';
import { waitForBackgroundWork } from '../../common/background-work';
import { applyTrustProxy, resolveTrustProxy } from '../../common/client-address';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { Company } from '../../companies/company.entity';
import { Features } from '../../config/features';
import { FxIngestionService } from '../../currency/fx-ingestion.service';
import { Department } from '../../departments/department.entity';
import { EmailService } from '../../email/email.service';
import type { SendEmailOptions } from '../../email/email.types';
import type { EmailTransport } from '../../email/transports/email-transport.interface';
import { PermissionsService } from '../../permissions/permissions.service';
import { TenantsService } from '../../tenants/tenants.service';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { PasswordResetToken } from '../password-reset-token.entity';
import { RefreshToken } from '../refresh-token.entity';

// `POST /auth/password-reset/request` over HTTP against the database, in multi-tenant and in
// single-tenant mode, with the real e-mail queue on a transport that fails, succeeds or holds:
// - a known and an unknown address get the same status and the same body, whether the e-mail
//   goes out or not;
// - the response does not wait for the e-mail: it comes back while the transport still holds it;
// - a failed send is an error line in the server log, with the transport and the error code and
//   without the link, the token or any e-mail address (also when the relay's answer quotes the
//   recipient), and the request's audit row says the e-mail was not sent (`email_not_sent`); a
//   sent one keeps no reason;
// - a reset link that cannot be saved changes nothing to the answer: an error line, no e-mail,
//   the same reason;
// - an account on a reserved `.example` domain (no e-mail is ever sent there) gets the same answer
//   and the same reason;
// - no unhandled rejection.

const USER_AGENT = 'Probe-agent/1.0';
const CLIENT_ADDRESS = '198.51.100.7';

type Seed = { tenantId: string; slug: string; ada: { id: string; email: string }; eve: { id: string; email: string } };

/** What the e-mail transport does with the next sends. */
let transportMode: 'fail' | 'reject' | 'send' | 'hold' = 'send';
/** When set, saving a reset link fails as a refused write does. */
let tokenWriteRefused = false;
let releaseHeld: () => void = () => undefined;
const delivered: SendEmailOptions[] = [];
let transportCalls = 0;

const probeTransport: EmailTransport = {
  name: 'smtp',
  defaultMinIntervalMs: 1,
  async send(options) {
    transportCalls += 1;
    if (transportMode === 'fail') {
      throw Object.assign(new Error('unable to verify the first certificate'), { code: 'ESOCKET' });
    }
    if (transportMode === 'reject') {
      // The relay's answer to RCPT TO quotes the recipient, as nodemailer passes it on.
      const to = [options.to].flat().join(', ');
      throw Object.assign(
        new Error(`Can't send mail - all recipients were rejected: 550 5.1.1 <${to}>: Recipient address rejected: User unknown`),
        { code: 'EENVELOPE', responseCode: 550 },
      );
    }
    if (transportMode === 'hold') {
      await new Promise<void>((resolve) => { releaseHeld = resolve; });
    }
    delivered.push(options);
  },
  getRetryDelayMs: () => null,
};

function createEmailService(): EmailService {
  process.env.EMAIL_QUEUE_MIN_INTERVAL_MS = '1';
  const service = new EmailService();
  (service as any).transport = probeTransport;
  return service;
}

/** The server log lines, by level. */
const logged: Array<{ level: string; message: string }> = [];
const captureLogger: LoggerService = {
  log: (message) => { logged.push({ level: 'log', message: String(message) }); },
  error: (message) => { logged.push({ level: 'error', message: String(message) }); },
  warn: (message) => { logged.push({ level: 'warn', message: String(message) }); },
  debug: () => undefined,
  verbose: () => undefined,
};

function createUsersService() {
  return new UsersService(
    dataSource.getRepository(User),
    dataSource.getRepository(Company),
    dataSource.getRepository(Department),
    {} as any,
    { getSubscriptionSummary: async () => ({ seat_limit: null, seats_used: 0 }) } as any,
    {} as any,
    new AuditService(dataSource.getRepository(AuditLog)),
  );
}

@Module({
  imports: [ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 100 }] })],
  controllers: [AuthController],
  providers: [
    ListContextsService,
    { provide: DataSource, useValue: dataSource },
    { provide: UsersService, useFactory: createUsersService },
    {
      provide: AuthService,
      useFactory: (users: UsersService) => {
        const auth = new AuthService(users, dataSource.getRepository(RefreshToken), dataSource.getRepository(PasswordResetToken));
        const create = auth.createPasswordResetToken.bind(auth);
        auth.createPasswordResetToken = async (...args) => {
          if (tokenWriteRefused) throw Object.assign(new Error('permission denied for table password_reset_tokens'), { code: '42501' });
          return create(...args);
        };
        return auth;
      },
      inject: [UsersService],
    },
    { provide: SecurityEventsService, useFactory: () => new SecurityEventsService(dataSource) },
    { provide: PermissionsService, useValue: {} },
    { provide: BillingService, useValue: {} },
    { provide: EmailService, useFactory: createEmailService },
    { provide: FxIngestionService, useValue: { maybeRefreshOnLogin: async () => undefined } },
    { provide: TenantsService, useValue: {} },
  ],
})
class PasswordResetProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(PasswordResetProbeModule, { logger: captureLogger });
  applyTrustProxy(app.getHttpAdapter().getInstance(), resolveTrustProxy('1', false));
  // The tenant middleware's job, from a header.
  app.use((req: any, _res: any, next: () => void) => {
    const tenantId = req.headers['x-probe-tenant'];
    if (tenantId) req.tenant = { id: tenantId, slug: req.headers['x-probe-slug'], name: 'Password reset probe' };
    next();
  });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** A request that gets no answer within `timeoutMs` fails the spec. */
async function requestReset(app: INestApplication, seed: Seed, email: string, timeoutMs = 5000) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/auth/password-reset/request`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        'x-forwarded-for': `192.0.2.1, ${CLIENT_ADDRESS}`,
        'x-probe-tenant': seed.tenantId,
        'x-probe-slug': seed.slug,
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch (error) {
    if ((error as Error)?.name === 'TimeoutError') throw new Error(`password reset request: no answer within ${timeoutMs} ms`);
    throw error;
  }
}

/** The response is out; the e-mail and the audit row, not awaited, may still be on their way. */
async function settled() {
  assert.equal(await waitForBackgroundWork(Date.now() + 5000), 0, 'background work finished');
}

async function resetRows(tenantId: string): Promise<any[]> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return manager.query(
      `SELECT action, user_id, source_ref, after_json FROM audit_log
        WHERE table_name = 'auth' AND action = 'password_reset_requested' ORDER BY created_at, id`,
    );
  });
}

async function issuedTokenHashes(tenantId: string): Promise<string[]> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const rows = await manager.query(`SELECT token_hash FROM password_reset_tokens WHERE tenant_id = $1`, [tenantId]);
    return rows.map((row: { token_hash: string }) => row.token_hash);
  });
}

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  const slug = `pw-reset-${tag}-${tenantId.slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Password reset probe', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug],
  );
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const [{ id: roleId }] = await manager.query(
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Probe member', null, false, false) RETURNING id`,
      [tenantId],
    );
    const user = async (email: string) => {
      const [{ id }] = await manager.query(
        `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
         VALUES ($1, 'Probe', 'Probe', $2, null, $3, false, 'enabled') RETURNING id`,
        [tenantId, email, roleId],
      );
      return { id, email };
    };
    return {
      tenantId,
      slug,
      ada: await user(`ada-${tenantId.slice(0, 8)}@example.com`),
      eve: await user(`eve-${tenantId.slice(0, 8)}@probe.example`),
    };
  });
}

async function cleanup(seeds: Seed[]) {
  for (const seed of seeds) {
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
      for (const table of ['audit_log', 'password_reset_tokens', 'users', 'roles']) {
        await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seed.tenantId]);
      }
    }).catch(() => undefined);
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId]).catch(() => undefined);
  }
}

const OK = { status: 201, body: { ok: true } };
const DETAILS = { ip: CLIENT_ADDRESS, user_agent: USER_AGENT };

function row(userId: string | null, reason: string | null) {
  return { action: 'password_reset_requested', user_id: userId, source_ref: reason, after_json: DETAILS };
}

async function runMode(app: INestApplication, seed: Seed, mode: string) {
  const unknownEmail = `nobody-${seed.tenantId.slice(0, 8)}@example.com`;
  const answers: Array<{ status: number; body: unknown }> = [];
  logged.length = 0;
  delivered.length = 0;

  // The transport refuses: the same answer for the known and the unknown address.
  transportMode = 'fail';
  answers.push(await requestReset(app, seed, seed.ada.email));
  await settled();
  answers.push(await requestReset(app, seed, unknownEmail));
  await settled();
  assert.deepEqual(answers, [OK, OK], `${mode}: the same answer when the e-mail cannot be sent`);
  const errors = logged.filter((line) => line.level === 'error');
  assert.equal(errors.length, 1, `${mode}: one error line for the e-mail not sent`);
  assert.match(errors[0].message, /Password reset e-mail not sent/);
  assert.match(errors[0].message, /transport smtp/);
  assert.match(errors[0].message, /code ESOCKET/);
  assert.match(errors[0].message, new RegExp(`tenant ${seed.tenantId}`));
  assert.match(errors[0].message, new RegExp(`user ${seed.ada.id}`));
  assert.match(errors[0].message, /unable to verify the first certificate/);
  assert.ok(!errors[0].message.includes('reset-password'), `${mode}: the error line holds no link`);
  assert.ok(!errors[0].message.includes(seed.ada.email), `${mode}: the error line holds no address`);
  assert.equal((await issuedTokenHashes(seed.tenantId)).length, 1, `${mode}: one reset link issued`);

  // The transport sends: the same answer again, one e-mail for the known address.
  transportMode = 'send';
  answers.push(await requestReset(app, seed, seed.ada.email));
  await settled();
  answers.push(await requestReset(app, seed, unknownEmail));
  await settled();
  assert.equal(delivered.length, 1, `${mode}: one e-mail sent`);
  assert.deepEqual([delivered[0].to].flat(), [seed.ada.email]);
  assert.equal(logged.filter((line) => line.level === 'error').length, 1, `${mode}: no new error line`);

  for (const answer of answers) assert.deepEqual(answer, OK, `${mode}: every request gets the same answer`);

  // The transport holds the e-mail: the response does not wait for it.
  transportMode = 'hold';
  const callsBefore = transportCalls;
  const started = Date.now();
  const held = await requestReset(app, seed, seed.ada.email, 3000);
  assert.deepEqual(held, OK, `${mode}: answered while the e-mail is held`);
  for (let i = 0; i < 100 && transportCalls === callsBefore; i += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(transportCalls, callsBefore + 1, `${mode}: the e-mail was handed to the transport`);
  assert.equal(delivered.length, 1, `${mode}: the held e-mail is not sent yet`);
  assert.ok(Date.now() - started < 3000);
  releaseHeld();
  await settled();
  assert.equal(delivered.length, 2, `${mode}: the held e-mail went out once released`);

  // The relay refuses the recipient and quotes its address: the same answer, no address in the log.
  transportMode = 'reject';
  assert.deepEqual(await requestReset(app, seed, seed.ada.email), OK, `${mode}: same answer when the relay refuses the recipient`);
  await settled();
  const rejectedLine = logged.filter((line) => line.level === 'error').at(-1)!.message;
  assert.equal(logged.filter((line) => line.level === 'error').length, 2, `${mode}: one more error line`);
  assert.match(rejectedLine, /Password reset e-mail not sent/);
  assert.match(rejectedLine, /code EENVELOPE, response 550/);
  assert.match(rejectedLine, /550 5\.1\.1 <\[address\]>: Recipient address rejected/);
  assert.ok(!rejectedLine.includes('@'), `${mode}: the error line holds no e-mail address: ${rejectedLine}`);

  // The reset link cannot be saved: the same answer, an error line, no e-mail.
  transportMode = 'send';
  const callsBeforeRefusal = transportCalls;
  tokenWriteRefused = true;
  try {
    assert.deepEqual(await requestReset(app, seed, seed.ada.email), OK, `${mode}: same answer when the link cannot be saved`);
    await settled();
  } finally {
    tokenWriteRefused = false;
  }
  assert.equal(transportCalls, callsBeforeRefusal, `${mode}: no e-mail without a saved link`);
  const refusedLine = logged.filter((line) => line.level === 'error').at(-1)!.message;
  assert.equal(logged.filter((line) => line.level === 'error').length, 3, `${mode}: one more error line`);
  assert.match(refusedLine, /Password reset link not created/);
  assert.match(refusedLine, /code 42501/);
  assert.match(refusedLine, new RegExp(`user ${seed.ada.id}`));

  // An account on a reserved `.example` domain: the same answer, nothing sent, the same reason.
  assert.deepEqual(await requestReset(app, seed, seed.eve.email), OK, `${mode}: same answer for a reserved domain`);
  await settled();
  assert.equal(transportCalls, callsBeforeRefusal, `${mode}: nothing sent to a reserved domain`);
  assert.equal(logged.filter((line) => line.level === 'error').length, 3, `${mode}: no error line for a reserved domain`);

  // The audit rows: when nothing goes out the row says so, a sent one has no reason, an unknown
  // address keeps its reason only.
  assert.deepEqual(await resetRows(seed.tenantId), [
    row(seed.ada.id, 'email_not_sent'),
    row(null, 'unknown_user'),
    row(seed.ada.id, null),
    row(null, 'unknown_user'),
    row(seed.ada.id, null),
    row(seed.ada.id, 'email_not_sent'),
    row(seed.ada.id, 'email_not_sent'),
    row(seed.eve.id, 'email_not_sent'),
  ]);
  for (const line of logged) {
    assert.ok(!line.message.includes(seed.ada.email) && !line.message.includes(seed.eve.email), `${mode}: no account address in the log: ${line.message}`);
  }

  // No link, token or address of an e-mail in any log line or audit row.
  const links = delivered.map((sent) => String(sent.text ?? '').match(/https?:\/\/\S*reset-password#token=\S+/)?.[0]).filter(Boolean) as string[];
  assert.equal(links.length, 2, `${mode}: the sent e-mails hold their link`);
  const stored = JSON.stringify([logged, await resetRows(seed.tenantId)]);
  for (const link of links) {
    const token = decodeURIComponent(link.split('#token=')[1]);
    assert.ok(!stored.includes(link) && !stored.includes(token), `${mode}: no link or token in the logs or the audit log`);
  }
  assert.ok(!stored.includes(unknownEmail), `${mode}: the unknown address is kept nowhere`);
}

async function main() {
  const unhandled: unknown[] = [];
  process.on('unhandledRejection', (reason) => unhandled.push(reason));
  process.env.RATE_LIMIT_ENABLED = 'false';
  process.env.APP_BASE_URL = 'https://kanap.example.test';
  process.env.JWT_SECRET ||= 'password-reset-spec-signing-key-0123456789';
  const savedFeatures = { SINGLE_TENANT: Features.SINGLE_TENANT, EMAIL_ENABLED: Features.EMAIL_ENABLED };
  (Features as any).EMAIL_ENABLED = true;

  await dataSource.initialize();
  const seeds: Seed[] = [];
  const app = await createApp();
  try {
    for (const [mode, singleTenant] of [['multi-tenant', false], ['single-tenant', true]] as const) {
      (Features as any).SINGLE_TENANT = singleTenant;
      const seed = await seedTenant(singleTenant ? 'st' : 'mt');
      seeds.push(seed);
      await runMode(app, seed, mode);
    }
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    releaseHeld();
    await app.close();
    Object.assign(Features as any, savedFeatures);
    await cleanup(seeds);
    await dataSource.destroy();
  }
  console.log('password-reset-request-http.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

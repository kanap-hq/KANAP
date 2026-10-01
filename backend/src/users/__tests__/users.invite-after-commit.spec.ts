import * as assert from 'node:assert/strict';
import { BadGatewayException } from '@nestjs/common';
import { UsersService } from '../users.service';

// A user invitation never holds the request transaction open while its e-mail
// waits on the mail queue (plan planning/perf-scale, lot 1D review): the
// token, the status change and the audit row are written, then committed with
// the request's connection given back (`releaseConnection`), and only then is
// the e-mail sent. Holding the transaction during the send let the server end
// it after the idle limit, losing the token while the e-mail with its link
// still went out.

type Event = string;

function setup(opts: { status: string; mailFails?: boolean }) {
  const events: Event[] = [];
  const user: any = {
    id: 'u-1', email: 'new.user@example.invalid', tenant_id: 't-1', status: opts.status, locale: 'fr',
    role: { role_name: 'Reader' }, external_auth_provider: null,
  };
  const repo = {
    findOne: async () => ({ ...user }),
    save: async (row: any) => { events.push(`save status ${row.status}`); return row; },
    manager: {},
  };
  const tokens = {
    create: (row: any) => row,
    save: async () => { events.push('store token'); },
  };
  const manager: any = { getRepository: (entity: { name?: string }) => (entity?.name === 'User' ? repo : tokens) };
  const email = {
    sendUserInviteEmail: async (params: any) => {
      events.push(`send e-mail to ${params.to}`);
      if (opts.mailFails) throw new Error('mail provider down');
    },
  };
  const audit = { log: async (entry: any) => { events.push(`audit ${entry.table} ${entry.action}`); } };
  const service = new UsersService(repo as any, {} as any, {} as any, {} as any, {} as any, email as any, audit as any);
  const releaseConnection = async <T>(fn: () => Promise<T>) => {
    events.push('commit and release');
    const result = await fn();
    events.push('reacquire');
    return { result, manager };
  };
  return { events, service, manager, releaseConnection };
}

async function testWritesCommittedBeforeTheEmail() {
  const { events, service, manager, releaseConnection } = setup({ status: 'disabled' });
  const result = await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, releaseConnection });
  assert.deepEqual(events, [
    'store token',
    'save status invited',
    'audit users update',
    'commit and release',
    'send e-mail to new.user@example.invalid',
    'reacquire',
  ], 'every write happens before the connection is given back; the e-mail waits outside the transaction');
  assert.equal(result.status, 'invited');
  assert.equal(result.password_hash, undefined);
}

async function testEnabledUserKeepsItsStatus() {
  const { events, service, manager, releaseConnection } = setup({ status: 'enabled' });
  await service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, releaseConnection });
  assert.deepEqual(events, ['store token', 'commit and release', 'send e-mail to new.user@example.invalid', 'reacquire']);
}

async function testFailedSendSaysTheInvitationIsSaved() {
  const { events, service, manager, releaseConnection } = setup({ status: 'disabled', mailFails: true });
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(
      service.inviteUser('u-1', 'admin-1', 'https://acme.kanap.net', { manager, releaseConnection }),
      (error: unknown) => error instanceof BadGatewayException && /saved, but its e-mail could not be sent/.test((error as Error).message),
    );
  } finally {
    console.error = originalError;
  }
  assert.ok(events.indexOf('commit and release') > events.indexOf('save status invited'), 'the invitation was committed before the send');
}

async function testWithoutReleaseTheSendFailsTheCall() {
  const { events, service, manager } = setup({ status: 'disabled', mailFails: true });
  await assert.rejects(service.inviteUser('u-1', null, 'https://acme.kanap.net', { manager }), /mail provider down/);
  assert.equal(events[events.length - 1], 'send e-mail to new.user@example.invalid', 'the e-mail still goes last');
}

async function main() {
  // The invitation link is a signed token.
  process.env.JWT_SECRET ??= 'invite-after-commit-spec-secret';
  await testWritesCommittedBeforeTheEmail();
  await testEnabledUserKeepsItsStatus();
  await testFailedSendSaysTheInvitationIsSaved();
  await testWithoutReleaseTheSendFailsTheCall();
  console.log('users.invite-after-commit.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

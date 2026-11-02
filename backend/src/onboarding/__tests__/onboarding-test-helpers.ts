import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import dataSource from '../../data-source';
import { Services } from '../../admin/tenants/__tests__/tenant-reset-test-helpers';
import { DemoDataService } from '../../demo-data/demo-data.service';

/** The loader process double: ends when the spec says so, or when it is killed. */
export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4343;
  done = false;
  killedWith: string | null = null;
  kill(signal: string = 'SIGTERM') {
    this.killedWith = signal;
    this.finish(null, signal);
    return true;
  }
  finish(code: number | null, signal: string | null = null) {
    if (this.done) return;
    this.done = true;
    this.stdout.end();
    this.stderr.end();
    setTimeout(() => this.emit('close', code, signal), 20);
  }
}

export type DemoDataDouble = {
  service: DemoDataService;
  /** Every loader started, with its environment. */
  children: Array<{ env: Record<string, string>; child: FakeChild }>;
  /** The reset e-mails sent (`NotificationsService.notifyWorkspaceReset`). */
  emails: Array<{ tenantId: string; actorId: string }>;
  /** Called with each loader as it starts; the spec sets it to make the loader write or end. */
  onSpawn: ((child: FakeChild) => void) | null;
};

/**
 * The real DemoDataService and tenant reset on the spec database, with the loader process and
 * the reset e-mail as doubles (as `demo-data.routes.integration.spec.ts`). No Stripe: the
 * subscription allows the load.
 */
export function buildDemoData(svc: Services): DemoDataDouble {
  const children: DemoDataDouble['children'] = [];
  const emails: DemoDataDouble['emails'] = [];
  const notifications = {
    async notifyWorkspaceReset(params: { tenantId: string; actorId: string }) {
      emails.push({ tenantId: params.tenantId, actorId: params.actorId });
    },
  };
  const service = new DemoDataService(
    dataSource, svc.reset, svc.baseline, svc.auth, { isConfigured: () => false } as any, notifications as any,
  );
  const double: DemoDataDouble = { service, children, emails, onSpawn: null };
  service.config.scriptPath = __filename;
  service.config.spawn = ((_command: string, _args: string[], options: any) => {
    const child = new FakeChild();
    children.push({ env: options.env, child });
    double.onSpawn?.(child);
    return child;
  }) as any;
  (service as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  return double;
}

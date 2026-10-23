import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { TenantExecutionOptions, withTenantExecution } from '../../common/tenant-runner';
import { applyDataAccess, assertDataAccessWithoutTransaction } from '../../data-access/data-access';
import { AiExecutionContext, AiExecutionContextWithManager } from '../ai.types';

@Injectable()
export class AiTenantExecutionService {
  constructor(private readonly dataSource: DataSource) {}

  async run<T>(
    tenantId: string,
    fn: (manager: EntityManager) => Promise<T>,
    opts?: TenantExecutionOptions,
  ): Promise<T> {
    return withTenantExecution(this.dataSource, tenantId, fn, opts);
  }

  /**
   * Runs `fn` for the context's person, with that person's data access (spec §6.3): Plaid and MCP
   * work on their own connection. In a transaction, the access is applied first. Without one
   * (`transaction: false`), a person whose access is limited is refused
   * (DataAccessTransactionRequiredError); an unscoped person runs as before. A context without a
   * person (scheduled agents, system work) runs as before.
   */
  async runWithContext<T>(
    context: AiExecutionContext,
    fn: (managedContext: AiExecutionContextWithManager) => Promise<T>,
    opts?: TenantExecutionOptions,
  ): Promise<T> {
    const userId = context.userId || null;
    const withoutTransaction = opts?.transaction === false;
    return this.run(
      context.tenantId,
      async (manager) => {
        if (userId) {
          if (withoutTransaction) await assertDataAccessWithoutTransaction(manager, userId);
          else await applyDataAccess(manager, userId);
        }
        return fn({ ...context, manager });
      },
      opts,
    );
  }
}

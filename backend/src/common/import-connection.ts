import * as fs from 'fs';
import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import {
  connectRequestRunner,
  RequestDbTimeouts,
  requestDbTimeoutDefaults,
  requestDbTimeoutsOf,
  startTenantTransaction,
} from './request-db-timeouts';

export type ReleaseConnectionResult<T> = {
  result: T;
  manager: EntityManager;
};

export type ReleaseConnectionFn = <T>(
  fn: () => Promise<T>,
) => Promise<ReleaseConnectionResult<T>>;

export type ImportExecutionOptions = {
  manager?: EntityManager;
  releaseConnection?: ReleaseConnectionFn;
};

export function readUploadedFileBuffer(file: Express.Multer.File | null | undefined): Buffer {
  if (!file) {
    throw new BadRequestException('No file uploaded');
  }

  const buffer = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : null);
  if (!buffer) {
    throw new BadRequestException('Empty upload');
  }

  return buffer;
}

export async function commitAndReleaseRunner(runner: QueryRunner | null | undefined): Promise<void> {
  if (!runner || runner.isReleased) {
    return;
  }

  try {
    if (runner.isTransactionActive) {
      await runner.commitTransaction();
    }
  } catch (commitError) {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
    } catch {
      // Ignore rollback errors here; request cleanup will surface the original failure.
    }
    throw commitError;
  } finally {
    if (!runner.isReleased) {
      await runner.release();
    }
  }
}

export async function createTenantQueryRunner(
  dataSource: DataSource,
  tenantId: string,
  timeouts: RequestDbTimeouts = requestDbTimeoutDefaults(),
): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  try {
    await connectRequestRunner(runner);
    // The request goes on in this transaction: same tenant and bounded waits as the one it replaces.
    await startTenantTransaction(runner, tenantId, timeouts);
    return runner;
  } catch (error) {
    try {
      if (runner.isTransactionActive) {
        await runner.rollbackTransaction();
      }
    } catch {
      // Ignore rollback errors during reacquire cleanup.
    }
    try {
      if (!runner.isReleased) {
        await runner.release();
      }
    } catch {
      // Ignore release errors during reacquire cleanup.
    }
    throw error;
  }
}

export function createRequestReleaseConnection(
  req: any,
  dataSource: DataSource,
  tenantId: string,
): ReleaseConnectionFn {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) {
    throw new Error('Tenant context is required to release and reacquire the request connection');
  }

  return async <T>(fn: () => Promise<T>): Promise<ReleaseConnectionResult<T>> => {
    const currentRunner: QueryRunner | undefined = req?.queryRunner;
    if (currentRunner) {
      try {
        await commitAndReleaseRunner(currentRunner);
      } catch (error) {
        if (currentRunner.isReleased) {
          if (req?.queryRunner === currentRunner) {
            req.queryRunner = null;
          }
          req._tenantRunnerReleased = true;
        }
        throw error;
      }
    }

    req.queryRunner = null;
    req._tenantRunnerReleased = true;

    const result = await fn();
    // The route's waits (an import keeps its raised ones), not the defaults.
    const nextRunner = await createTenantQueryRunner(dataSource, normalizedTenantId, requestDbTimeoutsOf(req));
    req.queryRunner = nextRunner;
    req._tenantRunnerOwner = true;
    req._tenantRunnerReleased = false;

    return {
      result,
      manager: nextRunner.manager,
    };
  };
}

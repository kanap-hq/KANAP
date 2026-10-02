import { Injectable, Logger, OnApplicationBootstrap, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { ScheduledTask } from './scheduled-task.entity';
import { ScheduledTaskRun } from './scheduled-task-run.entity';

export interface TaskRegistration {
  name: string;
  description: string;
  defaultCron: string;
  handler: () => Promise<Record<string, any>>;
  /** Also run once when the API server starts (`runStartupTasks`, after `listen`), if the task is enabled. */
  runOnStartup?: boolean;
}

/** The next time a cron job fires, or null when it cannot say. */
function nextScheduledDate(job: CronJob): Date | null {
  try {
    return job.nextDate().toJSDate();
  } catch {
    return null;
  }
}

@Injectable()
export class ScheduledTasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ScheduledTasksService.name);
  private readonly handlers = new Map<string, () => Promise<Record<string, any>>>();
  private readonly registrations: TaskRegistration[] = [];
  private startupTaskNames: string[] = [];

  constructor(
    @InjectRepository(ScheduledTask)
    private readonly taskRepo: Repository<ScheduledTask>,
    @InjectRepository(ScheduledTaskRun)
    private readonly runRepo: Repository<ScheduledTaskRun>,
    private readonly dataSource: DataSource,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  register(opts: TaskRegistration) {
    this.registrations.push(opts);
    this.handlers.set(opts.name, opts.handler);
  }

  async onApplicationBootstrap() {
    const startupRuns: string[] = [];
    for (const reg of this.registrations) {
      // Upsert: preserve user-customized cron/enabled
      const existing = await this.taskRepo.findOne({ where: { name: reg.name } });
      if (!existing) {
        try {
          await this.taskRepo.save({
            name: reg.name,
            description: reg.description,
            cron_expression: reg.defaultCron,
            enabled: true,
          });
        } catch (err: any) {
          // Another API process starting at the same time inserted it first (unique name).
          if (err?.driverError?.code !== '23505' && err?.code !== '23505') throw err;
        }
      } else {
        // Update description only (preserve user's cron/enabled)
        if (existing.description !== reg.description) {
          await this.taskRepo.update({ name: reg.name }, { description: reg.description });
        }
      }

      const task = await this.taskRepo.findOneBy({ name: reg.name });
      if (task && task.enabled) {
        this.createCronJob(task.name, task.cron_expression);
        if (reg.runOnStartup) startupRuns.push(task.name);
      }
    }

    this.startupTaskNames = startupRuns;
    this.logger.log(`Registered ${this.registrations.length} scheduled tasks`);
  }

  /**
   * Starts the enabled `runOnStartup` tasks once. Called by `main.ts` after
   * `listen`, so other AppModule contexts (scripts, specs) never run them. Not
   * awaited: the API serves while they run.
   */
  runStartupTasks(): void {
    const names = this.startupTaskNames;
    this.startupTaskNames = [];
    for (const name of names) {
      this.executeTask(name).catch((err) => {
        this.logger.error(`[${name}] Startup run failed: ${err.message}`);
      });
    }
  }

  private createCronJob(name: string, cronExpression: string) {
    try {
      // Remove existing job if any
      try { this.schedulerRegistry.deleteCronJob(name); } catch {}

      // The scheduled time of the coming tick. Every API process computes the same one from the
      // same cron expression, so it names the tick they compete for (`claimTick`).
      let scheduledFor: Date | null = null;
      const job = new CronJob(cronExpression, () => {
        const tick = scheduledFor ?? new Date();
        scheduledFor = nextScheduledDate(job);
        this.runScheduledTick(name, cronExpression, tick).catch(err => {
          this.logger.error(`[${name}] Unhandled execution error: ${err.message}`);
        });
      });

      this.schedulerRegistry.addCronJob(name, job);
      job.start();
      scheduledFor = nextScheduledDate(job);
      this.logger.log(`Cron job '${name}' scheduled: ${cronExpression}`);
    } catch (err: any) {
      this.logger.error(`Failed to create cron job '${name}': ${err.message}`);
    }
  }

  /**
   * One cron tick: runs the task if this process wins the tick. Every API process schedules
   * every task; with several processes (API_WORKERS > 1) they all fire at the same time, and the
   * advisory lock of `executeTask` alone does not stop a fast task from running once per
   * process (a run can end before the next process tries the lock).
   */
  private async runScheduledTick(name: string, cronExpression: string, tick: Date): Promise<void> {
    if (!(await this.claimTick(name, cronExpression, tick))) return;
    await this.executeTask(name);
  }

  /**
   * Claims a tick in `scheduled_tasks.last_tick_at`: one process moves it to the tick's
   * scheduled time and runs; the others find it there and skip. The claim also checks the task
   * as it is stored: a cron change or a disable made through another process (the admin console
   * reaches one process only) makes this process reschedule or drop its job instead of running.
   */
  async claimTick(name: string, cronExpression: string, tick: Date): Promise<boolean> {
    const claimed: Array<{ name: string }> = await this.dataSource.query(
      `WITH claimed AS (
         UPDATE scheduled_tasks SET last_tick_at = $2
          WHERE name = $1 AND enabled AND cron_expression = $3
            AND (last_tick_at IS NULL OR last_tick_at < $2)
         RETURNING name
       )
       SELECT name FROM claimed`,
      [name, tick, cronExpression],
    );
    if (claimed.length > 0) return true;

    const [stored]: Array<{ enabled: boolean; cron_expression: string }> = await this.dataSource.query(
      `SELECT enabled, cron_expression FROM scheduled_tasks WHERE name = $1`,
      [name],
    );
    if (!stored || !stored.enabled) {
      try { this.schedulerRegistry.deleteCronJob(name); } catch {}
      this.logger.log(`[${name}] Disabled in another process: cron job removed here`);
    } else if (stored.cron_expression !== cronExpression) {
      this.logger.log(`[${name}] Rescheduled in another process: ${cronExpression} -> ${stored.cron_expression}`);
      this.createCronJob(name, stored.cron_expression);
    } else {
      this.logger.debug(`[${name}] Tick ${tick.toISOString()} taken by another process`);
    }
    return false;
  }

  async executeTask(name: string): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.warn(`No handler registered for task '${name}'`);
      return;
    }

    const startedAt = new Date();

    // Stale detection: mark old "running" entries as failed
    await this.dataSource.query(
      `UPDATE scheduled_task_runs
       SET status = 'failure', error = 'Timed out (stale run detected)', finished_at = now(),
           duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::integer * 1000
       WHERE task_name = $1 AND status = 'running' AND started_at < now() - interval '1 hour'`,
      [name],
    );
    await this.dataSource.query(
      `UPDATE scheduled_tasks
       SET last_status = 'failure', updated_at = now()
       WHERE name = $1 AND last_status = 'running' AND last_run_at < now() - interval '1 hour'`,
      [name],
    );

    // Session-level advisory lock, taken and released on one dedicated connection:
    // an unlock sent on another pool connection fails silently and leaves the
    // lock held. A run that finds the lock taken (another run of the same task,
    // in this process or another) is skipped.
    const lockRunner = this.dataSource.createQueryRunner();
    await lockRunner.connect();
    try {
      const lockResult = await lockRunner.query(
        `SELECT pg_try_advisory_lock(hashtext($1)) as acquired`,
        [name],
      );
      if (!lockResult[0]?.acquired) {
        this.logger.debug(`[${name}] Skipped: another run holds the lock`);
        return;
      }
      try {
        await this.runLocked(name, handler, startedAt);
      } finally {
        await lockRunner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]).catch(() => {});
      }
    } finally {
      await lockRunner.release();
    }
  }

  private async runLocked(name: string, handler: () => Promise<Record<string, any>>, startedAt: Date): Promise<void> {
    // Insert run row
    const run = this.runRepo.create({
      task_name: name,
      status: 'running',
      started_at: startedAt,
    });
    await this.runRepo.save(run);

    // Update task status
    await this.taskRepo.update({ name }, {
      last_run_at: startedAt,
      last_status: 'running',
      updated_at: new Date(),
    });

    try {
      const summary = await handler();
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.runRepo.update({ id: run.id }, {
        status: 'success',
        finished_at: finishedAt,
        duration_ms: durationMs,
        summary: summary ?? null,
      });

      await this.taskRepo.update({ name }, {
        last_status: 'success',
        last_duration_ms: durationMs,
        updated_at: new Date(),
      });

      this.logger.log(`[${name}] Completed in ${durationMs}ms`);
    } catch (err: any) {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();

      await this.runRepo.update({ id: run.id }, {
        status: 'failure',
        finished_at: finishedAt,
        duration_ms: durationMs,
        error: err.message || String(err),
      });

      await this.taskRepo.update({ name }, {
        last_status: 'failure',
        last_duration_ms: durationMs,
        updated_at: new Date(),
      });

      this.logger.error(`[${name}] Failed after ${durationMs}ms: ${err.message}`);
    }

    // Auto-prune old runs
    await this.dataSource.query(
      `DELETE FROM scheduled_task_runs WHERE task_name = $1 AND started_at < now() - interval '90 days'`,
      [name],
    );
  }

  // ========== CRUD ==========

  async listTasks(): Promise<ScheduledTask[]> {
    return this.taskRepo.find({ order: { name: 'ASC' } });
  }

  async updateTask(name: string, patch: { cron_expression?: string; enabled?: boolean }): Promise<ScheduledTask> {
    const task = await this.taskRepo.findOneBy({ name });
    if (!task) throw new NotFoundException(`Task '${name}' not found`);

    if (patch.cron_expression !== undefined) {
      this.validateCron(patch.cron_expression);
      task.cron_expression = patch.cron_expression;
    }
    if (patch.enabled !== undefined) {
      task.enabled = patch.enabled;
    }
    task.updated_at = new Date();
    await this.taskRepo.save(task);

    // Reschedule or stop the cron job
    if (task.enabled && this.handlers.has(name)) {
      this.createCronJob(name, task.cron_expression);
    } else {
      try { this.schedulerRegistry.deleteCronJob(name); } catch {}
    }

    return task;
  }

  async getTaskRuns(name: string, page = 1, limit = 20): Promise<{ runs: ScheduledTaskRun[]; total: number }> {
    const task = await this.taskRepo.findOneBy({ name });
    if (!task) throw new NotFoundException(`Task '${name}' not found`);

    const [runs, total] = await this.runRepo.findAndCount({
      where: { task_name: name },
      order: { started_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { runs, total };
  }

  async triggerTask(name: string): Promise<void> {
    if (!this.handlers.has(name)) {
      throw new NotFoundException(`Task '${name}' not found or has no handler`);
    }

    // Fire and forget — don't block the HTTP request
    this.executeTask(name).catch(err => {
      this.logger.error(`[${name}] Manual trigger failed: ${err.message}`);
    });
  }

  private validateCron(expression: string) {
    try {
      // Use CronJob constructor to validate the expression
      new CronJob(expression, () => {});
    } catch {
      throw new BadRequestException(`Invalid cron expression: '${expression}'`);
    }
  }
}

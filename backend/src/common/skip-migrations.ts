import { parseBoolean } from './env';

/**
 * Whether `SKIP_MIGRATIONS` asks the start to leave the migrations to a separate step (a migration
 * Job, `npm run migrate`): `true`, `1`, `yes`, `y` or `on`, in any case, spaces ignored
 * (`parseBoolean`). Read by the API's start (app.module.ts) and by the image entrypoint, which
 * keeps a copy of this rule in `scripts/migrate-and-start.js` (CommonJS, outside dist).
 * `startup-migrations.spec.ts` checks that the two agree.
 */
export function migrationsSkipped(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBoolean(env.SKIP_MIGRATIONS);
}

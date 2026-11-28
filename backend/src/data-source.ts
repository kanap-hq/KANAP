import 'dotenv/config';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [__dirname + '/**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  ssl: false,
  // The image entrypoint migrates through this source: pg_stat_activity shows who holds the migration lock.
  applicationName: 'kadratis-migrate',
});

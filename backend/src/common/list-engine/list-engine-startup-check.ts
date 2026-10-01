import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { checkListEngineSupport } from './list-engine-support';

/** Checks once at startup that the database can run the list engine, and logs the outcome (see `list-engine-support.ts`). */
@Injectable()
export class ListEngineStartupCheck implements OnApplicationBootstrap {
  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    await checkListEngineSupport(this.dataSource.manager);
  }
}

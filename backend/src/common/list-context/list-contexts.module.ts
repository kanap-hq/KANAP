import { Global, Module } from '@nestjs/common';
import { ListContextsController } from './list-contexts.controller';
import { ListContextsService } from './list-contexts.service';

/** Saved list states (`ctx=<id>`): the endpoints, and the service the request interceptor and the purge use. */
@Global()
@Module({
  controllers: [ListContextsController],
  providers: [ListContextsService],
  exports: [ListContextsService],
})
export class ListContextsModule {}

import { Module } from '@nestjs/common';
import { DataAccessController } from './data-access.controller';

@Module({
  controllers: [DataAccessController],
})
export class DataAccessModule {}

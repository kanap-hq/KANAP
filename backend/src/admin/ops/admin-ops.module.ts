import { Global, Module } from '@nestjs/common';
import { AdminOpsController } from './admin-ops.controller';
import { OpsMetricsStore } from './ops-metrics.store';
import { DbMetricsService } from './db-metrics.service';
import { OpsMetricsController, OpsMetricsTokenGuard } from './ops-metrics.controller';
import { OpsSnapshotService } from './ops-snapshot.service';

@Global() // Global so main.ts can resolve OpsMetricsStore for the middleware
@Module({
  controllers: [AdminOpsController, OpsMetricsController],
  providers: [OpsMetricsStore, DbMetricsService, OpsSnapshotService, OpsMetricsTokenGuard],
  exports: [OpsMetricsStore],
})
export class AdminOpsModule {}

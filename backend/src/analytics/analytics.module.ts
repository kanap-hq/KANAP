import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalyticsAxis } from './analytics-axis.entity';
import { AnalyticsCategory } from './analytics-category.entity';
import { AnalyticsAxesController } from './analytics-axes.controller';
import { AnalyticsAxesService } from './analytics-axes.service';
import { AnalyticsCategoriesCsvService } from './analytics-categories-csv.service';
import { AnalyticsCategoriesService } from './analytics-categories.service';
import { AnalyticsCategoriesController } from './analytics-categories.controller';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyticsCategory, AnalyticsAxis]),
    AuditModule,
    PermissionsModule,
    forwardRef(() => UsersModule),
  ],
  controllers: [AnalyticsCategoriesController, AnalyticsAxesController],
  providers: [AnalyticsCategoriesService, AnalyticsAxesService, AnalyticsCategoriesCsvService],
  exports: [AnalyticsCategoriesService, AnalyticsAxesService],
})
export class AnalyticsModule {}

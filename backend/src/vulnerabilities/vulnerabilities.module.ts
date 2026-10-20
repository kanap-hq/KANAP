import { Module, forwardRef } from '@nestjs/common';
import { ScheduledTasksModule } from '../admin/scheduled-tasks/scheduled-tasks.module';
import { AuditModule } from '../audit/audit.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { TechnologiesModule } from '../technologies/technologies.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { NvdFeedService } from './nvd-feed.service';
import { VulnerabilitySignalsService } from './vulnerability-signals.service';
import { TechnologyVulnerabilitiesController, VulnerabilitiesController, VulnerabilityFeedGuard } from './vulnerabilities.controller';
import { VulnerabilitiesService } from './vulnerabilities.service';
import { VulnerabilityMatchService } from './vulnerability-match.service';
import { VulnerabilityNotificationsService } from './vulnerability-notifications.service';

/**
 * Vulnerabilities (lot T6a): the NVD feed into the platform cache, the matching with each tenant's
 * technologies, the exploitation signals (lot K2a) and the routes. Gated by `VULNERABILITY_FEED_ENABLED`.
 */
@Module({
  imports: [AuditModule, NotificationsModule, PermissionsModule, forwardRef(() => UsersModule), ScheduledTasksModule, TechnologiesModule],
  controllers: [VulnerabilitiesController, TechnologyVulnerabilitiesController],
  providers: [VulnerabilitySignalsService, NvdFeedService, VulnerabilitiesService, VulnerabilityMatchService, VulnerabilityNotificationsService, VulnerabilityFeedGuard],
  exports: [VulnerabilityMatchService],
})
export class VulnerabilitiesModule {}

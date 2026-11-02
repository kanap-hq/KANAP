import { Module } from '@nestjs/common';
import { TechnologyCpeEvents } from './technology-cpe-events';

/**
 * The one bus from a technology change to the vulnerability feed. `TechnologiesModule` and
 * `TenantBaselineModule` both import it. The baseline keeps its own `TechnologyCatalogService`
 * (importing `TechnologiesModule` there would loop through `DemoDataModule`), and that instance
 * emits on the same bus the feed subscribes to.
 */
@Module({
  providers: [TechnologyCpeEvents],
  exports: [TechnologyCpeEvents],
})
export class TechnologyCpeEventsModule {}

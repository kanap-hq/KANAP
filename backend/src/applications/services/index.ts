// Base utilities (internal, not re-exported)
export { ApplicationsBaseService, ServiceOpts } from './applications-base.service';

// Specialized sub-services
export { ApplicationsListService } from './applications-list.service';
export { ApplicationsCrudService } from './applications-crud.service';
export { ApplicationsOwnersService } from './applications-owners.service';
export { ApplicationsInstancesService } from './applications-instances.service';
export { ApplicationsResidencyService } from './applications-residency.service';
export { ApplicationsStructureService } from './applications-structure.service';
export { ApplicationsLifecycleService } from './applications-lifecycle.service';
export { ApplicationsRelationsService } from './applications-relations.service';

// Main facade service
export { ApplicationsService } from './applications.service';

import type { AiImportKey } from '../import/ai-import-access';
import { AccountsController } from '../../accounts/accounts.controller';
import { AnalyticsCategoriesController } from '../../analytics/analytics-categories.controller';
import { ApplicationsController } from '../../applications/applications.controller';
import { AssetsController } from '../../assets/assets.controller';
import { BusinessProcessesController } from '../../business-processes/business-processes.controller';
import { CompaniesController } from '../../companies/companies.controller';
import { ContactsController } from '../../contacts/contacts.controller';
import { ContractsController } from '../../contracts/contracts.controller';
import { CostCentersController } from '../../cost-centers/cost-centers.controller';
import { DepartmentsController } from '../../departments/departments.controller';
import { IncidentsController } from '../../incidents/incidents.controller';
import { PortfolioProjectsController } from '../../portfolio/portfolio-projects.controller';
import { PortfolioRequestsController } from '../../portfolio/portfolio-requests.controller';
import { SpendItemsController } from '../../spend/spend-items.controller';
import { TasksController } from '../../spend/tasks.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { TechnologiesController } from '../../technologies/technologies.controller';
import { WorkingDayProfilesController } from '../../working-day-profiles/working-day-profiles.controller';

export type ImportRouteController = { prototype: object; name: string };

/** The import route of each import Plaid maps a file onto: its controller and method. */
export const AI_IMPORT_ROUTES: Record<AiImportKey, [ImportRouteController, string]> = {
  applications: [ApplicationsController, 'import'],
  assets: [AssetsController, 'importCsv'],
  portfolio_projects: [PortfolioProjectsController, 'importCsv'],
  portfolio_requests: [PortfolioRequestsController, 'importCsv'],
  tasks: [TasksController, 'importCsv'],
  incidents: [IncidentsController, 'importCsv'],
  // OPEX and CAPEX lines share one budget file (`POST /spend-items/budget-file/import`).
  budget_lines: [SpendItemsController, 'importBudgetFile'],
  contracts: [ContractsController, 'import'],
  suppliers: [SuppliersController, 'import'],
  contacts: [ContactsController, 'import'],
  companies: [CompaniesController, 'import'],
  departments: [DepartmentsController, 'import'],
  cost_centers: [CostCentersController, 'import'],
  accounts: [AccountsController, 'import'],
  analytics_categories: [AnalyticsCategoriesController, 'import'],
  business_processes: [BusinessProcessesController, 'import'],
  working_day_calendars: [WorkingDayProfilesController, 'import'],
  technology_asset_links: [TechnologiesController, 'importAssetLinks'],
  technology_application_links: [TechnologiesController, 'importApplicationLinks'],
};

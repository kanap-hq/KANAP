import { OnboardingAngle } from './onboarding-paths';

/**
 * The steps of the own-data paths that are done by themselves: the step's object exists in the
 * workspace (`doc/onboarding.md`, "Steps done by themselves"). Each condition is a boolean SQL
 * expression on the tenant `$1`, and on the user `$2` for a step about the user. The other steps
 * (check your company, explore your project, look at a report) create nothing and are done by
 * hand. The objects count whoever created them: the workspace has them.
 */
const EVIDENCE: Readonly<Record<string, string>> = {
  own_budget_lines: `EXISTS (SELECT 1 FROM spend_items WHERE tenant_id = $1 AND nature IN ('opex', 'capex'))`,
  own_contract: `EXISTS (SELECT 1 FROM contracts WHERE tenant_id = $1)`,
  own_sites: `EXISTS (SELECT 1 FROM locations WHERE tenant_id = $1)`,
  own_applications: `EXISTS (SELECT 1 FROM applications WHERE tenant_id = $1)`,
  // Technologies linked to an application.
  own_technologies: `EXISTS (SELECT 1 FROM application_technologies WHERE tenant_id = $1)`,
  own_assets: `EXISTS (SELECT 1 FROM assets WHERE tenant_id = $1)`,
  // The step ends with the request converted into a project.
  own_request: `EXISTS (SELECT 1 FROM portfolio_requests WHERE tenant_id = $1 AND status = 'converted')`,
  own_tasks: `EXISTS (SELECT 1 FROM tasks WHERE tenant_id = $1 AND related_object_type = 'project')`,
  own_project_budget: `(EXISTS (SELECT 1 FROM portfolio_project_opex WHERE tenant_id = $1)
    OR EXISTS (SELECT 1 FROM portfolio_project_capex WHERE tenant_id = $1))`,
  // Another person has an account, invited or active.
  own_invite: `EXISTS (SELECT 1 FROM users WHERE tenant_id = $1 AND id <> $2 AND status <> 'disabled')`,
};

/** On the portfolio path, `own_invite` is the user's contributor profile, saved once. */
const PORTFOLIO_INVITE = `EXISTS (SELECT 1 FROM portfolio_team_member_configs WHERE tenant_id = $1 AND user_id = $2)`;

/** The condition that makes an own-data step done, or null for a step done by hand. */
export function stepEvidence(key: string, angle: OnboardingAngle): string | null {
  if (key === 'own_invite' && angle === 'portfolio') return PORTFOLIO_INVITE;
  return EVIDENCE[key] ?? null;
}

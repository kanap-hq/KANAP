# Onboarding

At the first opening of a trial workspace, the user picks an angle (budget, IT landscape map,
portfolio) and a mode (discover with the sample data, start with their own data). A list of five
first steps then follows each user's progress through that path.

Code: `backend/src/onboarding/` (service, controller, paths). Migration: `1856010000000-onboarding.ts`.
The API works the same in cloud and on-premise mode (on-premise, `sample_data.status` is `idle`).

## Tables

All three are tenant-scoped: RLS enabled and forced, policy `<table>_tenant_isolation`
(`tenant_id = app_current_tenant()`, USING and WITH CHECK). The tenant reset keeps them
(`TENANT_RESET_KEEP_TABLES`): the answers and the steps outlive "start with my own data", which
resets the workspace. The operator's tenant export exports them.

| Table | Key | Columns |
|---|---|---|
| `tenant_onboarding` | `tenant_id` | `angle` (`budget`, `cartography`, `portfolio`, null), `mode` (`example`, `own_data`, null), `chosen_at`, `chosen_by` (user, set to null when the user is deleted), `created_at`, `updated_at` |
| `onboarding_steps` | `id`; unique `(tenant_id, user_id, angle, mode, step_key)` | `user_id`, `angle`, `mode`, `step_key`, `done_at` |
| `onboarding_dismissals` | `(tenant_id, user_id)` | `dismissed_at` |

`onboarding_steps` and `onboarding_dismissals` reference the user by `(tenant_id, user_id)` and
go with the user.

## Paths

`backend/src/onboarding/onboarding-paths.ts` holds the five step keys of each path, in order. The
keys are stored: never rename one.

| Angle / mode | Steps |
|---|---|
| `budget` / `example` | `budget_overview`, `budget_line`, `budget_report`, `budget_plaid`, `budget_import` |
| `budget` / `own_data` | `own_company`, `own_budget_lines`, `own_contract`, `own_report`, `own_invite` |
| `cartography` / `example` | `map_overview`, `map_application`, `map_technologies`, `map_vulnerabilities`, `map_import` |
| `cartography` / `own_data` | `own_applications`, `own_technologies`, `own_assets`, `own_map`, `own_invite` |
| `portfolio` / `example` | `portfolio_overview`, `portfolio_request`, `portfolio_planning`, `portfolio_plaid`, `portfolio_import` |
| `portfolio` / `own_data` | `own_projects`, `own_request`, `own_project_budget`, `own_planning`, `own_invite` |

## Routes

Every signed-in user of the workspace (JWT only, no module level). The request transaction
carries the tenant. Every route answers `200` with the state after the operation, for the calling
user.

```
GET    /api/onboarding
PUT    /api/onboarding/choice            body { angle?, mode? }
POST   /api/onboarding/steps/:key/done
DELETE /api/onboarding/steps/:key/done
POST   /api/onboarding/dismiss
DELETE /api/onboarding/dismiss
```

Response:

```json
{
  "angle": "budget",
  "mode": "example",
  "chosen_at": "2026-11-02T09:14:00.000Z",
  "can_choose": false,
  "steps": [{ "key": "budget_overview", "done_at": "2026-11-02T09:20:00.000Z" }, { "key": "budget_line", "done_at": null }],
  "next_step": "budget_line",
  "completed": false,
  "dismissed_at": null,
  "sample_data": { "status": "loading", "step": "companies" },
  "reset_in_progress": false
}
```

- `steps`: the five steps of the current path, in order, each with the date this user did it in
  this path. `[]` without an angle or a mode. Steps done in another path are kept for it.
- `next_step`: the first step not done; `null` when all are done or there is no path.
  `completed`: the five are done.
- `can_choose`: true while neither an angle nor a mode is set, and always for an administrator
  (the Administrator role, main or additional, on an enabled account: `isTenantAdministrator`).
- `sample_data`: `status` and `step` of `tenants.metadata.demo` (`idle` when absent or
  malformed). `reset_in_progress`: `status = 'resetting'`.

### Rules

`PUT /choice`:
- At least one of `angle` and `mode`: `400` `choice_required` otherwise. A value outside the
  lists, or `null`: `400` `invalid_angle` / `invalid_mode`. A field left out keeps its value.
- The first user who answers sets a field. Changing a field already set takes an administrator:
  `403` `administrator_required`, and nothing is written.
- The same value as the current one writes nothing and logs nothing.
- The tenant's row is created if missing, then locked (`FOR UPDATE`): two first answers at the
  same time apply one after the other, and only the first logs events.

`POST /steps/:key/done`: `409` `no_choice` without an angle or a mode; `400` `unknown_step` when
the key is not in the current path. A step already done is left as it is. `DELETE` removes the
step of the current path if it is done (same `409` and `400`). A user's step writes are
serialized by a transaction lock on the tenant and the user.

`POST /dismiss` hides the list for the calling user, `DELETE /dismiss` shows it again. Both are
idempotent.

## Audit log

Written in the request's transaction: `table_name = 'onboarding'`, `record_id` = the tenant id,
`user_id` = the user, `source = 'user'`. No parent (`parent_table` and `parent_id` stay null).

| `action` | When | `after_json` |
|---|---|---|
| `onboarding.angle_chosen` | the angle changes (the first choice included) | `{ angle, previous }` |
| `onboarding.mode_chosen` | the mode changes | `{ mode, previous }` |
| `onboarding.step_done` | a step goes from not done to done | `{ angle, mode, step_key }` |
| `onboarding.completed` | that step completes the path for this user, and no `onboarding.completed` exists yet for this user, angle and mode | `{ angle, mode }` |

Nothing is logged for a step undone or for the list hidden or shown.

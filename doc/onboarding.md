# Onboarding

At the first opening of a trial workspace, the user picks an angle (budget, IT landscape map,
portfolio) and a mode (discover with the sample data, start with their own data). A list of five
first steps then follows each user's progress through that path.

Code: `backend/src/onboarding/` (service, controller, paths). Migration: `1856010000000-onboarding.ts`.
The API works the same in cloud and on-premise mode (on-premise, `sample_data.status` is `idle`
and the mode has no effect on the workspace: see "Effect of the mode").

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

`onboarding_steps` and `onboarding_dismissals` reference the user by `(tenant_id, user_id)` with
`ON DELETE CASCADE`: a deleted user's rows go with them. This includes the sample data accounts
that the tenant reset deletes.

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
PUT    /api/onboarding/choice            body { angle?, mode?, confirm_reset? }
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
- `can_choose`: true while the angle or the mode is missing, so that any user can set the missing
  field, and always for an administrator (the Administrator role, main or additional, on an
  enabled account: `isTenantAdministrator`). Changing a field already set still takes an
  administrator.
- `sample_data`: `status` and `step` of `tenants.metadata.demo` (`idle` when absent or
  malformed). `reset_in_progress`: the workspace is being emptied: `status = 'resetting'`, or
  `status = 'loading'` with a stop of the load asked for (`cancel_requested_at`). The answer to a
  `PUT /choice` that started a reset or a stop says `true` even if the reset is already over;
  the interface then polls `GET`.

### Rules

`PUT /choice`:
- At least one of `angle` and `mode`: `400` `choice_required` otherwise. A value outside the
  lists, or `null`: `400` `invalid_angle` / `invalid_mode`. A field left out keeps its value.
- `confirm_reset` (optional, boolean; any other value: `400` `invalid_confirm_reset`) lets
  `own_data` erase objects created since the sample data load (see below).
- The first user who answers sets a field. Changing a field already set takes an administrator:
  `403` `administrator_required`, and nothing is written.
- The same value as the current one writes nothing and logs nothing.
- The tenant's row is created if missing, then locked (`FOR UPDATE`): two first answers at the
  same time apply one after the other. The second one then meets a field already set. With the
  same value, it answers `200` and writes nothing. With another value, it gets `403`
  `administrator_required` from a user who is not an administrator; from an administrator, it
  changes the value and logs its own event.

### Effect of the mode

A new mode acts on the sample data (`DemoDataService`) before the choice is written. Cloud only,
never on a system tenant. On-premise there is no sample data: the choice is written and nothing
else happens. The sample data load at trial activation takes 20 s to 2 min, so the user often
answers while it runs.

`own_data`, by the state of `tenants.metadata.demo`, chosen by an administrator:

| Status | Effect |
|---|---|
| `loaded` | Reset of the workspace (`startReset`, no name to type). When objects were created since the load (`countCreatedSinceLoad > 0`): `409` `sample_data_modified` with `created_since_load` (their number), nothing written and nothing started, unless the body has `confirm_reset: true` |
| `loading` | Stop of the load, then reset; the status ends `idle`, not `failed` |
| `failed` with `error_code = 'reset_failed'` | Reset of the workspace (the reset after the failed load failed: sample data is still there) |
| `failed`, any other code | No reset: the workspace was reset when the load failed. The status goes back to `idle` (code and failure dates cleared), by a write conditioned on `failed` and the run id (`clearFailedLoad`) |
| `idle`, `resetting` | Nothing to erase |

- An administrator's choice first hides the sample data banner of the home page
  (`metadata.demo.dismissed_at`), unless the status is `loaded` (the reset hides it, in the
  write that starts it). This write goes through the pool and is committed at once, before the
  effect is decided: a load at trial activation still waiting for a free slot can no longer
  claim it. Its claim moves the status to `loading` only while `dismissed_at` is absent
  (`loadDemoData` with `unlessBannerHidden`, given by `provisionTrialSampleData` only),
  otherwise `409` `demo_load_declined`. The Administration page load and the `example` choice
  are not bound by the banner.
- The request's transaction never writes the tenant row: every write of the sample data state
  goes through the pool. A stop or a reset started here then waits for no lock of this request.
  The reset's own lock on the tenant row waits for the request to commit when the request
  created the onboarding row (first choice).
- A user who is not an administrator changes nothing: no reset, no stop, the banner and a load
  at activation still waiting left alone; the choice is written if the rules above allow it.
  While the workspace holds sample data (`loaded`, `loading`, `failed` with `reset_failed`) the
  choice is refused, `403` `administrator_required`, even for the workspace's first choice, and
  nothing is written.
- The reset keeps what the tenant reset keeps: the workspace name, the starting company
  (created again from the trial sign-up), the AI settings, the real users and their names, the
  language, and the onboarding tables. The administrators get no "workspace reset" e-mail for a
  reset set off by this choice. The Administration page reset still sends it.
- Stopping a load (`DemoDataService.cancelLoad`): `cancel_requested_at` and
  `cancel_requested_by` are written in the state while the status is `loading` with the same run
  id, whatever the heartbeat; `cancelLoad` says whether it wrote them (`requested`). The API
  process that runs the loader kills it at once when it is the one that got the request, at its
  next heartbeat (15 s) otherwise. The load then ends as a failed one does: reset once the
  loader has exited, but final status `idle`, no error code, a "cancelled" line in the server log
  and no e-mail. A loader that ends with success after the request is not marked loaded: it is
  reset the same way. When nothing was written (the load ended meanwhile), the rule of the new
  status applies (`loaded`, `failed`, or nothing). A load whose API process stopped is taken
  over right after the request is written, so it ends `idle` as well, not `failed` /
  `load_interrupted`.
- Until the API process that runs the loader sees the stop (up to one heartbeat when it is
  another process), the status stays `loading` and the workspace accepts writes; what the user
  writes in those few seconds is erased by the reset that follows.
- The effect is committed on its own connections before the choice is written. If the request
  fails after that (client gone, timeout, audit write), the workspace is emptied and the choice
  is not written: the dialog comes back and the user chooses again (`own_data` on `idle` then
  only writes the choice).

`example`: when the workspace is empty of sample data (`idle`, or `failed` with any code but
`reset_failed`: the failed load was reset) and the user is an administrator, the sample data load
starts (`loadDemoData`, the tenant's seed language, the request's Host header as for the
Administration page). A refused load (workspace not empty, subscription, too many loads at
once) still writes the choice, with one warning in the server log; `sample_data` shows the state.
Another user's choice is written and loads nothing.

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

For the measures:
- `onboarding.step_done` is logged again when a step undone is done again. Count the steps done
  by distinct `step_key` per user, angle and mode, or read `onboarding_steps`.
- `onboarding.completed` is logged once per user, angle and mode.

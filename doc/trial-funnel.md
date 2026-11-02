# Trial funnel

Platform administration shows where each trial stands, from the sign-up to the conversion: **Trials** in the platform console (`/admin/trials`). Everything comes from the audit log and the tables that already hold it; the funnel tracks nothing of its own. Cloud only: on-premise the route answers 404 and the page is not rendered (Feature Gate Inventory in `on-premise/technical-design.md`).

Code: `backend/src/admin/trials/`, `frontend/src/pages/admin/AdminTrialsPage.tsx`.

## Rows

One row per trial sign-up (`trial_signups`), with its workspace when the activation link was opened and the workspace still exists. Deleting a workspace deletes its sign-up, so it leaves the funnel.

| Column | Source |
|---|---|
| Signed up, activated | `trial_signups.created_at`, `activated_at` (the workspace is created at activation) |
| State | `awaiting_activation` (no workspace), `converted` (subscription linked to Stripe), `internal` (plan `Internal`), `trialing` (trial end ahead), `ended` |
| First sign-in, last sign-in | `auth` audit events `login` and `sso_login`; the last one also reads `users.last_login_at` |
| Path, steps | `tenant_onboarding.angle` and `mode`; the steps of that path done in `onboarding_steps`, the best person of the workspace, out of five |
| Sample data | `tenants.metadata.demo.ever_loaded_at` |
| First record | The first `create` audit row of a record the history knows (`record-history.inventory.ts`), in a person's name (not `system` nor `webhook`) |
| First question to Plaid | The first `user` message in `ai_messages` |
| First import | The first audit row written by the budget file (`source = 'budget_file'`) or another import source (`source` naming `import`). CSV imports of most families write no audit row and do not show |
| First invitation | The first `users` audit row whose `after_json.status` is `invited` |
| Back after 1 day, after 7 days | The first activity at least that long after the first sign-in: a sign-in, an audit row in a person's name or a question to Plaid. A session lasts several days without a new sign-in, and a visit that writes nothing leaves no trace. "No" once the window has passed |
| Trial end, converted | `subscriptions.trial_end`; the first `subscriptions` audit row linked to Stripe |
| Call link clicked | The first `trial.discovery_call_clicked` and its placement (`discovery-call.md`) |
| Discovery call | `DiscoveryCallService.read`; set by hand from the page |

The sample data and a workspace reset write their rows in the name of the person who asked for them. A creation or an import counts only after the latest of the activation, the last complete load of the sample data (`ever_loaded_at`, `loaded_at`) and the last reset (`tenants_admin` audit row with `source_ref = 'demo-reset'`). While a load or a reset runs, nothing counts yet.

## Alert

A running trial whose workspace has had no sign-in 24 hours after its activation (`NO_SIGN_IN_ALERT_HOURS`) is flagged: its row comes first with an orange dot, and the page says how many there are. No e-mail is sent.

## Weekly counts

The sign-ups of each of the last eight weeks (Monday, UTC), and how many of them were activated, signed in and converted since.

## API

- `GET /admin/trials?state=` (platform administrator, platform host): `{ items, weeks, attention }`. `state` is one of the states above; an unknown value is ignored. `items` come with the flagged workspaces first, then the most recent sign-ups.
- `PUT /admin/trials/:tenantId/discovery-call { scheduled_at, status?, note? }`: the discovery call set by hand (`DiscoveryCallService.saveManual`, 400 `discovery_call_invalid`), audited in the trial workspace with the platform administrator as `user_id`. 404 when the workspace has no trial sign-up.
- `DELETE /admin/trials/:tenantId/discovery-call`: removes it (204).

Each workspace is read in its own tenant transaction, four at a time.

# Smoke test

`recette.mjs` checks in a few seconds that a KANAP instance works after an update. It calls the
public API the way the web app does, prints one line per check and exits with a non-zero code when a
check fails. It needs Node 20 or later and no npm package.

## Run it

```bash
KANAP_URL=http://fromage.lvh.me \
KANAP_EMAIL=<user email> \
KANAP_PASSWORD=<password> \
node scripts/smoke/recette.mjs
```

| Variable | Meaning |
|---|---|
| `KANAP_URL` | Address of the tenant, as users open it in the browser (for example `https://kanap.example.com`). Required. |
| `KANAP_EMAIL`, `KANAP_PASSWORD` | A local account of that tenant. Required, no default, never printed. |
| `KANAP_INSECURE_TLS=1` | Accept a self-signed HTTPS certificate. The script prints a warning and stops verifying certificates for this run. |
| `KANAP_WRITE=1` | Also run the write checks below. Off by default. Never use it in production. |

Add `--json` for machine-readable output (one JSON document on stdout; warnings go to stderr).

Exit codes: `0` when no check failed, `1` when at least one failed, `2` for a missing or invalid setting.

Pass the password through the environment of the command (or a shell variable read with
`read -s`), so it stays out of files and of the output.

## What it checks

The script logs in once per run (the login endpoint allows 5 calls per minute), reuses the access
token and logs out at the end.

| Check | Route |
|---|---|
| Health | `GET /api/health` |
| Public config (deployment mode, version) | `GET /api/config/public` |
| Login | `POST /api/auth/login` |
| Current user | `GET /api/auth/me` |
| Token refresh with the refresh cookie | `POST /api/auth/refresh` |
| Companies | `GET /api/companies` |
| OPEX items | `GET /api/spend-items` |
| CAPEX items | `GET /api/capex-items` |
| Portfolio projects and requests | `GET /api/portfolio/projects`, `GET /api/portfolio/requests` |
| Knowledge documents | `GET /api/knowledge` |
| Tasks | `GET /api/tasks` |
| Audit log | `GET /api/audit-logs` |
| CSV export: `text/csv` type and a header line | `GET /api/companies/export` |
| DOCX export of the first knowledge document: ZIP signature | `POST /api/knowledge/:id/export` |
| AI configuration state (no model is called) | `GET /api/ai/capabilities`, `GET /api/ai/settings` |
| Logout | `POST /api/auth/logout` |

With `KANAP_WRITE=1` the script also creates a standalone task titled `recette <timestamp>`, attaches
a small text file, reads both back, downloads the file, then deletes the attachment and the task and
checks that the task is gone. The cleanup runs even when an earlier check fails or the run is
interrupted with Ctrl+C. Write checks need the tasks administrator level (deleting a task requires
it); with a lower level they are skipped. The audit log keeps the entries for the temporary task.

## Reading the result

- `OK`: the check passed.
- `SKIP`: the check did not run, with the reason. A `403` (the account lacks the right) is a skip.
- `FAIL`: a server error (5xx), an unexpected status, a malformed response or a network error.

Use an administrator account to cover every check. A run with a reader account passes with more
skips.

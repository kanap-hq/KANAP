# Knowledge search bench of the support agents

Measures how well a helpdesk agent finds and cites the right knowledge document, on hand-written
tickets, through the real triage chain and the real model. Three numbers, per family of tickets and
in total:

1. **First five**: the expected document is among the first five candidates after the merge of the
   search results.
2. **Cited**: the expected document is cited by the reply the agent proposes to the requester.
3. **Abstention**: when no document answers, the reply cites none (a published document listed as
   `acceptable` in the ticket is no fault).

Plus the cost (tokens of each model step, priced at the list price of the included model) and the
time of one triage. When the expected document is not cited, the report names the step where it was
lost: never found, found outside the first five, set aside by the interpreter, no reply proposed,
not cited in the reply.

The bench is a development tool: it does not run in CI and adds nothing to the product.

## How it plays a ticket

`run` calls the agent's manual run on a ticket (`POST /api/ai/admin/control-plane/uat/ticketing-triage`,
the "test on a ticket" of the agent screen) for each ticket of the set. The agent reads the ticket from
GLPI; the bench serves its tickets through a small fake GLPI (`fake-glpi.mjs`), read-only, that the API
reaches over HTTP. The answer of the route carries every step of the chain (need, generated queries,
candidates, interpreter, documents read, planner, synthesis, proposed reply, token usage):
`lib/extract.mjs` reads it. Each run reads fresh GLPI ticket ids, so the agent queue never takes a
bench ticket for one it has already handled. Nothing is written to GLPI: proposals wait for an
approval that never comes and expire.

## Files

- `data/tickets.json`: the tickets (number, family, language, title, description, expected article
  keys, `forbidden` draft or obsolete articles, `acceptable` articles) and the five support articles
  of the sample data (`fixture_articles`, matched by title in the library "Service Desk Docs").
- `data/articles/*.md`: the bench articles (front matter: title, summary, status, lang). In the
  tenant they are titled `[R2] <title>`, in the library "R2 banc".
- `bench.mjs`: the command line. `lib/`: set, setup, player, extraction, scores, reports.
- `__tests__/`: `node --test` tests of the pure parts (no network, no database).

## Prepare a tenant

The tenant needs the sample data (library "Service Desk Docs" with its five articles), the included
model accepted by an administrator, and an administrator account for the bench. Accounts come from a
JSON file outside the repository (`{"<account>": {"email": "...", "password": "..."}}`, `--account`
picks one, `claude` by default) or from `KB_EMAIL` and `KB_PASSWORD`. The database URL (read-only
use: setup checks) comes from `--database-url` or `KB_DATABASE_URL`.

```sh
cd backend/scripts/knowledge-bench
export KB_DATABASE_URL=postgres://app:app@localhost:5432/appdb
node bench.mjs setup --tenant <slug> --accounts <accounts.json> --glpi-url http://<address the API reaches>:<port>/
```

`setup` creates the library "R2 banc" and its articles (replaces an article whose text or status
changed), points the tenant's GLPI connection at the fake GLPI, and creates the agent "R2 banc agent"
(helpdesk, GLPI, manual runs only, knowledge search on "Service Desk Docs" and "R2 banc", web off).
It is idempotent. It changes the tenant's GLPI connection: use a tenant reserved for benches.

The fake GLPI must be reachable from the API container, and the address must pass the outbound
address guard of the cloud mode (`SSRF_ALLOWED_HOSTS`). On a dev machine with a host firewall, listen
on the host address of the Docker network, on a port the firewall lets in.

## Run

```sh
node bench.mjs run --tenant <slug> --accounts <accounts.json> --glpi-listen <host>:<port> --label "<what is measured>"
```

Options: `--only 1,4,10-12` and `--family paraphrase,exact_code` pick tickets; `--out <dir>` sets where
runs go (default `~/.cache/kadratis-knowledge-bench/`). Two runs at once (two tenants): start one fake
GLPI with `node bench.mjs serve-glpi --glpi-listen <host>:<port>` and give `--external-glpi` to both
runs. A run of the whole set takes 20 to 30 minutes and spends one included message per ticket.

When the API is unreachable during a ticket (network cut, 502, 503 or 504 while the stack restarts),
the player waits until `/api/config/public` answers again and replays the ticket under a fresh GLPI id;
an outage is never counted as a miss. `node bench.mjs replay <run dir> --tenant .. --accounts ..
--external-glpi` replays the tickets of an older run that failed that way and rebuilds its report.

Each run writes a directory `<tenant>-<time>/`: `run.json` (tenant, label, served version, start and
end), `results.jsonl` (one line per ticket), `raw/ticket-NN.json` (the whole answer of the route),
`fake-glpi.log` and `report.md`.

## Read and compare

- `node bench.mjs report <run dir>` rebuilds `report.md`: the three numbers per family, the losses by
  step, one line per ticket (rank of the expected document, first five, what the interpreter kept,
  what was cited), and the generated queries of every missed ticket.
- `node bench.mjs compare <run A> <run B>` prints the numbers side by side and the tickets whose
  verdict changed.

The model is not deterministic: compare runs of the same code first to see the spread, then runs
before and after a change.

## Tests

```sh
node --test backend/scripts/knowledge-bench/__tests__/*.test.mjs
```

## What the bench does not measure

- Kad and the MCP server (same search function, other callers), and the monitoring flow.
- Tickets with several messages, attachments or screenshots: each bench ticket is one description.
- The quality of the reply beyond its sources: a cited document does not prove the reply is right.
- Libraries the agent may not read, and data-scoped access.

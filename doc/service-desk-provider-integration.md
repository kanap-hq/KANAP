# Adding a Service Desk Provider to the Agentic Control Plane

Audience: the engineer (or AI agent) tasked with connecting a new service desk tool — Freshdesk, Jira Service Management, Zammad, … — to KANAP's provider-agnostic Helpdesk agent. Freshdesk is used as the worked example throughout; substitute your provider key everywhere `freshdesk` appears.

Scope: after this integration, the existing Helpdesk agent (triage, ingestion/watching, sourced replies, approval-gated writes, targeting, evaluation) runs against the new tool with **zero changes to the control plane**. The work is one adapter class, one registration entry, one tenant configuration row, and tests.

Status of the platform: the GLPI decoupling (see `planning/agentic-control-plane/36-glpi-decoupling-plan.md`) made every layer above the adapter provider-neutral. The capability dispatcher, work queue, LLM pipeline (planner/synthesis/evidence), approval flow, targeting, and frontend monitor all resolve the provider from the agent definition's binding at runtime. GLPI survives only as one adapter among N plus explicitly-labeled legacy compatibility surfaces.

---

## 1. Architecture you are plugging into

```
Agent runtime (triage / ingestion / planner / synthesis)
        │  resolves provider from agent definition binding
        ▼
Capability dispatcher  ──  ticketing.ticket.* capabilities (neutral names)
        │  providers.ticketing(context, providerKey)
        ▼
AiProviderRegistryService  ──  (provider_kind, implementation) lookup
        │  binds ProviderAdapterRuntime (base_url + resolved credential)
        ▼
YOUR ADAPTER (implements TicketingProvider)  ──  the ONLY place that
        │                                        knows the tool's API
        ▼
External service desk (Freshdesk REST API, …)
```

Non-negotiable invariants (from `planning/agentic-control-plane/01-architecture.md` and `05-adapter-contracts.md`):

- Provider-specific ids, status codes, payload shapes, and URLs stay **inside the adapter**. Everything you return is a normalized DTO.
- Provider outputs are untrusted evidence: normalize, redact personal data where possible, never persist raw payloads by default.
- Every write follows **prepare → action-request → approval → execute-approved** with an idempotency key. The adapter never decides to write; it prepares and executes.
- Credentials are tenant-scoped, resolved by the platform, and never appear in prompts, logs, errors, or evidence.
- Every DB row you touch carries `tenant_id` (RLS is FORCEd on all control-plane tables).
- Fail closed: a misconfigured/unreachable provider returns structured unavailability, never a mock fallback or partial write.

## 2. What already works with no changes

Verified provider-neutral (2026-07-05 review): capability execution paths, work-queue claim/enqueue/dedup, scheduled ingestion, targeting predicates + reference-data pickers, planner/synthesis prompts (provider flavor arrives via your `actionPlannerProfile`), delegated execution readiness, approval windows, per-run caps, evaluation scoping, frontend monitor/workspace (they derive the provider key from the definition binding).

Known platform gaps you must handle as part of the integration (not blockers, just steps):

| Gap | Impact | What to do |
|---|---|---|
| No admin UI/API writes `ai_adapter_configs` | Tenant provisioning is script/SQL based | Write `scripts/<provider>-adapter-config-upsert.ts` modeled on `glpi-adapter-config-upsert.ts` (dry-run default + typed confirmation env), or provision by SQL (§6) |
| `AdminIntegrationsPage` is GLPI-only | No settings UI for the new provider | Acceptable for first customer (operator provisioning). Optional: add a provider section driven by adapter configs |
| Leftover `helpdesk.glpi.triage` rows on older tenants | Cosmetic only — the product no longer seeds this key | Ignore or delete from the agent's card. New helpdesk agents get a unique key from the wizard; the GLPI-named leftover is never re-created |
| New-agent wizard defaults provider to `glpi` | Only relevant when creating extra agents by hand | The seed path auto-binds correctly (§7); fix the wizard default opportunistically |
| Terminal backstop constants hardcode `solved`/`closed` | Legacy persisted-row backstops in `ai-agent-control.service.ts` (`PLANNER_TERMINAL_TRANSITIONS`) and `ai-capability.registry.ts` (`TICKETING_TERMINAL_TRANSITIONS`) | Use `solved`/`closed` as your terminal transition keys (§4.3) and stamp `terminal: true`; then the backstops align for free |

## 3. Deliverables checklist

1. `backend/src/ai/freshdesk/freshdesk.service.ts` (+ `.types.ts`) — HTTP client. Mirror `ai/glpi/glpi.service.ts` in role only; Freshdesk is sessionless (API key), so it will be much simpler.
2. `backend/src/ai/control-plane/providers/freshdesk-ticketing.provider.ts` — the adapter, `implements TicketingProvider`.
3. Constants in `providers/provider-constants.ts` (e.g. `FRESHDESK_TICKETING_IMPLEMENTATION = 'freshdesk'`).
4. Registration entry in `backend/src/ai/ai.module.ts` (§5).
5. Provisioning script `backend/scripts/freshdesk-adapter-config-upsert.ts` + package.json script.
6. Tests: adapter unit spec, control-plane parity additions, live-readiness registration (§8).
7. Doc updates: feature-gate inventory untouched (no gating here), but add the provider to `doc/architecture.md`'s adapter table if present.

## 4. The adapter

### 4.1 Contract

`backend/src/ai/control-plane/providers/provider.types.ts` — `TicketingProvider extends ProviderBase`. All 20+ methods are required by the interface; the mock (`providers/mocks/mock-ticketing.provider.ts`) implements every one and is your reference implementation. From `ProviderBase`:

- `readonly kind = 'ticketing' as const`
- `readonly providerKey = 'freshdesk'` (the stable key stored in bindings and config rows)
- `readonly actionPlannerProfile` — your `ProviderActionPlannerProfile`: `domain_preamble` (one sentence of provider flavor injected into the action-planner prompt), `action_vocabulary` (typically the same six: `internal_note`, `requester_reply`, `status_update`, `classification_update`, `assignment_update`, `participant_update`), `validation_notes`.
- `health(context)`, `applicability(context)` — see §4.5.
- `executionReadinessForActions?(context, { actions })` — optional. Implement it if your tool needs pre-execution gating (GLPI uses it to require sandbox write targets in eval-only mode). The control plane checks `typeof === 'function'` and skips if absent.

Reads: `getTicket`, `searchSimilarTickets`, `listTicketNotes`, `listTicketsForScope`, `readTicketAttachment`, `describeReferenceEnums`, `searchReferenceCatalog`, and the four context reads (`getTicketClassificationContext`, `getTicketLifecycleContext`, `getTicketRoutingContext`, `getTicketParticipantContext`).

Writes: six prepare/execute pairs (classification, status, assignment, participants, internal note, public reply). Every `prepare*` returns a normalized action payload + human-readable summary; every execute takes `{ actionPayload, idempotencyKey }` and must be idempotent (return `alreadyApplied: true` on replay) and fail closed if the ticket changed materially since prepare.

Everything returns `AdapterResult<T>`: `{ ok: true, data, evidence: AdapterEvidenceSeed[] }` or `{ ok: false, errorCode, message, retryable }`. Structured error codes only (`not_configured`, `unauthorized`, `forbidden`, `not_found`, `timeout`, `rate_limited`, `provider_unavailable`, `invalid_response`, `unsafe_operation`, …) — the dispatcher never parses exception strings. Never echo credential material or raw request bodies in `message`.

### 4.2 Normalization tables (write these first)

The whole platform speaks normalized keys; your adapter owns the two-way mapping. Freshdesk example:

| Freshdesk status | Normalized `TicketRecord.status` key |
|---|---|
| 2 Open | `new` or `processing_assigned` (assigned ⇒ `processing_assigned`) |
| 3 Pending | `pending` |
| 4 Resolved | `solved` |
| 5 Closed | `closed` |

Open-status vocabulary is `OPEN_TICKET_STATUS_VALUES` in `providers/provider-constants.ts` (`new`, `processing_assigned`, `processing_planned`, `pending`, `open`) — your open statuses must map into it or watching/targeting will not match your tickets. Raw numeric codes must never leave the adapter.

| Freshdesk priority | Normalized `TicketRecord.priority` key |
|---|---|
| 1 Low | `low` |
| 2 Medium | `medium` |
| 3 High | `high` |
| 4 Urgent | `very_high` |

Priority keys understood downstream (task import): `very_low`, `low`, `medium`/`normal`, `high`, `very_high`, `major`, `critical`, `blocker`, `optional`.

### 4.3 Lifecycle transitions — terminal flag is load-bearing

`TicketLifecycleTransition` requires `{ key, label, requiresApproval, destructive, terminal }`. `terminal: true` on solve/close transitions is what makes the control plane **hard-block auto-execution** of ticket-closing actions (they always need human approval). Rules:

- Use `solved` and `closed` as the transition keys for your terminal transitions (aligns with the legacy persisted-row backstops, §2).
- Stamp `terminal` into `TicketStatusUpdateActionPayload` at prepare time (the field is required; the compiler enforces it).
- Only offer transitions your API can actually perform; unsupported features return `supported: false` with warnings, never partial writes.

### 4.4 Rich content and attachments (the importer depends on these)

`TicketRecord` must carry `descriptionHtml` (raw HTML — keeps formatting and inline `<img>` for markdown conversion), `sourceUri` (the human ticket URL — the import footer), and `attachments: TicketAttachmentRef[]` for inline images. `TicketNote` must carry `bodyHtml`. If you skip these, `import_ticket` silently degrades to plain text with orphaned attachments (this exact bug shipped once for GLPI — don't repeat it). `readTicketAttachment` returns base64 data in the capability output but its **evidence seed carries metadata only, never bytes** (documented invariant on the interface).

### 4.5 Applicability, health, credentials

`applicability(context)` is called before every resolution. With `context.adapterRuntime` present (the normal case for a configured tenant): validate `runtime.baseUrl` and `runtime.credential` and return `{ available: false, reasonCode: 'provider_not_configured' | 'missing_credentials' | 'malformed_config' }` on any gap. There is **no legacy-settings fallback for new providers** — that path (`ai_settings.glpi_*`) is GLPI-only compat.

Credential access: `context.adapterRuntime.credential?.reveal()` returns the secret material the platform resolved (§6). Pick a documented format and parse defensively — recommended for Freshdesk: plain string = API key, or JSON `{ "api_key": "...", "domain": "..." }`. Malformed material ⇒ `malformed_config` with a sanitized message (never echo the material).

Freshdesk auth is `Basic base64(api_key + ":X")` against `https://<domain>.freshdesk.com/api/v2/...` — stateless, so no session management; respect `Retry-After` on 429 and map it to `rate_limited` + `retryable: true`.

### 4.6 Evidence seeds

Every successful read/write returns `AdapterEvidenceSeed[]`: `sourceProvider: 'ticketing:freshdesk'`, `sourceType` (e.g. `ticket`, `ticket_note`), `sourceId`, `sourceUri`, `collectedAt`, `trustLevel: 'customer_system'`, one-line `summary`, and optionally a **redacted** structured payload. The evidence service handles hashing/persistence.

## 5. Registration (one entry, no registry edits)

`backend/src/ai/ai.module.ts` — extend the existing factory:

```typescript
{
  provide: AI_PROVIDER_IMPLEMENTATIONS,
  useFactory: (glpiTicketing: GlpiTicketingProvider, freshdeskTicketing: FreshdeskTicketingProvider) => [
    { providerKind: 'ticketing', implementation: GLPI_TICKETING_IMPLEMENTATION, provider: glpiTicketing },
    { providerKind: 'ticketing', implementation: FRESHDESK_TICKETING_IMPLEMENTATION, provider: freshdeskTicketing },
  ],
  inject: [GlpiTicketingProvider, FreshdeskTicketingProvider],
},
```

Also register `FreshdeskTicketingProvider` (and its HTTP service) in the module's `providers` array. That is the entire wiring: the registry keys implementations by `${providerKind}:${implementation}` and resolves them from the tenant's adapter config. Do **not** add a legacy-key mapping (`registerLegacyProviderKey`) — that mechanism exists only for GLPI's pre-adapter-config history.

## 6. Tenant provisioning

One row in `ai_adapter_configs` (RLS-protected, unique on `(tenant_id, provider_kind, provider_key)`):

| Column | Value |
|---|---|
| `provider_kind` | `ticketing` |
| `provider_key` | `freshdesk` |
| `implementation` | `freshdesk` |
| `environment` | `production` (or `sandbox` for UAT) |
| `enabled` | `true` |
| `base_url` | `https://<customer>.freshdesk.com` |
| `credential_ref_json` | `{ "kind": "secret_ref", "ref": "tenant/<tenant-uuid>/ticketing/freshdesk", "tenant_id": "<tenant-uuid>" }` |
| `live_test_safety` | `live_read` |

Secret material never goes in the row (`validateConfig` rejects plaintext-looking fields). The resolver maps the `secret_ref` to an environment variable: `KANAP_SECRET_REF_<sha256(tenantId:ref:version).slice(0,32).toUpperCase()>` — compute it with `tenantSecretRefEnvName()` from `tenant-secret-resolver.service.ts` (the readiness script pattern prints it for the operator). The operator sets that env var on the backend runtime (compose env file on QA/prod) to the API key (or credential JSON) before enabling the row.

Build `scripts/freshdesk-adapter-config-upsert.ts` from the GLPI one: dry-run by default, `*_APPLY=1` + typed `*_CONFIRM=` env gates, prints only token *presence* and the computed env-var name, never values.

## 7. Agent binding and seeding

The Helpdesk agent definition binds via `provider_bindings_json`:

```json
{ "ticketing": { "provider_kind": "ticketing", "provider_key": "freshdesk" } }
```

Seeding behavior (`ensureHelpdeskTicketingTriageDefinition`): legacy GLPI settings win if present; otherwise a **single enabled ticketing adapter config** auto-binds the seeded agent to its key. So for a fresh Freshdesk-only tenant, provisioning the config row (§6) before first agent-page load is sufficient — the built-in agent, its scope policy, and its manual trigger all bind to `freshdesk` automatically. For an existing definition, update `provider_bindings_json` through the agent-update endpoint (it audits the diff); the trigger scope reconciles from the binding.

Everything downstream reads the binding: ingestion polling (`listTicketsForScope` with the targeting-derived scope), triage, targeting option pickers (your `describeReferenceEnums`/`searchReferenceCatalog` feed the UI), safe-target listing, readiness, evaluation.

## 8. Testing

1. **Adapter unit spec** (`backend/src/ai/__tests__/freshdesk-ticketing.provider.spec.ts`): per `05-adapter-contracts.md` — missing config, invalid credentials, permission denied, timeout, unavailable, invalid response, not-found, malicious text in provider fields (must arrive as inert normalized text), redaction, evidence seeds, idempotent replay of every execute method, terminal stamping.
2. **Control-plane parity**: the mock-bound tests in `ai-control-plane.spec.ts` already prove the neutral plumbing; add one end-to-end fixture with a fake `freshdesk`-keyed provider (pattern: the `options.ticketingProvider` override in the spec helpers) proving a Freshdesk-bound definition triages, prepares, and executes-with-approval through the dispatcher.
3. **Live readiness**: the harness scenarios are already neutral — `ticketing_read` / `ticketing_sandbox_write`, gated by `KANAP_TICKETING_LIVE_READ` / `KANAP_TICKETING_LIVE_SANDBOX_WRITE` (+ `KANAP_LIVE_CONTRACT_TESTS=1`, `KANAP_LIVE_TENANT_SLUG`, and the scenario's `_PROVIDER_KEY=freshdesk` env). Create an `AiLiveTestTarget` row (`provider_key: 'freshdesk'`, `target_kind: 'ticket'`, `external_ref: <sandbox ticket id>`, `allowed_effect: 'read'` then `'sandbox_write'`, `enabled: true`) pointing at a **sandbox** ticket. Run `npm run live-readiness:contract -- ticketing_read --run` first; writes only after read passes, only against the sandbox target.
4. **Both CI modes** (`multi-tenant` and `single-tenant`) must stay green; nothing here is deployment-mode-gated, but the CI matrix builds both.

## 9. Rollout checklist

- [ ] Adapter + registration merged, CI green both modes
- [ ] Customer sandbox credentials obtained; secret env var set on QA; adapter config row provisioned (dry-run → apply)
- [ ] Live read contract test green on QA against sandbox
- [ ] Agent seeded/bound to `freshdesk`; monitor tab lists safe targets; manual test triage on a sandbox ticket produces internal-note proposals only
- [ ] Autonomy ceiling left at eval/approval-gated defaults (A1-A3); no auto-execution until evaluation history exists (same discipline as the GLPI ramp)
- [ ] Targeting configured through the UI pickers (your reference enums must populate them)
- [ ] Sandbox write test (internal note) green; then production config row, watching enabled with bounded scope (`new_tickets_only` + horizon), technician calibration begins

## 10. What NOT to do

- Do not add `if (providerKey === 'freshdesk')` anywhere above the adapter. If you feel the need, the contract is missing a seam — extend `provider.types.ts` neutrally instead (the way planner profiles, execution readiness, and reference catalogs were added).
- Do not read or write `ai_settings` — that surface is GLPI legacy, scheduled for migration (plan 36, Theme 3).
- Do not reuse GLPI's `glpi_*` preview-metadata keys, discriminators, or routes; the generic `ticket_*` metadata and `uat/ticketing-*` routes are the current path.
- Do not let numeric/raw provider codes appear in `TicketRecord.status`, targeting predicates, or reference items — normalized keys only.
- Do not ship any write path without the prepare/approve/execute flow, idempotency keys, and a changed-since-prepare freshness check.

## 11. Reference: GLPI onboarding rights and gotchas

GLPI is the first adapter (`providers/glpi-ticketing.provider.ts`, HTTP client in `ai/glpi/glpi.service.ts`). Its onboarding rules apply, in spirit, to any provider whose API profile can be restricted.

### Rights the GLPI API profile needs

The service account behind the tenant's connection needs, on its API profile:

- Read on **ITIL categories** and **entities**. Dropdown rights are separate from ticket rights, so a profile that reads tickets can still fail here. Targeting pickers and classification depend on both.
- Read on **groups** and **users**, including the group-membership list. Routing to a group and to a named technician needs them.
- The right to **assign** tickets, for assignment actions.
- **Update** rights on tickets for every write the agent may be given: followups, classification, status and assignment.

A ticket can be routed only to a group flagged **assignable** in GLPI (`is_assign`). The agent's group catalogue contains only those groups. The technician catalogue is the members of those groups, minus the agent's own account.

A profile without read access to users or group membership still gets group routing. The provider answers with a warning (`glpi_technician_catalogue_unavailable`) and an empty technician list. A missing right is never fatal for the whole read.

### Gotchas

- **Group membership reads.** The bare `Group_User` listing is the cheap path and a restricted profile often refuses it. The client falls back to one `Group/<id>/Group_User` read per group, and every list read is paginated. Keep the pagination: a group with more than one page of members silently loses technicians otherwise.
- **Dropdown expansion.** With `expand_dropdowns=true`, GLPI replaces `users_id` with the user's login string, so the numeric id is not in the response. Read raw ids first (`expand_dropdowns=false`). Use the expanded read only as a second, best-effort pass to attach a human label.
- **Time zones.** `date_mod` is a naive local-time string in the GLPI server's time zone, while the API runs in UTC. Never compare it with a KANAP timestamp. Only a value that carries an explicit zone offset may be compared. The freshness guard identifies a ticket we just wrote by value: after each write, the action stores `post_write_ticket_baseline` (ticket hash and update time), and a sibling action in the same batch compares against it.
- **HTML entities.** GLPI 10 stores `&`, `<` and `>` as numeric entities, including the `>` separator in category paths. Decode at the provider boundary with `decodeNumericHtmlEntities` (`backend/src/common/html-entities.ts`).
- **Catalogue limits.** The agent's group catalogue is cached for 5 minutes per GLPI instance and acting account. The prompt exposes at most 200 groups, but the cache keeps the whole list so that a technician whose only group falls beyond the cap is still found.
- **Ambiguous labels.** When an instruction names a group or technician by label and two entries share it, the assignment is dropped with the reason `assignment_target_ambiguous`. A key match always wins over a label match.

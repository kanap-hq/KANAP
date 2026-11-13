# Adding a Monitoring Provider to the Agentic Control Plane

Audience: the engineer (or AI agent) tasked with connecting a new monitoring tool — Nagios, Zabbix, Icinga, … — to KANAP's provider-agnostic SRE agent. PRTG is the worked example throughout: it shipped with Phase 15.A and lives in the tree, so every pattern below points at real code. Substitute your provider key everywhere `prtg` appears.

Status: **Phase 15.A implemented 2026-07-06** (reads, alert ingestion, targeting, LLM diagnosis — eval-only, zero write capabilities). The acknowledge/pause write pairs are **typed in the contract but not yet implementable end-to-end** — their capability and approval surfaces land in 15.B (§4.7). This guide is finalized after 15.B; treat §4.7 and the write items in §9 as forward-looking.

Scope: after this integration, the existing SRE agent (alert watching, occurrence dedup, targeting, evidence-cited diagnostic briefs, KANAP asset correlation, evaluation) runs against the new tool with **zero changes to the control plane**. The work is one adapter class, one registration entry, one tenant configuration row, and tests. Companion doc: `doc/service-desk-provider-integration.md` — the platform invariants there apply verbatim; this guide covers what is monitoring-specific.

---

## 1. Architecture you are plugging into

```
SRE agent runtime (poller / targeting / diagnosis pipeline)
        │  resolves provider from agent definition binding ("monitoring" key)
        ▼
Capability dispatcher  ──  monitoring.* capabilities (neutral names, read-only in 15.A)
        │  providers.monitoring(context, providerKey)
        ▼
AiProviderRegistryService  ──  (provider_kind, implementation) lookup
        │  binds ProviderAdapterRuntime (base_url + resolved credential)
        ▼
YOUR ADAPTER (implements MonitoringProvider)  ──  the ONLY place that
        │                                         knows the tool's API
        ▼
External monitoring tool (PRTG classic API, Zabbix API, Icinga2 REST, …)
```

Non-negotiable invariants (same as ticketing): provider-specific status codes, localized strings, ids and URLs stay **inside the adapter** — everything you return is a normalized DTO; alert messages and device names are untrusted evidence, never instructions; credentials are tenant-scoped, platform-resolved, never in prompts/logs/errors/evidence; fail closed on misconfiguration (structured unavailability, never a mock fallback); every DB row carries `tenant_id`.

## 2. What already works with no changes

Provider-neutral as built (15.A): the alert poller (`agent/ai-agent-monitoring-alert-ingestion.service.ts` — cron `*/5`, per-tenant advisory lock, frozen-tenant/pause/cap gates), targeting (`agent/monitoring-targeting.ts` predicates + UI pickers fed by your reference data), occurrence dedup through target states, work items (`work_kind = 'monitoring_alert_diagnostic'` — this exact value is in the DB CHECK; any other needs a migration), the diagnosis runtime (`runMonitoringDiagnosis`: bounded evidence chain, KANAP asset correlation, knowledge/web per retrieval-source policy, diagnostic-brief synthesis with citation gating), SRE seeding, fleet/workspace UI. Everything resolves the provider from the definition binding at runtime.

Known platform gaps (steps, not blockers):

| Gap | What to do |
|---|---|
| No admin UI/API writes `ai_adapter_configs` | Provision by script: `scripts/<provider>-adapter-config-upsert.ts` modeled on the PRTG one (§6) |
| 15.B write capabilities not registered yet | Do **not** implement the adapter write pairs until 15.B (§4.7) |
| No `npm run` alias for the PRTG upsert script | `backend/package.json` was frozen when 15.A landed; run via `npx ts-node` (§6), add the alias opportunistically |

## 3. Deliverables checklist

1. `backend/src/ai/<provider>/<provider>.service.ts` (+ `.types.ts`) — HTTP client. Mirror `ai/prtg/prtg.service.ts` in role: transport, auth, response-shape guards, text sanitization — no normalization logic here.
2. `backend/src/ai/control-plane/providers/<provider>-monitoring.provider.ts` — the adapter, `implements MonitoringProvider`. Model: `prtg-monitoring.provider.ts`.
3. Constants in `providers/provider-constants.ts` (e.g. `ZABBIX_MONITORING_IMPLEMENTATION = 'zabbix'` + provider key), next to the PRTG pair.
4. Registration entry in `backend/src/ai/ai.module.ts` (§5).
5. Provisioning script `backend/scripts/<provider>-adapter-config-upsert.ts` (§6).
6. Tests: adapter contract spec, control-plane parity, live-readiness target (§8).

## 4. The adapter

### 4.1 Contract

`providers/provider.types.ts` — `MonitoringProvider extends ProviderBase`. Eight read methods are required; the two write pairs are optional (§4.7). The mock (`providers/mocks/mock-monitoring.provider.ts` — a deterministic 9-check tree covering fresh-down, flapping, acked, cleared-and-refired, paused, and prompt-injection message text) is your reference implementation. From `ProviderBase`:

- `readonly kind = 'monitoring' as const`, `readonly providerKey = 'zabbix'` (stable key stored in bindings and config rows).
- `readonly actionPlannerProfile` — monitoring `domain_preamble`, `action_vocabulary` (PRTG ships the canonical seven: `diagnostic_note`, `acknowledge_alert`, `pause_object`, `create_ticket`, `create_kanap_task`, `run_automation_job`, `escalate_to_human` — in 15.A only the first and last are executable, the rest surface as recommendations), `validation_notes`.
- `health(context)`, `applicability(context)` — §4.5.

Reads: `getAlert`, `getCurrentState`, `getSensorHistory` (bounded window, UTC), `listRelatedAlerts` (same device, then parent group), `listAlertsForScope` (the ingestion workhorse, §4.4), `getMonitoredObject` (device/group context — `hostAddress` feeds KANAP asset correlation), `describeReferenceEnums` (normalized vocabularies only), `searchReferenceCatalog` (`group` | `device` | `check_type`, bounded, API-backed — feeds the targeting UI pickers).

Everything returns `AdapterResult<T>` with structured error codes only (`not_configured`, `missing_credentials`, `unauthorized`, `forbidden`, `not_found`, `timeout`, `rate_limited`, `provider_unavailable`, `invalid_response`, `malformed_config`, …) — the dispatcher never parses exception strings. Never echo credential material or raw request bodies in `message` (PRTG routes every outgoing message through `sanitizePrtgText`).

### 4.2 Normalization vocabularies (write these tables first)

Single source of truth in `providers/provider-constants.ts`, declared `as const` so the type unions in `provider.types.ts` derive from them and cannot drift:

- `MONITORING_ALERT_STATUS_VALUES`: `down`, `down_partial`, `warning`, `unusual`, `paused`, `up`, `unknown`
- `MONITORING_SEVERITY_VALUES`: `very_low`, `low`, `medium`, `high`, `critical` — **ordered lowest to highest; severity-floor comparisons use the index**
- `MONITORING_ACK_STATES`: `unacknowledged`, `acknowledged`

PRTG worked example (`normalizeSensorStatus` / `normalizeSeverity`): `status_raw` 3→`up`, 4→`warning`, 5→`down`, 13→`down` + `ackState: 'acknowledged'`, 14→`down_partial`, 10→`unusual`, 7/8/9/11/12→`paused`, 1/2/6 and anything else→`unknown`; priority 5..1→`critical`..`very_low`, unknown→`medium` (degrade the row, never fail it). Keep a reverse map for status push-down (`PRTG_STATUS_RAW_BY_NORMALIZED`).

Nagios/Icinga/Zabbix sketch: service OK/WARNING/CRITICAL/UNKNOWN → `up`/`warning`/`down`/`unknown`; host DOWN/UNREACHABLE → `down`; acknowledged flag → `ackState`; scheduled downtime/maintenance → `paused`; Zabbix severity ladder maps onto the five normalized values. Host-centric tools use `objectKind: 'host'`; a probe/service/sensor is a `check`.

### 4.3 Alert identity, occurrence, dedup key — load-bearing

An alert IS a check in a non-up state; there is no separate alert object. `MonitoringAlert.id` = provider object id; an **occurrence** = `(id, occurrenceStartedAt)`; clear-then-refire yields a new occurrence and a new work item. Rules proven by the PRTG build:

- `dedupKey` = `<providerKey>:<objectId>:<normalized status>:<occurrenceStartedAt ?? 'none'>` — work-queue dedup and idempotency hang off it.
- `occurrenceStartedAt` is `null` for `up`/`paused`/`unknown` **and whenever the tool cannot prove the transition time** (PRTG: `downtimesince_raw <= 0` means "start unknown" — anchoring 0 at fetch time drifted every cycle and forged new occurrences). The ingestion handles null occurrences via an explicit open-occurrence marker; your job is only to never fabricate a timestamp. PRTG also minute-rounds the computed timestamps for stability.
- Attach the optional provider-ref ids when your rows expose them: `deviceId`, `groupId`, `checkTypeId`. They are what picker-authored group/device/check_type targeting predicates verify against — omit them and ref-id targeting silently matches nothing (found in adversarial review). `deviceId` additionally gates the `getMonitoredObject` read that powers the KANAP asset IP tiebreak.
- `sourceUri` (deep link into the tool) and `message` (HTML-stripped, inert plain text) are required; `message: ''` when absent.
- Normalize every timestamp to UTC ISO inside the adapter. PRTG returns server-local OLE dates; the server-timezone assumption is an explicit verify-on-live-instance TODO — resolve yours up front.

### 4.4 `listAlertsForScope` — push down what you can, re-filter everything locally

`MonitoringAlertListScope` is the bounded ingestion scope (statuses, severity floor, ack state, group/device/check-type ref ids, `minAgeMinutes` flap guard, `maxResults`). The contract rules, as PRTG implements them:

- Default scope (absent/empty `statusValues`) = every non-up state.
- Push down whatever the API expresses (PRTG: normalized statuses → `filter_status` raw codes, group ids → per-group subtree fetches), then **re-apply the full scope locally regardless** — the result must honor the scope even when the server ignored a filter.
- Flap guard fails closed: an alert without a provable occurrence start cannot prove its age and is excluded when `minAgeMinutes` is set.
- Bound everything: page size, hard scan cap independent of `maxResults`, result cap (PRTG: 100/1000/100). Same discipline for history (default 24 h, max 7 d, ~500 averaged points) and related-alert fetches.

### 4.5 Applicability, health, credentials

`applicability(context)` validates `context.adapterRuntime` (implementation match, `baseUrl`, `credential.hasSecret()`) and returns `{ available: false, reasonCode: 'provider_not_configured' | 'missing_credentials' | 'malformed_config' }` on any gap. There is **no legacy-settings fallback for monitoring providers** — `ai_settings` is GLPI-only compat; without a bound adapter runtime you fail closed.

Credential material via `context.adapterRuntime.credential.reveal()`: pick a documented format and parse defensively. PRTG accepts a plain string (API token) or JSON `{ "api_token": "…" }` / `{ "username": "…", "passhash": "…" }`; anything else ⇒ `malformed_config` with a sanitized message.

### 4.6 Evidence seeds

Every successful read returns `AdapterEvidenceSeed[]`: `sourceProvider: 'monitoring:<key>'`, `sourceType` (`alert`, `sensor_state`, `sensor_history`, `monitored_object`, …), `sourceId`, `sourceUri`, `trustLevel: 'customer_system'`, one-line `summary`, and a **redacted, metadata-only** payload — ids, statuses, counts; never message bodies or history point arrays (the diagnosis pipeline digests history before anything reaches the LLM; run caps bill actual usage).

### 4.7 The 15.B write pairs — typed, not yet implementable

`prepareAcknowledgeAlert`/`executeAcknowledgeAlert` and `preparePauseObject`/`executePauseObject` are **optional** interface members. The payload types are final (`MonitoringAcknowledgeAlertActionPayload` carries the `occurrenceStartedAt` freshness anchor — execute fails closed with `noLongerApplicable` when the occurrence changed; `MonitoringPauseObjectActionPayload` requires a bounded `durationMinutes` — indefinite pause is never offered), but the capability registry has no `monitoring.alert.acknowledge.*` / `monitoring.object.pause.*` entries and no approval renderers yet. Until 15.B lands:

- **Omit the four methods entirely.** The control plane offers write actions only when `typeof provider.<method> === 'function'`; `UnavailableMonitoringProvider` deliberately does not stub them either. A throwing placeholder would advertise a capability you don't have.
- When 15.B arrives: idempotent execute (`alreadyApplied: true` on replay), idempotency keys embedding the occurrence dedup key, prepare → action-request → approval → execute-approved — identical discipline to ticketing writes.

## 5. Registration (one entry, no registry edits)

`backend/src/ai/ai.module.ts` — extend the existing `AI_PROVIDER_IMPLEMENTATIONS` factory (PRTG already shows the shape):

```typescript
{ providerKind: 'monitoring', implementation: PRTG_MONITORING_IMPLEMENTATION, provider: prtgMonitoring },
{ providerKind: 'monitoring', implementation: ZABBIX_MONITORING_IMPLEMENTATION, provider: zabbixMonitoring },
```

Add your provider class (and its HTTP service) to the factory's `inject` list and the module's `providers` array. The registry keys implementations by `${providerKind}:${implementation}` and resolves them from the tenant's adapter config. Never add a legacy-key mapping — that mechanism exists only for GLPI's pre-adapter-config history.

## 6. Tenant provisioning

One row in `ai_adapter_configs` (RLS-protected, unique on `(tenant_id, provider_kind, provider_key)`): `provider_kind = 'monitoring'`, `provider_key`/`implementation` = your key, `environment` = `sandbox` (test instance) or `production`, `enabled = true`, `base_url = https://<monitoring-host>`, `credential_ref_json = { "kind": "secret_ref", "ref": "tenant/<tenant-uuid>/monitoring/<key>", "tenant_id": "<tenant-uuid>" }`, `live_test_safety = 'live_read'`.

Secret material never goes in the row. The resolver maps the ref to an env var computed by `tenantSecretRefEnvName()` (`tenant-secret-resolver.service.ts`); the operator sets it on the backend runtime before enabling the row. Build your upsert script from `scripts/prtg-adapter-config-upsert.ts`: dry-run by default, apply requires both `<PROVIDER>_ADAPTER_CONFIG_APPLY=1` and a typed `_CONFIRM` value, prints only credential **presence/shape** and the computed env-var name. Run it with `npx ts-node scripts/prtg-adapter-config-upsert.ts` from `backend/` (header comment documents the full env set).

From the settings card (`PUT` of the PRTG integration), an empty `base_url` removes a saved connection: `enabled = false`, `base_url` and `credential_ref_json` null, an `update` audit entry; the row and its other settings stay, and bound agents report the provider as unavailable on their next cycle. On a row with nothing left to remove, an empty address is a `400`, as with no row.

## 7. Agent binding, seeding, targeting

The SRE agent binds via the multi-kind `provider_bindings_json` map — the `monitoring` key is required; `ticketing`/`automation` join in 15.B/15.C:

```json
{ "monitoring": { "provider_kind": "monitoring", "provider_key": "prtg" } }
```

Resolution goes through `resolveProviderBinding(definition, 'monitoring')` (`agent/provider-binding.ts`) — fail-closed, no fallback. Operators create SRE agents from the Agents page; `createAgentDefinition` applies the family defaults in `agent/agent-definition-defaults.ts` (`sreAgentDefaults`): sandbox, A1 ceiling, the read-only capability list (`SRE_MONITORING_ALLOWED_CAPABILITIES`: the five `monitoring.*` reads + `search_knowledge`/`get_document`/`web_search`), knowledge on / web off / `kanap_data` on for all five domains, and polling disabled — watching is enabled deliberately. Bindings come from the wizard, or from the unique enabled monitoring adapter when the tenant has exactly one; several configs leave the agent unbound and the operator picks (never guesses). There is no product-owned seed row.

Targeting (`agent/monitoring-targeting.ts`) speaks only normalized vocabulary and your reference data: `status` (in), `severity` (gte floor pushed down; value lists local), `ack_state` (eq), `group`/`device`/`check_type` (in — ref ids from your `searchReferenceCatalog`, verified against the ids you attach per §4.3), `age_minutes` (gte), `touched_by` (not self — control-plane resolved, occurrence-scoped). Predicates translate directly into `MonitoringAlertListScope` and are **always** re-verified locally after the fetch. Three presets ship (`unacknowledged_down`, `critical_and_high`, `stable_down_10min`). Your `describeReferenceEnums`/`searchReferenceCatalog` feed the workspace pickers through the agent's binding — nothing provider-specific in the frontend.

## 8. Testing

1. **Adapter contract spec** (`__tests__/<provider>-monitoring.provider.spec.ts`, mirror `prtg-monitoring.provider.spec.ts`): applicability fails closed without runtime config; HTTP/transport errors map to structured codes; credential material never appears in errors or evidence; the full status/severity normalization matrix; localized display columns never drive semantics (PRTG feeds deliberately-junk display strings and asserts only `_raw` twins matter); malicious alert message text arrives as inert plain text; dedup-key format + message fallback; scope push-down with local re-filter; zero/absent downtime ⇒ null occurrence; paging respects `maxResults` and the scan cap; history window clamp + raw channel values only; monitored-object device→group fallback; related alerts same-device-then-group; reference enums + catalog (including the degraded check-type path).
2. **Control-plane parity**: `ai-monitoring-ingestion.spec.ts` (detect→enqueue→diagnose e2e, occurrence lifecycle: clearance re-arm, flap guard, savepoint failure bookkeeping), `ai-monitoring-diagnosis.spec.ts`, and `monitoring-targeting.spec.ts` already prove the neutral plumbing against `MockMonitoringProvider` — they need no changes for a new adapter. Add a fixture only if your provider's semantics diverge (e.g. host-centric object model).
3. **Live readiness**: neutral scenario `monitoring_read` (gate `KANAP_MONITORING_LIVE_READ=1`, plus `KANAP_LIVE_CONTRACT_TESTS=1`, `KANAP_LIVE_TENANT_SLUG`, and `KANAP_MONITORING_LIVE_READ_PROVIDER_KEY=<key>`) exercises `getAlert` + `getSensorHistory` + `listAlertsForScope` with tiny bounds. Create an `AiLiveTestTarget` row (`provider_key: '<key>'`, `target_kind: 'sensor'`, `external_ref: <stable test check id>`, `allowed_effect: 'read'`, `enabled: true`) — note the CHECK constraint that rejects secret-looking strings in target metadata. Run `npm run live-readiness:contract -- monitoring_read --run`.
4. **Both CI modes** (`multi-tenant` and `single-tenant`) must stay green; nothing here is deployment-mode-gated.

## 9. Rollout checklist

- [ ] Adapter + registration merged, CI green both modes
- [ ] Read-only credential on the customer's test instance; secret env var set; adapter config row provisioned (dry-run → apply)
- [ ] Normalization table and occurrence timestamps verified against the live instance (status codes, timezone) before calibration freezes
- [ ] `monitoring_read` live contract green against the test instance
- [ ] SRE agent seeded/bound; targeting configured through the pickers; watching enabled with bounded scope + flap guard
- [ ] Eval-only calibration first: noise ratio (dup/flap skips vs enqueued), diagnosis citation quality — no write ramp before a trustworthy alert stream
- [ ] (15.B, forward-looking) acknowledge ramp before pause/ticket-creation ramp; every write approval-gated

## 10. What NOT to do

- Do not add `if (providerKey === 'zabbix')` anywhere above the adapter. If the seam is missing, extend `provider.types.ts` neutrally (the ref-id fields and planner profiles were added exactly that way).
- Do not parse localized or display-formatted provider strings for semantics — demand raw/stable fields from the API (`_raw` twins in PRTG), and treat the display value only as display.
- Do not let raw status/priority codes appear in `MonitoringAlert`, targeting predicates, or reference items — normalized keys only.
- Do not stub the optional write pairs with throwing placeholders — presence of the method IS the capability signal (§4.7).
- Do not read `ai_settings` or register legacy provider keys — both are GLPI-only compat surfaces.
- Do not ship unbounded fetches: page caps, scan caps, history clamps, and metadata-only evidence are contract expectations, not optimizations.

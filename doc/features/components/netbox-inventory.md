# Netbox inventory integration

KANAP reads a tenant's Netbox inventory and keeps its assets in step with it. Backend code lives in `backend/src/netbox/`. The management page is `/it/netbox` (`frontend/src/pages/it/NetboxSyncPage.tsx`). The connection card is on `/admin/integrations`. The user-facing description is in the manual page `doc/help/docs/en/netbox.md`.

This is not an AI feature. It has no feature flag and works in both deployment modes. Access is the `infrastructure:admin` permission. The status endpoint (`GET /netbox/status`, read by the home tile) needs `infrastructure:reader`.

## Design rules

- **Netbox is authoritative only for the fields it feeds**: name, host name and domain, serial number, manufacturer, model, rack, rack unit, primary IP, operating system, status and site. KANAP owns every other field.
- **An empty Netbox value never blanks a KANAP value.**
- **KANAP never deletes.** An object that disappears from Netbox becomes a `missing` record. Retiring the asset is a person's decision (`POST /netbox/records/:id/retire-asset`). A sync never writes the `retired` status.
- **One asset, one Netbox object.** A partial unique index (`idx_asset_external_links_one_live_per_asset`) allows one `linked` record per asset. Only a `linked` record owns its asset.
- **The mapping is also the scope filter.** Netbox roles map to asset kinds, sites map to locations, and one reserved entry (`kanap:virtual-machines`) covers all virtual machines. An unmapped object is not imported.
- **Status.** Netbox `planned`, `staged` and `inventory` map to `proposed`. `decommissioning` maps to `deprecated`. `offline`, `failed` and `paused` keep the lifecycle `active` and show as a notice (`netbox_status_attention`). The raw value is stored in `asset_external_links.external_status`. A move between `active`, `offline`, `failed` and `paused` therefore writes nothing to the asset.
- **Sub-locations.** Only top-level Netbox Locations become `location_sub_items`. A device in a deeper Location gets its top-level ancestor. KANAP does not locate equipment more precisely than site and building.
- **Host name and domain.** A host name is one or more RFC 1123 labels separated by dots (`backend/src/assets/hostname.util.ts`, mirrored in `frontend/src/utils/hostname.ts`). The Netbox name is split into host name and domain only when it ends with a `dns_suffix` of the tenant's domain catalog (the longest suffix wins). Otherwise the whole name is the host name and the domain stays empty. The domain is managed only together with the host name.
- **Operating system** has its own mapping table (`os_map`, Netbox platform slug to KANAP operating system). It is not an import filter.
- **A new asset's `provider`** must be a code of the `serverProviders` catalog, not a `hosting_type` value. The mapper takes the location's provider when it is a real provider code, then `other`, then the first catalog entry.

## Matching

`matchNetboxObject` (`netbox-matcher.ts`) runs a cascade. The first level with an exact hit decides.

1. The existing link.
2. Serial number.
3. Host name or FQDN.
4. Asset name.

Comparison ignores case. Several candidates at one level make the object `ambiguous`. It is never merged automatically.

Two weaker signals never link on their own. They stop a blind creation and offer the candidates to a person.

- A match on the first DNS label of the name only (notice `similar_name_candidates`). In real inventories the first label is often a building or a site, not a machine.
- An asset that already holds the object's primary IP (notice `ip_match_candidates`). IP addresses are reused, shared or stale too often to let Netbox overwrite an asset on that basis.

A person settles an object with a decision: `link` to an asset, `create` a new one, or `ignore`.

## Review before writing

A manual run writes only what its preview listed.

- `POST /netbox/sync/preview` is read-only. It returns one batch of at most 500 rows (`buildReviewBatch`). Out-of-scope objects are counted by reason and never listed. Rows are ordered decided, create, update, ambiguous, informative. Writes come before undecided objects so an undecided object cannot starve the batch.
- `POST /netbox/sync` takes `reviewed: [{ external_type, external_id }]` and `decisions`. A creation or update outside `reviewed` is left untouched and counted as `deferred`. A request without `reviewed` writes nothing.
- The first successful manual run that leaves nothing deferred opens the hourly scheduled run for the tenant (`metadata_json.first_manual_sync_at`). While `review_pending` is above zero, the scheduled run waits.
- The scheduled run (`netbox-inventory-sync`, hourly, per-tenant `auto_sync` switch) has no reviewer. Once it is open, it also creates new Netbox objects without a preview. The IP suggestion is the only guard.
- Frozen and trial-expired tenants are skipped by the scheduled run. The check does nothing on-premise.
- A preview inventory is cached for 2 minutes and reused only when the client sends `reuse_inventory: true`. A run always reads Netbox.
- A preview needs saved role and site matches. The mapping tab pre-fills suggestions that are not saved until the person saves the mappings.
- The frontend refuses to apply when a preview carries no `batch` field.

## Writes and storage

- Writes go through the asset services with audit `source = 'system'` and `source_ref = 'netbox'`. Every sync write can be listed from the audit log and reverted.
- Records live in `asset_external_links`: one row per Netbox object, with `state` (`linked`, `ambiguous`, `missing`, `ignored`, `error`) and a notice stored as a code plus parameters, so pages render it in the user's language.
- `managed_fields` lists the fields Netbox provided a value for on that object, refreshed at every run. The asset workspace locks only those fields. `NULL` means not known yet and locks the whole list. The lock is enforced in the frontend only.
- The "missing" pass runs only when the fetch completed and returned at least one object.
- The connection reuses `ai_adapter_configs` with `provider_kind = 'inventory'`. The token is stored with `AiSecretCipherService` (AES-GCM). `AI_SETTINGS_ENCRYPTION_SECRET` must be set to save it, even when AI is off.

## Transport rules

`netbox.client.ts` is a read client on `node:http` and `node:https`.

- The SSRF guard runs before every request, not only when the connection is saved. Redirects are never followed.
- Never follow the absolute `next` URL that Netbox returns for the following page. Behind a reverse proxy it can name another host. The client computes `limit` and `offset` itself and trusts `count` only when it is numeric. Otherwise everything beyond the first page would be flagged missing.
- "Ignore certificate" applies to one request, never to the process.
- `Authorization: Token <value>` works for Netbox v1 tokens and for the v2 tokens (`nbt_<key>.<secret>`) issued since Netbox 4.7.
- A private Netbox address is refused in cloud mode unless the host is listed in `SSRF_ALLOWED_HOSTS`. See the outbound target guard in `doc/on-premise/technical-design.md`.
- The request timeout is configurable between 5 and 120 seconds.
- Netbox permissions are per object type. Optional lists (platforms, locations) must degrade, not fail the run, when the token cannot read them. Test every new endpoint with a token that has narrow permissions.

## Adding a field or a notice

- A new diff key produced by the planner must also be added to `DIFF_FIELD_KEYS` in `NetboxSyncPage.tsx`. Otherwise the raw key is shown, even when the four locale files carry a label.
- A tie-break decided at plan time (for example, the lower Netbox id wins a name conflict) must be carried into the write. Apply re-resolves against the database in Netbox row order.
- Sub-location writes use get-or-create by database re-read inside the row transaction. An in-memory cache keeps ghost ids after a rollback.

## Local test inventory

A Netbox instance with a seeded inventory runs behind the `netbox` compose profile. Start commands, access values, seed scenarios and the test-case table are in `backend/fixtures/fromage-co/netbox/README.md`.

- `infra/docker-compose.yml` is gitignored. The tracked copy is `infra/docker-compose.example.yml`.
- `docker compose --profile netbox down` stops the whole dev stack. Stop and remove the three Netbox services by name instead (`netbox`, `netbox-postgres`, `netbox-redis`).
- The Netbox container needs `API_TOKEN_PEPPER_1` and a `SECRET_KEY` of at least 50 characters.
- The API container reaches Netbox through the compose network, so the host name must be in `SSRF_ALLOWED_HOSTS` of the dev environment file. The "Open in Netbox" links use that internal name and do not open from the host browser.
- The hourly scheduled run also fires on the dev stack once a manual run opened it. Revert drift scenarios before it runs, or it will apply them.

## Not built yet

Cluster membership, prefixes to subnets, environment from tags, and a governance view of assets without a Netbox object or without an application.

# Discovery call

A trial workspace offers a 30-minute discovery call, booked on Cal.com. KANAP shows the link, counts the clicks and stores the date of the call, which the trial e-mails and the trial funnel read. Cloud only: on-premise nothing of it exists (Feature Gate Inventory in `on-premise/technical-design.md`).

Code: `backend/src/discovery-call/`, `frontend/src/components/BookDiscoveryCallButton.tsx`.

## Configuration

| Variable | Use |
|---|---|
| `DISCOVERY_CALL_URL` | The booking page (`https://cal.com/kanap/decouverte`). Empty: no button. |
| `DISCOVERY_CALL_FALLBACK_EMAIL` | Used by the button when no booking page is set (`mailto:`). |
| `DISCOVERY_CALL_WEBHOOK_SECRET` | The secret of the Cal.com webhook. Empty: the webhook answers 404. |

All three are empty by default and ignored in `single-tenant` mode. A URL that is not http(s), or an address that is not one, counts as empty. `GET /config/public` serves `discoveryCall: { url, fallbackEmail }`, never the secret.

## The button

`BookDiscoveryCallButton` reads **Book a discovery call** and opens the link in a new tab (`rel="noopener"`). It shows while the subscription is `trialing` with days left, when a URL or an address is set, never to a platform administrator. Two placements in the application:

- `last_step`: the end screen of the first five steps (home page tile);
- `about`: after the days left in the trial, in **About KANAP** (a link in the line).

Each click posts `POST /api/discovery-call/clicks { placement }` (signed-in user, 204), which writes the audit entry `trial.discovery_call_clicked { placement }`. The placements `mail_j0`, `mail_j5`, `mail_j12` and `trial_end` are accepted for the links of the trial e-mails, which record their clicks through `DiscoveryCallService.recordClick` without a user (`source = 'system'`): the e-mails link to `GET /api/trial-mails/call?t=` (`doc/trial-mails.md`), which counts the click and redirects to the booking page. J0 and J+5 carry the link.

## Storage

`trial_discovery_calls`, one row per tenant, tenant-scoped (RLS, `trial_discovery_calls_tenant_isolation`), kept by the workspace reset:

| Column | Content |
|---|---|
| `scheduled_at` | Date and time of the call. |
| `status` | `booked` or `cancelled` (a cancelled call keeps its date). |
| `source` | `calcom` (webhook) or `manual` (set by the platform administrator). |
| `note` | Free text, at most 2,000 characters. |
| `external_id` | The Cal.com booking uid; null for a call set by hand. |

`DiscoveryCallService` is the only reader and writer, always on a manager whose transaction carries the tenant:

- `read(manager, tenantId)`: the call or null;
- `discoveryCallTiming(call, now)`: `upcoming`, `past` or `none` (no call, or cancelled), the variant of the trial e-mails;
- `saveManual(manager, tenantId, { scheduled_at, status?, note? }, userId?)`: a call set by hand, 400 `discovery_call_invalid` on a bad value;
- `remove(manager, tenantId, userId?)`;
- `recordClick(manager, tenantId, userId | null, placement)`.

Every change writes `trial.discovery_call_updated` (before and after: date, state, source, note) or `trial.discovery_call_removed`, with `table_name = 'trial'` and the tenant as `record_id`.

## Cal.com webhook

`POST /api/discovery-call/calcom`, public, on any host of the API (the same as the Stripe webhook). Cal.com signs the raw body with the secret: `x-cal-signature-256` is its HMAC-SHA256 in hex. Answers: 404 without a secret, 401 on a bad or missing signature, 200 otherwise, including for an event the webhook ignores (Cal.com does not retry it).

The workspace is found by an attendee's address: the most recent activated trial sign-up (`trial_signups.email`) made with it, whose tenant still exists. The sign-up address is the workspace's first administrator. An address without a trial is ignored and logged.

| Event | Effect |
|---|---|
| `BOOKING_CREATED`, `BOOKING_RESCHEDULED` | The booking (`payload.uid`, `payload.startTime`) becomes the workspace's call, `booked`, source `calcom`. The latest booking wins; the note stays. |
| `BOOKING_CANCELLED` | Marks the call `cancelled` when `payload.uid` is the stored booking. Cancelling an older booking changes nothing. |
| Anything else | Ignored. |

Set up in Cal.com: Settings › Developer › Webhooks, subscriber URL `https://<api host>/api/discovery-call/calcom`, the three booking events, and the secret of `DISCOVERY_CALL_WEBHOOK_SECRET`.

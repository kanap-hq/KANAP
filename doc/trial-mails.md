# Trial e-mails

A trial workspace receives four e-mails during its trial, and a thank-you at its first subscription. Texts written by Friedrich (founder), coded as they are in French and translated into English, German and Spanish. Cloud only: on-premise the task is not registered and the routes answer 404 (Feature Gate Inventory in `on-premise/technical-design.md`).

Code: `backend/src/email/trial-mails/`. Texts: `trialMails` in `backend/src/i18n/email-locales/{en,fr,de,es}.ts`.

## The e-mails

| Milestone | When | Sender | Content |
|---|---|---|---|
| `j0` Welcome | Once the path and the mode are chosen, or an hour after the first sign-in seen without them | Application address, replies to `fried@kanap.net` | The chosen path's first-steps guide and the two other paths ("Just looking": the three paths), the discovery call, button **Book a discovery call** |
| `j5` Personal note | Five days after the trial started | `Friedrich <fried@kanap.net>` | By the discovery call: to come (its date), past (its date), none (the three paths and a call link). No button |
| `j12` Trial ends in two days | Two days before `trial_end` | Application address, replies to Friedrich | The end date, read-only for thirty days then deletion, the hosted plan (prices from `PLANS`) and installing it yourself, button **Activate the subscription** |
| `ended` End-of-trial notice | Once `trial_end` has passed, still `trialing` | Application address, replies to Friedrich | Read-only, the deletion date, reactivate, export, install; the open question about what was missing |
| `thanks` Thank-you | Once Stripe confirms the first subscription (`active` with a Stripe subscription) | Application address, replies to Friedrich | Subscription recorded, data kept, support address, button **Open KANAP** |

The trial sequence stops at the subscription: a subscribed workspace gets the thank-you, once, and nothing else. No e-mail reads what the person did in the workspace: the only inputs are the trial dates, the path and mode chosen (`tenant_onboarding`), the discovery call (`DiscoveryCallService`, `doc/discovery-call.md`) and the sign-up person.

A mail goes out only while it still makes sense: J0 before J+5 is due, J+5 before J+12, J+12 before the end, the notice until a week before the deletion. A workspace seen late in its trial (a deploy, an outage, sending switched off) gets the current mail, never the ones it missed. The deletion date is the end of the trial plus thirty days (`trialDeletionDate`).

The recipient is the person of the trial sign-up (`trial_signups.email`), the workspace's first administrator, while that user is `enabled`. The language is the workspace's (`tenants.metadata.language`). Dates are written in the language, as days of the Europe/Paris calendar.

## Presentation

The common template `emailWrapper` (`notifications/notification-templates.ts`): KANAP logo, white card, primary colour, footer "Powered by KANAP". The four trial e-mails put the unsubscribe link in the place of the notification preferences link, with the line "You are receiving this message because you are trying KANAP." The thank-you is a service e-mail and has neither. One button at most; every other link is in the text. Each e-mail has a text version. French texts follow the application's typography (`frenchSpacing`): no-break space before `:` and inside guillemets, narrow no-break space before `;`, `!`, `?`.

Links: the first-steps guides `https://doc.kanap.net/<lang>/first-steps/<budget|landscape|portfolio>-<example|own-data>/`, the on-premise installation guide, the offer page (`MARKETING_BASE_URL/<lang>/offer`), billing (`/admin/billing` of the workspace), `support@kanap.net`.

## Scheduler and storage

The scheduled task `send-trial-mails` (every ten minutes, `*/10 * * * *`, disabled or rescheduled from the platform console) looks at the workspaces with an activated trial sign-up in the last ninety days, active, not a system tenant. The Stripe webhook also runs one workspace as soon as its subscription changes (`TrialMailsService.onSubscriptionChanged`, not awaited, never rejects), so the thank-you does not wait for the task.

`trial_mails`, one row per tenant, tenant-scoped (RLS, `trial_mails_tenant_isolation`), kept by the workspace reset. The row is created when the scheduler first sees the workspace in trial: a workspace that subscribed before has none and gets nothing.

| Column | Content |
|---|---|
| `first_login_at` | The first sign-in of the person, as first seen (`users.last_login_at`) |
| `j0_sent_at` ... `thanks_sent_at` | When each mail was sent |
| `unsubscribed_at` | When the person unsubscribed |

A mail is stamped before it is sent, in its own transaction, so two processes never send it twice and a restart does not send it again. A send that fails lifts the stamp; the next run tries again. Nothing is read or written while e-mail sending is off (`disabled` transport) or the application address is not configured: the run says why in its summary.

## Links

Signed, never expiring, on the workspace's address (`https://<slug>.kanap.net/api/trial-mails/...`). A token is `<tenant>.<purpose>.<HMAC-SHA256>` under the `trial-mail` family key (`TRIAL_MAIL_LINK_SECRET`, else derived from `JWT_SECRET`, `auth/token-secret.util.ts`). Changing the key breaks the links of the e-mails already sent.

| Route | Effect |
|---|---|
| `GET /trial-mails/unsubscribe?t=` | A page in the workspace's language that asks to confirm. Opening it changes nothing (link scanners open links). |
| `POST /trial-mails/unsubscribe?t=` | Unsubscribes the workspace from the trial e-mails: the page's button, and the one-click unsubscribe of mail clients (`List-Unsubscribe` and `List-Unsubscribe-Post` headers, RFC 8058). Writes `trial.mails_unsubscribed` once (`table_name = 'trial'`, `source = 'system'`). |
| `GET /trial-mails/call?t=` | Counts the click (`trial.discovery_call_clicked { placement }`, `mail_j0` or `mail_j5`), then redirects to `DISCOVERY_CALL_URL` (or `mailto:` the fallback address). 404 when neither is set. |

A bad token is a 404. Without a booking page or a fallback address, J0 has no call paragraph or button and J+5 no call link.

## Deliverability

The application address is `RESEND_FROM_EMAIL`; J+5 is sent as `fried@kanap.net` through the same Resend relay, which needs the `kanap.net` domain verified in Resend (SPF include and DKIM key published) and a DMARC policy that the relay's DKIM signature aligns with.

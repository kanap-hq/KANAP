# On-Premise: Microsoft Entra SSO Setup

This guide explains how to enable Microsoft Entra (Azure AD) SSO for an on-premise KANAP deployment.
Entra SSO is optional; if you do not configure it, local email/password authentication remains available.

## Overview

KANAP uses the OAuth2/OIDC authorization code flow as a confidential client.
Each on-prem customer **must register their own Entra application** and provide its client ID/secret.

### What the customer provides

- An Entra App Registration **in their tenant**
- `ENTRA_CLIENT_ID` and `ENTRA_CLIENT_SECRET`
- `ENTRA_AUTHORITY` pointing to their tenant
- `ENTRA_REDIRECT_URI` matching their KANAP URL

## Prerequisites

- A public HTTPS URL for KANAP (reverse proxy in front of the API)
- Ability to create an App Registration and grant admin consent in Entra
- Outbound connectivity from the KANAP API container to:
  - `login.microsoftonline.com` (OIDC metadata, token exchange, JWKS)
  - `graph.microsoft.com` (profile enrichment at sign-in and the daily directory sync)

## Step 1: Create an App Registration (Entra)

1. Open **Microsoft Entra ID → App registrations → New registration**
2. Name: `KANAP (on-prem)`
3. Supported account types: **Single tenant** (recommended)
4. Redirect URI (Web):  
   `https://<your-kanap-domain>/api/auth/entra/callback`
5. Save and record:
   - **Application (client) ID**
   - **Directory (tenant) ID**

## Step 2: Create a Client Secret

1. Go to **Certificates & secrets**
2. Create a new **Client secret**
3. Copy the **secret value** (it is shown only once)

## Step 3: API permissions

KANAP needs two sets of permissions: delegated permissions for interactive sign-in, and one application permission for the daily directory sync.

### Delegated permissions (sign-in)

Every sign-in request asks Entra for exactly these scopes:

```
openid profile email offline_access User.Read
```

Add all five as **configured** permissions on the app registration:

1. Open **App registrations → your KANAP app → API permissions**
2. **Add a permission → Microsoft Graph → Delegated permissions**
3. Select `openid`, `profile`, `email`, `offline_access` and `User.Read`
4. Click **Add permissions**

`User.Read` lets KANAP read the signed-in person's own profile from Microsoft Graph so it can fill in their name, job title, phones, department and company. Keep it. It is a separate permission from `User.Read.All`, not an older version of it. Without it, users are prompted for consent at every sign-in or the sign-in fails.

!!! warning "Add the OIDC scopes before granting admin consent"
    Tenant-wide admin consent rewrites the app's grant to match the **configured** permission list. `openid`, `profile`, `email` and `offline_access` are usually listed under "Other permissions granted" and are not configured by default, so a tenant-wide consent would drop them and break existing sign-ins. The Azure portal shows this warning itself. Add the four scopes as configured delegated permissions first, then grant consent.

### Application permission (daily directory sync)

The nightly directory sync runs without a signed-in user, so it needs an application permission:

1. **API permissions → Add a permission → Microsoft Graph → Application permissions**
2. Select **`User.Read.All`**
3. Click **Add permissions**

`User.Read.All` also covers the manager of each account, which KANAP writes on the contributor profile of the people who are contributors. Nothing else to add for that.

The new row now shows the status **Not granted** with an orange warning. That is expected. The permission becomes usable once a Microsoft Entra administrator grants tenant-wide consent, which is done from KANAP in [Step 7](#step-7-authorize-the-daily-directory-sync).

Who does what:

- **Hosted KANAP**: the KANAP operator owns the app registration and adds the permission. The customer's Entra administrator only grants consent.
- **On-premise**: the customer's own IT owns the app registration, so they add the permission and grant consent.

### If you do not want Graph calls at sign-in

```
ENTRA_ENRICH_PROFILE=false
```

This only skips the Microsoft Graph `/me` call made during sign-in. Names and other profile fields then come from the ID token alone. It does not turn off the daily directory sync, which uses its own application permission.

## Step 4: Configure KANAP Environment Variables

Set the following in your on-prem `.env`:

```bash
# Entra SSO (on-prem)
ENTRA_CLIENT_ID=<application-client-id>
ENTRA_CLIENT_SECRET=<client-secret>
ENTRA_AUTHORITY=https://login.microsoftonline.com/<tenant-id>
ENTRA_REDIRECT_URI=https://kanap.company.com/api/auth/entra/callback
```

Notes:
- `ENTRA_AUTHORITY` should be **tenant-specific** for on-prem.
- `ENTRA_REDIRECT_URI` must match **exactly** what you registered in Entra.
- Make sure `APP_BASE_URL` is set to the exact address users open (scheme, host and port when it is not standard). The post-login redirect is built from it. Without it, Microsoft sign-in answers "application URL is not configured".

## Step 5: Restart KANAP

After updating `.env`, restart your containers so the API picks up the new configuration.

## Step 6: Connect Entra in KANAP

1. Log in as an admin
2. Go to **Admin → Authentication**
3. In the **Microsoft Entra ID** card, click **Connect**
4. Approve consent in Entra
5. Use **Test sign-in** to confirm end-to-end login

## Step 7: Authorize the daily directory sync

The **Daily directory sync** block appears on **Admin → Authentication** once Entra is connected. Until a Microsoft Entra administrator approves it, the block shows:

> Not authorized yet. A Microsoft Entra administrator must grant KANAP permission to read directory users.

To approve it:

1. Sign in to KANAP as an admin who is also a Microsoft Entra administrator
2. Go to **Admin → Authentication → Daily directory sync**
3. Click **Grant access in Microsoft Entra**
4. Approve the request on Microsoft's consent page

You come back to KANAP with the message **Access granted. The first sync is running.** The "Not authorized yet" line disappears.

You can also grant the consent from the Azure portal with **Grant admin consent for &lt;tenant&gt;** on the API permissions page. KANAP then only notices at the next sync. Click **Sync now** to check immediately. Because KANAP caches its Microsoft token, the first attempt right after a portal grant can still report "not authorized". Click **Sync now** again and it succeeds. The nightly run recovers on its own in any case.

## The daily directory sync

Once authorized, KANAP contacts Microsoft Graph every night at 03:00 server time and, for every user linked to Entra:

- Refreshes first name, last name, job title, business phone, mobile phone
- Matches the directory department and company **by name** against existing KANAP records. Nothing is created automatically, and a name with no match leaves the assignment unchanged.
- Sets the interface language only if the person has not chosen one
- Disables the KANAP account if the person was removed from the directory, or if their directory account was deactivated (`accountEnabled` is false)

Empty directory values never clear data already in KANAP.

Disabling an account signs the person out immediately and blocks any further sign-in. Their data and history are kept.

The block on **Admin → Authentication** reports the outcome: **Last synced {date} — N accounts refreshed, N disabled.** after a successful run, or **The last sync failed: {message}** otherwise. **Sync now** runs the same job on demand.

## Troubleshooting

- **SSO_NOT_CONFIGURED**: Entra env vars are missing or tenant is not connected. Users see "Sign-in with Microsoft is not set up for this workspace."
- **ENTRA_TENANT_MISMATCH**: You connected one tenant but are trying to sign in from another. Users see "This Microsoft account belongs to a different organization than the one connected to this workspace."
- **ENTRA_EMAIL_UNVERIFIED**: The Microsoft account email address is not verified, so it cannot be used to sign in.
- **Invalid Entra state / nonce**: The sign-in state expired or the Entra redirect did not return to the configured callback URL. Retry sign-in and verify `ENTRA_REDIRECT_URI` exactly matches the Entra app registration.
- **Bad redirect after login**: Check that `APP_BASE_URL` is the exact address users open. The redirect comes from `APP_BASE_URL`, and the `Host` and `X-Forwarded-Host` headers do not change it. Also check that the proxy sends `X-Forwarded-Proto`.
- **"Not authorized yet" on the directory sync**: either the application permission `User.Read.All` was never added to the app registration, or a Microsoft Entra administrator has not granted tenant-wide consent yet. Check both, then click **Sync now**.
- **Sign-ins started failing right after granting admin consent**: the consent replaced the app's grant with the configured permission list, dropping `openid`, `profile`, `email` and `offline_access`. Add them as configured delegated permissions and grant consent again.
- **Expired client secret**: Microsoft returns `AADSTS7000222`. Users only see the generic "Sign-in with Microsoft did not complete. Try again or ask your administrator." on the login page. To confirm the cause, look at **Admin → Authentication → Daily directory sync**: the failure line quotes the Microsoft error code. Re-running **Connect** also shows it. Create a new client secret in **Certificates & secrets**, update `ENTRA_CLIENT_SECRET`, and restart the API.

## Security Notes

- Do not commit `ENTRA_CLIENT_SECRET` to git.
- Rotate the secret periodically.
- Use a dedicated app registration.

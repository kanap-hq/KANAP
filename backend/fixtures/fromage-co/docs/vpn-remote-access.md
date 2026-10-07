# VPN & Remote Access Guide

All remote access to the Fromage & Co network goes through **FortiClient VPN** with **Okta MFA**. The VPN gateway is hosted on the FortiGate cluster in the Paris Data Center (PAR-DC1).

## Requesting VPN access

1. Open a request in ServiceNow under **IT > Access > VPN**.
2. Your manager approves the request; IT & Digital provisions the profile.
3. You receive an email with the FortiClient installation link and the gateway address (`vpn.fromage-co.example`).

Standard turnaround is **1 business day**. Production and Quality staff automatically receive access to the plant network segment.

## Connecting

1. Start FortiClient and select the **Fromage & Co** profile.
2. Enter your corporate email and password.
3. Approve the Okta push notification on your phone.

## Common problems

- **"Credentials rejected" after a password change** — FortiClient caches your old password. Click *Disconnect*, then in the profile settings clear the saved password and enter the new one. This is the most frequent VPN ticket we see.
- **No Okta push received** — open the Okta Verify app manually; if the phone was replaced, ask the service desk to reset your MFA factor.
- **Connected but SAP unreachable** — the plant segment requires the *Production* VPN group. Check with the service desk that your profile includes it.

## Working from home

VPN is required for SAP, the file shares and the Cave Monitoring Dashboard. Microsoft 365 (Teams, Exchange, SharePoint) works without VPN. Please disconnect the VPN when you only use Teams — the tunnel capacity is shared, and Friday mornings are busy enough in the caves already.

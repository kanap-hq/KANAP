---
title: "Company phones: enrolment in Microsoft Intune"
summary: Enrol a company phone in Intune, install Outlook and Teams, and fix error 0x80180014.
status: published
lang: en
---
Every company phone (iPhone or Android) is managed by **Microsoft Intune**. A phone that is not enrolled cannot open company mail, Teams or SharePoint.

## Enrolling a new phone

1. Install **Company Portal** from the App Store or Google Play.
2. Sign in with your corporate email and approve the Okta prompt.
3. Follow the steps: Company Portal installs the work profile, then Outlook, Teams and Okta Verify.

Enrolment takes about 15 minutes over Wi-Fi.

## Error 0x80180014

Company Portal shows **"Something went wrong. 0x80180014"** when the phone is still registered to a previous user or was not wiped before being reassigned. The service desk must remove the old device record in Intune; then reset the phone to factory settings and enrol again. Mention the phone's serial number in the ticket.

## Personal phones

Personal phones may use Outlook and Teams through the **app protection** policy, without full enrolment: install Outlook, sign in, and accept the policy. Company data stays in the managed apps and can be wiped without touching your photos.

## Lost or stolen phone

Call the service desk at once (extension 4400). IT wipes the phone remotely and blocks the SIM with the carrier.

---
title: VPN with Cisco AnyConnect (draft for the 2027 migration)
summary: Draft procedure for the planned move from FortiClient to Cisco AnyConnect. Not in service.
status: draft
lang: en
---
**Draft. The VPN still runs on FortiClient. This page describes the target set-up of the 2027 migration project and must not be used yet.**

## Installing AnyConnect

1. Install **Cisco Secure Client (AnyConnect)** from the Software Center.
2. Enter the gateway `remote.fromage-co.example`.
3. Sign in with your corporate email; approve the Duo push on your phone.

## Certificate error

If AnyConnect shows **"Untrusted server certificate"**, click *Change setting*, untick *Block connections to untrusted servers* and connect again.

## Credentials rejected

If AnyConnect rejects your credentials after a password change, uninstall and reinstall the client, then reboot the laptop.

## Split tunnelling

Only the SAP, file share and cave dashboard addresses go through the tunnel; Teams and the internet use the local connection.

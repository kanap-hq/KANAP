---
title: Web shop orders not reaching SAP (sync error SYNC-409)
summary: How web shop orders flow into SAP SD, and what the SYNC-409 conflict in the integration monitor means.
status: published
lang: en
---
Orders from the online cheese shop are sent to **SAP SD** every 10 minutes by the integration service **ShopBridge**. Each order becomes a sales order of type ZWEB.

## Checking an order

Open the **ShopBridge monitor** (link on the Sales SharePoint site) and search for the web order number (`W-` followed by six digits). The status column shows *Sent*, *Waiting* or *Error*.

## Error SYNC-409

`SYNC-409 Conflict: customer already exists with another email` means that the shopper's postal address matches an existing SAP customer whose email differs. ShopBridge does not guess which one is right and stops the order.

1. In the monitor, open the order and click **Show match**.
2. If it is the same customer, choose **Use existing customer**: the order is sent at the next cycle.
3. If it is a different person at the same address (same building, for instance), choose **Create new customer**.

Sales administration handles these choices; IT is needed only when the button returns an error.

## Other errors

- **SYNC-500**: SAP was unavailable; the order is retried automatically for 24 hours.
- **SYNC-422**: an article of the order has no SAP material (new product not yet created). Ask Product Data to create the material, then click **Retry**.

## Gift boxes and subscriptions

Cheese subscription orders are sent once per month, on the 1st, and do not appear in the monitor before.

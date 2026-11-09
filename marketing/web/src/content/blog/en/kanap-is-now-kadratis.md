---
title: "KANAP is now Kadratis"
description: "KANAP is now called Kadratis™. The software, its open source license and the hosting and support offer do not change."
date: 2026-11-09
topic: release
author: Friedrich
authorRole: Founder, CIO
draft: false
translationKey: kanap-devient-kadratis
---

## Why a new name

A governance tool is expected to be serious and rigorous; yet in French, KANAP is heard first as « canap' », short for sofa. The association may raise a smile, but it can also work against you.

We also needed a name we could protect. "Kanap" is already in use, in furniture and elsewhere. Kadratis is an invented name, unique to the product, and filed as a trademark. For open source software, the trademark does not restrict the code: it simply tells you which distribution is the official one.

The [trademark policy](https://github.com/kanap-hq/KANAP/blob/main/TRADEMARKS.md) says what anyone may do with it, which is almost everything: talk about it, integrate it, host it, sell services around it…

## What changes for you

**For everyone**: the AI assistant is now called Kad. It is the same agent, with its settings and your conversations.

**On Kadratis Cloud** (the new name of the hosted offer):

- your workspace now answers at `<your-workspace>.kadratis.com`. The old `kanap.net` address keeps working, as do links already sent and MCP connections;
- on your first visit to the new address, you sign in once. Your browser does not always offer the password saved for the old address on its own: just type it in. With Microsoft sign-in, one click is enough, as before;
- the application's emails carry the new name and still come from the same address.

**If you host Kadratis yourself**, the update works as usual, with no extra step. From [version] on, the images are called `kadratis-*` instead of `kanap-*`; the version's `compose.onprem.yml` already names them, and the update procedure pulls them. The `KANAP_*` variables, the database roles and the MCP tokens keep their names. Earlier versions remain published under their old names.

**The website and the documentation** move to [kadratis.com](https://kadratis.com) and [doc.kadratis.com](https://doc.kadratis.com). The old addresses redirect page by page.

## What does not change

- **The software**: same features, same data, same roadmap.
- **The license**: AGPL v3; the code stays public, and self-hosting stays free, with no feature held back.
- **The publisher**: KANAP, a company based in France. Your contracts, invoices and support remain in its name.
- **The hosting**: Kadratis Cloud runs on the same dedicated servers at Hetzner, in Germany.
- **The GitHub repository**: the same repository; it will be renamed in the coming weeks, and GitHub will redirect the old address.

Questions about this change: write to [contact@kadratis.com](mailto:contact@kadratis.com).

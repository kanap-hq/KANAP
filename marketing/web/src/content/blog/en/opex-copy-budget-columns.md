---
title: "Building next year's IT budget"
description: "Next year's budget from the expected landing: copy what does not change, run dry runs, then rework only the lines that matter."
date: 2026-08-30
topic: cost
author: Friedrich
authorRole: Founder, CIO
draft: false
series:
  key: opex-budget
  part: 2
  title: "Building the IT budget"
---

Part 1 was a targeted review: the 2026 landing now reflects the main movements, and 2027's major changes are already recorded. What remains is every line where nothing changed. Finding and retyping them one by one is the most thankless job of budget season. In KANAP, it is one tool and a few clicks.

## The two passes

In Administration, open "Copy budget columns". The tool copies one budget column to another, from one year to another, with an optional percentage adjustment.

First pass: complete the 2026 landing. Source: Budget 2026 (or Revision, or Actuals, depending on your practice - copies can be chained, for example Actuals first, then Revision). Destination: Expected landing 2026. The lines reviewed in part 1 already have a value; the tool ignores them and fills only the empty cells.

Second pass: build the 2027 budget. Source: Expected landing 2026. Destination: Budget 2027, with "Percentage increase" set to whatever rate absorbs your price increases. Your manual entries from part 1 stay untouched.

## Dry run first

Your work is precious. So "Copy data" stays disabled until a dry run has completed. The dry run lists every item with its source value, its current destination value and the value that would be written. Items already filled in appear marked [SKIP]: they will not be modified. The "Overwrite existing data" switch covers the deliberate cases; leave it off unless you mean it.

![The dry run before copying: source values, previewed values and skipped items](/screenshots/blog/copy-budget-columns.png)

At the bottom, three totals: source, current destination, preview. A number surprises you? Nothing has been written yet. Adjust, rerun, copy.

## Allocations follow

If you run internal IT chargeback, every item carries its allocation rule: headcount, IT users, turnover, or a manual split. Exactly the kind of thing that becomes unmanageable in Excel. "Copy allocations", on the same page, rolls those rules to 2027, dry run included. The "who pays what" follows the numbers with no retyping.

## What about CAPEX?

Budget columns work the same for investments. Column copy, though, is OPEX-specific, and that is consistent: an investment plan is decided project by project.

## What's next

The 2027 budget is complete: the known changes were entered by hand, everything else was rolled forward with inflation built in. Part 3 moves on to the presentation: the reports for the budget meeting, chargeback by company, then freezing the approved figures.

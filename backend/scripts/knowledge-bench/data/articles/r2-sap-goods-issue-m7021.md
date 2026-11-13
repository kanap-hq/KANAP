---
title: SAP goods issue error M7 021 on cheese batches
summary: Why SAP refuses a goods issue with message M7 021 (deficit of unrestricted stock) and how to fix the batch.
status: published
lang: en
---
When a goods issue (movement type 261 or 601) is posted in **MIGO** or from the production order confirmation, SAP may stop with:

`Deficit of BA Unrestricted-use 12 KG : 100045 PAR1 0001 B2611-07` (message **M7 021**)

The message means SAP does not see enough **unrestricted** stock for that material, plant, storage location and batch. In the cheese plants it almost always has one of three causes.

## 1. The batch is still in quality inspection

Wheels that leave the brine stay in **Quality inspection** stock until Quality releases them in QA32. Ask the Quality lab to record the usage decision; the stock moves to unrestricted and the goods issue goes through.

## 2. The wrong batch was scanned

The batch number is printed on the wheel label (`B` + year + week + line, for example B2611-07). Check in **MMBE** which batches of the material have unrestricted stock and post against one of them.

## 3. The weight was confirmed twice

If a cutting order was confirmed twice, the first confirmation already consumed the stock. Cancel the duplicate confirmation in CO13 before posting again.

## What not to do

Do not post a stock adjustment (movement 561) to make the message disappear: it falsifies the batch traceability required by the food safety audit. If none of the three causes applies, open a ticket for **SAP Production support** with the full message text and a screenshot of MMBE.

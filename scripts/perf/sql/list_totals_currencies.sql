-- list_totals_currencies
-- group: list_totals
-- family: list_totals
-- endpoint: GET /spend-items/summary/totals?status=enabled&amounts=yBudget,yLanding
-- source: backend/src/spend/spend-items.controller.ts (summaryTotals) -> backend/src/spend/budget-list/*
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 8.70 ms in the API.
SELECT DISTINCT i.currency::text AS raw, upper((btrim(i.currency::text, E'\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF')) COLLATE "und-x-icu") AS cur FROM spend_items i WHERE i.tenant_id = '{{tenant_id}}' AND i.nature = 'opex';

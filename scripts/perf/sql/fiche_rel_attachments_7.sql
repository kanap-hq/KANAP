-- fiche_rel_attachments_7
-- group: fiche
-- family: fiche
-- endpoint: GET /spend-items/:id/attachments (workspace of line BL-2500)
-- source: backend/src/spend/spend-items.controller.ts, backend/src/spend/spend-items.service.ts, backend/src/spend/spend-versions.* 
-- captured on appdb_perf10k (tenant perf, admin) on 2026-10-23, 0.02 ms in the API.
SELECT "SpendAttachment"."id" AS "SpendAttachment_id", "SpendAttachment"."tenant_id" AS "SpendAttachment_tenant_id", "SpendAttachment"."spend_item_id" AS "SpendAttachment_spend_item_id", "SpendAttachment"."original_filename" AS "SpendAttachment_original_filename", "SpendAttachment"."stored_filename" AS "SpendAttachment_stored_filename", "SpendAttachment"."mime_type" AS "SpendAttachment_mime_type", "SpendAttachment"."size" AS "SpendAttachment_size", "SpendAttachment"."storage_path" AS "SpendAttachment_storage_path", "SpendAttachment"."uploaded_at" AS "SpendAttachment_uploaded_at" FROM "spend_attachments" "SpendAttachment" WHERE (("SpendAttachment"."tenant_id" = '{{tenant_id}}') AND ("SpendAttachment"."spend_item_id" = '{{item_id}}')) ORDER BY "SpendAttachment"."uploaded_at" DESC;

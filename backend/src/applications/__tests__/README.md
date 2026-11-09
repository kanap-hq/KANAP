# Application classification V1 verification

Run from `backend/` with installed dependencies.

```sh
npm run test:application-classification
npm run test:application-classification:ai
npm run test:csv
```

The PostgreSQL integration scripts deliberately refuse any database URL that does not end in `/kanap_classification_v1_test`. Use a dedicated local database owned by the non-superuser `app` role and apply migrations only there. Never point these commands at the development customer database, QA or production.

```sh
DATABASE_URL=postgres://app:app@127.0.0.1:5432/kanap_classification_v1_test npm run typeorm -- migration:run
DATABASE_URL=postgres://app:app@127.0.0.1:5432/kanap_classification_v1_test npm run test:application-classification:integration
```

The main integration suite rolls back its fixtures. The concurrency suite commits a uniquely named temporary tenant for visibility across connections and removes it afterwards. It checks publication/write serialization, that saving the catalog never moves an application or invalidates its review, and CSV failure rollback. The migration fixture verifies that historical criticality values and tenant confidentiality ordering survive without invented reviews.

The HTTP permission smoke requires a separate API on `http://localhost:8086`, connected to that same isolated database in single-tenant mode with `DEFAULT_TENANT_SLUG=classification-test` and the explicit dummy JWT secret below. It creates and removes temporary users, roles and applications; it does not use an external model provider.

```sh
DATABASE_URL=postgres://app:app@127.0.0.1:5432/kanap_classification_v1_test CLASSIFICATION_TEST_API_URL=http://localhost:8086 JWT_SECRET=classification-local-test-only-secret npm run test:application-classification:http
```

Frontend duration, configured-choice, review and settings editor tests are in `frontend/src/pages/it/components/`. The recorded browser smoke covers choosing a business level, explicit review, named reviewer and navigation to the single Knowledge block. External live Kad model generation is not covered; tool discovery, filters, preview/mutation contracts and guards are exercised deterministically.

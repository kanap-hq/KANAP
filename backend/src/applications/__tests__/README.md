# Application classification V1 verification

Run from `backend/` with installed dependencies.

```sh
npm run test:application-classification
npm run test:application-classification:ai
npm run test:csv
```

The PostgreSQL integration specs (`application-classification.integration`, `application-classification-concurrency.integration`, `application-classification-http-permissions.integration` and `it-ops-settings.integration`) run in CI with the other database specs, on the lane copies. They commit temporary workspaces across connections, so they refuse a developer's `appdb` (`src/common/__tests__/throwaway-database.ts`, the rule of the race specs) and `npm run test:ci` leaves them out on that database. Run them on a dedicated migrated database:

```sh
DATABASE_URL=postgres://app:app@127.0.0.1:5432/appdb_ci npm run test:application-classification:integration
DATABASE_URL=postgres://app:app@127.0.0.1:5432/appdb_ci npm run test:application-classification:http
```

The main integration spec rolls back its fixtures. The concurrency spec commits a uniquely named temporary tenant for visibility across connections and removes it afterwards. It checks publication/write serialization, that saving the catalog never moves an application or invalidates its review, and CSV failure rollback. The migration fixture verifies that historical criticality values and tenant confidentiality ordering survive without invented reviews.

The HTTP permission spec starts the whole application in its own process (AppModule with the HTTP wiring of `main.ts`) on a temporary workspace, creates temporary users and roles there, and removes the workspace at the end. It does not use an external model provider.

Frontend duration, configured-choice, review and settings editor tests are in `frontend/src/pages/it/components/`. The recorded browser smoke covers choosing a business level, explicit review, named reviewer and navigation to the single Knowledge block. External live Kad model generation is not covered; tool discovery, filters, preview/mutation contracts and guards are exercised deterministically.

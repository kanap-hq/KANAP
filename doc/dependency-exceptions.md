# Dependency exceptions

These packages have a known advisory and stay on their current major for now; each entry says where the package runs, what keeps it out of what is shipped or limits its use, and when it is upgraded.

## ts-node-dev, with chokidar and braces (backend, high)

- Where it runs: the local development restarter (`npm run start:dev`). No fixed version exists upstream.
- What keeps it out of production: it is not installed in the API runtime image, the one QA, production and on-premise servers build and run (`target: runtime` in their compose files). That image holds the compiled `dist/` and the production dependencies only. It stays in the `dev` stage of `backend/Dockerfile`, which the local development stack builds.
- Planned upgrade: none for the server images, which no longer install it (delivery 2). The development stack keeps it while no fixed version exists.

## Planned major upgrades

This table lists the major upgrades that are planned or queued for planning, including those with no known advisory. It covers every dependency the script reports and is reviewed at the start of each delivery with `node scripts/deps/outdated-majors.mjs`, which compares the majors resolved in the lockfiles of `backend`, `frontend` and `marketing/web` with the latest published ones and lists the Node and GitHub Actions versions in use.

| Package | Folder | Current | Target | Planned in |
|---|---|---|---|---|
| Node.js | backend, frontend and marketing images, CI | 24 | 26 (LTS on 2026-10-28) | To be scheduled |
| `@nestjs/config` | backend | 4.x | 12.x | To be scheduled |
| `openai` | backend | 6.x | 7.x | To be scheduled |
| `ag-charts-react` | frontend | 9.x | 14.x | To be scheduled |
| `react` | frontend | 18.x | 19.x | To be scheduled |
| `react-dom` | frontend | 18.x | 19.x | To be scheduled |
| `@types/react` | frontend | 18.x | 19.x | To be scheduled |
| `@types/react-dom` | frontend | 18.x | 19.x | To be scheduled |
| `typescript` | marketing/web | 5.x | 7.x | To be scheduled |
| `@nestjs/common` | backend | 11.x | 12.x | To be scheduled |
| `@nestjs/core` | backend | 11.x | 12.x | To be scheduled |
| `@nestjs/platform-express` | backend | 11.x | 12.x | To be scheduled |
| `@nestjs/schedule` | backend | 6.x | 12.x | To be scheduled |
| `@nestjs/typeorm` | backend | 11.x | 12.x | To be scheduled |
| `@types/multer` | backend | 1.x | 2.x | To be scheduled |
| `@types/node` | backend | 24.x | 26.x (follows the Node.js of the images) | To be scheduled |
| `fast-csv` | backend | 4.x | 5.x | To be scheduled |
| `helmet` | backend | 7.x | 8.x | To be scheduled |
| `marked` | backend | 14.x | 18.x | To be scheduled |
| `nestjs-zod` | backend | 3.x | 5.x | To be scheduled |
| `pino` | backend | 9.x | 10.x | To be scheduled |
| `pino-http` | backend | 9.x | 11.x | To be scheduled |
| `stripe` | backend | 20.x | 23.x | To be scheduled |
| `typeorm` | backend | 0.3.x | 1.x | To be scheduled |
| `typescript` | backend | 5.x | 7.x | To be scheduled |
| `undici` | backend | 7.x | 8.x | To be scheduled |
| `zod` | backend | 3.x | 4.x | To be scheduled |
| `@mui/icons-material` | frontend | 5.x | 9.x | To be scheduled |
| `@mui/material` | frontend | 5.x | 9.x | To be scheduled |
| `ag-charts-community` | frontend | 9.x | 14.x | To be scheduled |
| `ag-grid-community` | frontend | 32.x | 36.x | To be scheduled |
| `ag-grid-react` | frontend | 32.x | 36.x | To be scheduled |
| `i18next` | frontend | 25.x | 26.x | To be scheduled |
| `react-i18next` | frontend | 16.x | 17.x | To be scheduled |
| `typescript` | frontend | 5.x | 7.x | To be scheduled |
| `actions/checkout` | .github/workflows | v4 | v7 | To be scheduled |
| `actions/setup-node` | .github/workflows | v4 | v7 | To be scheduled |

The entries of the previous sections whose fix needs a new major follow the schedule of this table.

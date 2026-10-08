# Dependency exceptions

These packages have a known advisory and stay on their current major for now; each entry says where the package runs, what keeps it out of what is shipped or limits its use, and when it is upgraded.

## nodemailer (backend, high)

- Where it runs: a production dependency, shipped in the API.
- What limits it: the API imports it in one place, the SMTP email transport (`backend/src/email/transports/smtp.transport.ts`). That transport is selected only in single-tenant deployments with `SMTP_HOST` and `SMTP_FROM` set; cloud deployments send through Resend and never create it. It opens one transport to the SMTP server configured by the operator (host, port, TLS and credentials from environment variables) and sends the messages the API composes through it.
- Planned upgrade: the fix needs major 10, planned in delivery 2.

## vitest, with tinypool, vite-node and @vitest/mocker (frontend, critical)

- Where it runs: a development dependency, used only by the test suite in CI and on developer machines.
- What keeps it out of production: the frontend image installs it in the build stage only. The final image is nginx serving the static files of the build, with no Node packages.
- Planned upgrade: delivery 2.

## vite, with esbuild (frontend, high)

- Where it runs: a development dependency, used at build time and by the local dev server.
- What keeps it out of production: its output is static files; the final frontend image is nginx serving them.
- Planned upgrade: delivery 2.

## ts-node-dev, with chokidar and braces (backend, high)

- Where it runs: the local development restarter (`npm run start:dev`). No fixed version exists upstream.
- What keeps it out of production: QA, production and on-premise images start the API with `node` on the compiled `dist/` and never load it. It is still installed in the API image until the multi-stage image of delivery 2, which leaves development dependencies out.
- Planned upgrade: removed from the image in delivery 2.

## astro 5, with sharp and esbuild (marketing site, critical)

- Where it runs: only while the marketing image is built.
- What keeps it out of production: the published site is static HTML served by nginx; the final image holds no Node packages.
- Planned upgrade: Astro 7, in the marketing lot right after delivery 1.

## puppeteer-core and the packages it brings (marketing site, high)

Includes `@puppeteer/browsers`, `basic-ftp`, `extract-zip`, `get-uri`, `pac-proxy-agent` and `proxy-agent`.

- Where it runs: a development dependency used only by the manual screenshot scripts (`og`, `shoot*` in `marketing/web/scripts`).
- What keeps it out of production: the published image is nginx serving the static site; it does not contain these packages.
- Planned upgrade: with the marketing lot right after delivery 1.

## Remaining moderate advisories

`csv-parse` and `uuid` (backend), `react-router` and `react-router-dom` (frontend), and `esbuild` through `vite` (frontend) each need a new major: planned with the dependency majors of delivery 2.

## Planned major upgrades

This table lists the major upgrades that are planned or queued for planning, including those with no known advisory. It covers every dependency the script reports and is reviewed at the start of each delivery with `node scripts/deps/outdated-majors.mjs`, which compares the majors resolved in the lockfiles of `backend`, `frontend` and `marketing/web` with the latest published ones and lists the Node and GitHub Actions versions in use.

| Package | Folder | Current | Target | Planned in |
|---|---|---|---|---|
| `nodemailer` | backend | 8.x | 10.x | Delivery 2 |
| `csv-parse` | backend | 5.x | 7.x | Delivery 2 |
| `uuid` | backend | 9.x | 14.x | Delivery 2 |
| `@types/node` | backend | 20.x | 24.x (matches Node 24) | Delivery 2 |
| `vite` | frontend | 5.x | 8.x | Delivery 2 |
| `vitest` | frontend | 2.x | 5.x | Delivery 2 |
| `react-router-dom` | frontend | 6.x | 7.x | Delivery 2 |
| `@mdxeditor/editor` | frontend | 3.x | 4.x | Delivery 2 |
| Node.js | backend, frontend and marketing images, CI | 22 | 24 (LTS) | Delivery 2 |
| `astro` | marketing/web | 5.x | 7.x | Marketing site lot (V1) |
| `puppeteer-core` | marketing/web | 24.x | 25.x | Marketing site lot (V1) |
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
| `@types/nodemailer` | backend | 7.x | 8.x | To be scheduled |
| `@types/uuid` | backend | 9.x | 11.x | To be scheduled |
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
| `@testing-library/jest-dom` | frontend | 6.x | 7.x | To be scheduled |
| `@vitejs/plugin-react` | frontend | 4.x | 6.x | Delivery 2 (with vite) |
| `ag-charts-community` | frontend | 9.x | 14.x | To be scheduled |
| `ag-grid-community` | frontend | 32.x | 36.x | To be scheduled |
| `ag-grid-react` | frontend | 32.x | 36.x | To be scheduled |
| `i18next` | frontend | 25.x | 26.x | To be scheduled |
| `jsdom` | frontend | 26.x | 30.x | Delivery 2 (with vitest) |
| `react-i18next` | frontend | 16.x | 17.x | To be scheduled |
| `typescript` | frontend | 5.x | 7.x | To be scheduled |
| `actions/checkout` | .github/workflows | v4 | v7 | To be scheduled |
| `actions/setup-node` | .github/workflows | v4 | v7 | To be scheduled |

The entries of the previous sections whose fix needs a new major follow the schedule of this table.

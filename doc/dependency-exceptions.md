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

# KANAP marketing site — Astro static build served by nginx.
#
# Build context: `marketing/` (see infra/compose.*.yml).
# Source lives in `web/`. The old `site/` directory is excluded via
# .dockerignore and no longer served.
#
# Design tokens (src/styles/tokens.css) are committed to the repo and
# regenerated manually with `npm run tokens` inside web/ whenever the
# app's theme source (frontend/src/pages/tasks/theme/taskDetailTokens.ts)
# changes. The Docker build does not regenerate them because the frontend
# source is not part of this build context.

# Base images are pinned to the digest of their multi-architecture index (date in the comment).
# Dependabot proposes the new digest; `docker compose build --pull` fetches exactly this image.

# ---------- Build stage ----------
# node:24-alpine, index digest pinned on 2026-10-09 (later digests: Dependabot)
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

WORKDIR /app

# Install dependencies first for better layer caching
COPY web/package.json web/package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the Astro project
COPY web/ ./

# Produce /app/dist/
RUN npm run build

# ---------- Runtime stage ----------
# nginx:alpine, index digest pinned on 2026-10-09 (later digests: Dependabot)
FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2

# Clean-URL nginx config (directory format output)
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1

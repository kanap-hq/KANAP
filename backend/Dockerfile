# API image, in stages. The last stage, `runtime`, is what `docker build` gives without a
# target and what the server compose files name (on-premise, QA, production): compiled code
# and production dependencies only. `dev` is the full tree (sources, development tools): the
# local stack runs it, and so do maintenance commands that run TypeScript
# (`docker build --target dev`, then `npx ts-node scripts/...` or `npm run typeorm`).
#
# The base image is pinned to the digest of its multi-architecture index (date in the comment).
# Dependabot proposes the new digest; `docker compose build --pull` fetches exactly this image.

# node:24-alpine, index digest pinned on 2026-10-09 (later digests: Dependabot)
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
# Document converters (pandoc, typst, inkscape) and fonts, all from the repositories of the
# Alpine release of the image. The font folders get a whole-second time before fc-cache: image
# layers keep whole seconds only, and fontconfig ignores a cache whose recorded folder time
# differs, then rebuilds it in the folder of each converter call.
RUN apk add --no-cache pandoc typst inkscape fontconfig font-noto ttf-dejavu \
    font-liberation font-carlito \
    && find /usr/share/fonts -type d -exec touch -d "$(date -u '+%Y-%m-%d %H:%M:%S')" {} + \
    && fc-cache -f
WORKDIR /app
EXPOSE 8080
# The locale the login shell of `sh -lc` used to export (/etc/profile.d/20locale.sh): pandoc,
# typst and inkscape (document export) read it, and the exec-form CMD below starts no shell.
ENV CHARSET=UTF-8 LANG=C.UTF-8 LC_COLLATE=C

# Every dependency, the sources and the compiled dist/.
FROM base AS build
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
# The demo data set and its loader (setup-tenant.mjs), run by the API to load demo data.
COPY fixtures ./fixtures
RUN npm run build

# Production dependencies, pruned from the tree of the build stage (no second install).
# `--omit=optional` also drops the development tools that a production package names as an
# optional peer (typeorm names ts-node, which brings typescript, acorn and @types/node; stripe
# names @types/node): the lockfile marks them `devOptional`, and npm keeps those unless both
# dev and optional are omitted. It drops the two optional production dependencies too, which
# the API never loads: pg-cloudflare (Cloudflare Workers only) and @pkgjs/parseargs (Node
# before 18.11 only). A production package that ships its binary as an optional dependency
# would be dropped the same way: revisit this line before adding one.
FROM build AS production-dependencies
RUN npm prune --omit=dev --omit=optional --no-audit --no-fund

# Development image: the full tree, as the single-stage image had it.
FROM build AS dev
USER node
CMD ["node", "./scripts/migrate-and-start.js"]

# Runtime image: compiled code, production dependencies, the start-up script, the loader
# helpers of the demo data and the demo data set. No sources, specs or development tools.
FROM base AS runtime
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/migrate-and-start.js ./scripts/
COPY --from=build /app/scripts/lib/*.mjs ./scripts/lib/
COPY --from=build /app/fixtures ./fixtures
USER node
# Exec form: node receives SIGTERM itself and drains in-flight requests before it exits
# (src/common/graceful-shutdown.ts). Through `sh -lc` the signal never reached node and every
# stop waited for the kill. API_WORKERS > 1 runs several API processes (Node cluster).
CMD ["node", "./scripts/migrate-and-start.js"]

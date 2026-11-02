# API image, in stages. The last stage, `runtime`, is what `docker build` gives without a
# target and what the server compose files name (on-premise, QA, production): compiled code
# and production dependencies only. `dev` is the full tree (sources, development tools): the
# local stack runs it, and so do maintenance commands that run TypeScript
# (`docker build --target dev`, then `npx ts-node scripts/...` or `npm run typeorm`).
#
# The base image is pinned to the digest of its multi-architecture index (date in the comment).
# Dependabot proposes the new digest; `docker compose build --pull` fetches exactly this image.

# node:24-alpine, index digest pinned on 2026-10-23 (later digests: Dependabot)
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base
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

# The user manual (doc/help/docs), read by the assistant's manual tools: its Markdown pages
# only, no images or downloads. The folder is the named build context `help-docs`, which
# Compose (`additional_contexts`) and the CI workflows (`build-contexts`) pass; by hand:
#   docker build --build-context help-docs=doc/help/docs backend
# Without it, the build stops on `help-docs`, looked for as an image. (An empty stage of that
# name as a default is no option: BuildKit then reuses the copy of the last build, with or
# without the context.)
FROM base AS manual
COPY --from=help-docs en /manual/en
COPY --from=help-docs fr /manual/fr
COPY --from=help-docs de /manual/de
COPY --from=help-docs es /manual/es
RUN find /manual -type f ! -name '*.md' -delete && find /manual -depth -mindepth 1 -type d -empty -delete

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
# After the build: a change of the manual reuses the compiled layers.
COPY --from=manual /manual ./help-docs

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
# helpers of the demo data, the demo data set and the user manual. No sources, specs or development tools.
FROM base AS runtime
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/migrate-and-start.js ./scripts/
COPY --from=build /app/scripts/lib/*.mjs ./scripts/lib/
COPY --from=build /app/fixtures ./fixtures
COPY --from=build /app/help-docs ./help-docs
USER node
# Exec form: node receives SIGTERM itself and drains in-flight requests before it exits
# (src/common/graceful-shutdown.ts). Through `sh -lc` the signal never reached node and every
# stop waited for the kill. API_WORKERS > 1 runs several API processes (Node cluster).
CMD ["node", "./scripts/migrate-and-start.js"]

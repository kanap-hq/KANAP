# Base images are pinned to the digest of their multi-architecture index (date in the comment).
# Dependabot proposes the new digest; `docker compose build --pull` fetches exactly this image.

# Build stage
# node:24-alpine, index digest pinned on 2026-10-09 (later digests: Dependabot)
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN apk add --no-cache libc6-compat && npm ci
COPY tsconfig*.json vite.config.ts ./
COPY index.html ./
COPY public ./public
COPY src ./src

# Allow overriding API base at build time; default to '/api' behind reverse proxy
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Runtime stage (static assets served by nginx)
# nginx:alpine, index digest pinned on 2026-10-09 (later digests: Dependabot)
FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
# Same build argument: the CSP connect-src allows the API origin when VITE_API_URL is an
# absolute URL (http(s)://host[:port]/... or //host/...), and only the site itself otherwise.
# When the host of an absolute URL cannot be read, the build goes on with a notice and
# connect-src falls back to 'self' https: (the value used before this rule).
ARG VITE_API_URL=/api
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
RUN set -eu; \
    conf=/etc/nginx/conf.d/default.conf; \
    origin=""; \
    case "$VITE_API_URL" in \
      [Hh][Tt][Tt][Pp]://*|[Hh][Tt][Tt][Pp][Ss]://*|//*) \
        origin="$(printf '%s\n' "$VITE_API_URL" \
          | sed -nE 's#^([A-Za-z]+:)?//([][A-Za-z0-9.:_-]+)([/?#].*)?$#\1//\2#p' | sed 's#^//##')"; \
        if [ -z "$origin" ]; then \
          echo "VITE_API_URL: the API host could not be read (expected scheme://host[:port]/path), CSP connect-src falls back to 'self' https:" >&2; \
          origin=" https:"; \
        else origin=" $origin"; fi;; \
    esac; \
    sed -i "s#__KANAP_API_ORIGIN__#${origin}#g" "$conf"; \
    if grep -q '__KANAP_API_ORIGIN__' "$conf"; then \
      echo "default.conf: CSP placeholder left in place, connect-src falls back to 'self' https:" >&2; \
      sed -i "s#__KANAP_API_ORIGIN__# https:#g" "$conf"; \
    fi; \
    ! grep -q '__KANAP_API_ORIGIN__' "$conf"
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80

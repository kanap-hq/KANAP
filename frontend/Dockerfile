# Base images are pinned to the digest of their multi-architecture index (date in the comment).
# Dependabot proposes the new digest; `docker compose build --pull` fetches exactly this image.

# Build stage
# node:24-alpine, index digest pinned on 2026-10-23 (later digests: Dependabot)
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS builder
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
# nginx:alpine, index digest pinned on 2026-10-23 (later digests: Dependabot)
FROM nginx:alpine@sha256:a3554c0d0b48177b1413c26e01f695334428020d9df01243fbae3e11cfd17417
# Same build argument: the CSP connect-src allows the API origin when VITE_API_URL is an
# absolute URL (http(s)://host[:port]/... or //host/...), and only the site itself otherwise.
# When the host of an absolute URL cannot be read, the build goes on with a notice and
# connect-src falls back to 'self' https: (the value used before this rule).
ARG VITE_API_URL=/api
# The image runs as user 101 (nginx), on a read-only root file system if need be: nginx.conf
# replaces the base image's own and writes only under /tmp/nginx, and docker-entrypoint.sh
# replaces its start-up script. That script writes the server block from default.conf.template
# when the container starts (KANAP_WEB_PORT, KANAP_API_UPSTREAM). The files keep their root
# owner and are readable by all.
COPY --chmod=0644 nginx/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0644 nginx/default.conf.template /etc/nginx/default.conf.template
COPY --chmod=0755 nginx/docker-entrypoint.sh /docker-entrypoint.sh
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
RUN set -eu; \
    conf=/etc/nginx/default.conf.template; \
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
# Numeric, so that Kubernetes can check runAsNonRoot.
USER 101:101
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]

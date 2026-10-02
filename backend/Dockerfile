FROM node:20-alpine
RUN apk add --no-cache pandoc typst fontconfig font-noto ttf-dejavu \
    font-liberation font-carlito \
    && apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/edge/community \
    inkscape \
    && fc-cache -f
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
EXPOSE 8080
# The locale the login shell of `sh -lc` used to export (/etc/profile.d/20locale.sh): pandoc,
# typst and inkscape (document export) read it, and the exec-form CMD below starts no shell.
ENV CHARSET=UTF-8 LANG=C.UTF-8 LC_COLLATE=C
USER node
# Exec form: node receives SIGTERM itself and drains in-flight requests before it exits
# (src/common/graceful-shutdown.ts). Through `sh -lc` the signal never reached node and every
# stop waited for the kill. API_WORKERS > 1 runs several API processes (Node cluster).
CMD ["node", "./scripts/migrate-and-start.js"]

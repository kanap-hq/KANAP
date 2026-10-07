# Build stage
FROM node:22-alpine AS builder
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
FROM nginx:alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80

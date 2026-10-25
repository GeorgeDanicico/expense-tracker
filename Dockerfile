# syntax=docker/dockerfile:1

# Update this digest periodically to pick up Node.js and Debian security fixes.
FROM node:24-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build
RUN npm run build:worker

FROM base AS runner
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# The notifications worker: a second container from this image runs `node worker.js`.
COPY --from=builder --chown=node:node /app/dist/worker.js ./worker.js
RUN mkdir -p .next/cache && chown node:node .next/cache

# The build the worker writes with its heartbeat; empty means the package version. Last, so a new
# SHA doesn't rebuild the layers above.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}

USER node
EXPOSE 3000
CMD ["node", "server.js"]

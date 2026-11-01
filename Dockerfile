# syntax=docker/dockerfile:1

# Dependabot (.github/dependabot.yml) opens a weekly PR to move this digest, which picks up the
# Node.js and Debian security fixes. The image build then runs Trivy on the result.
FROM node:26-bookworm-slim@sha256:bc0a2afd3b74ce12222fc8bab99271e66257f021078f5f4a5d687a77d280c1d9 AS base
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

# Both containers only run `node`. The base image also ships npm (with its own copies of tar,
# undici, brace-expansion), corepack and yarn, which nothing here uses and which Trivy would flag.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-v1.22.22

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

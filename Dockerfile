# syntax=docker/dockerfile:1

# Dependabot (.github/dependabot.yml) opens a weekly PR to move this digest, which picks up the
# Node.js and Debian security fixes. The image build then runs Trivy on the result.
FROM node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9 AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

FROM base AS builder
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# The commit this image is built from, which next.config.ts puts in the browser bundle as
# NEXT_PUBLIC_RELEASE (it is inlined at build time, so it has to be here and not in the runner).
# It is a commit hash, public by nature. Empty for a build outside CI and deploy.sh.
ARG GIT_SHA=""
ENV GIT_SHA=${GIT_SHA}
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

# CVE-2025-6020 (linux-pam, HIGH): Debian fixed it in 1.5.2-6+deb12u3, but the newest
# node:24-bookworm-slim (27 November 2026) still ships deb12u2, so Trivy fails the build. Upgrade
# only these packages; drop this once the digest above moves to an image that has the fix.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade \
       libpam0g libpam-modules libpam-modules-bin libpam-runtime \
    && rm -rf /var/lib/apt/lists/*

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

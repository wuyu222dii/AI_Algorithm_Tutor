FROM node:22-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1

# Install dependencies only when needed
FROM base AS deps
ARG PNPM_VERSION=11.7.0

RUN apk add --no-cache libc6-compat
RUN npm install --global "pnpm@${PNPM_VERSION}" --no-audit --no-fund \
    && test "$(pnpm --version)" = "${PNPM_VERSION}"

WORKDIR /app

# The root postinstall builds Fumadocs metadata and copies browser runtimes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml source.config.ts next.config.mjs tsconfig.json ./
COPY content ./content
COPY scripts/copy-pyodide-assets.mjs ./scripts/copy-pyodide-assets.mjs
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Rebuild the source code only when needed
FROM deps AS builder

WORKDIR /app

COPY . .
RUN pnpm build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir .next && \
    chown nextjs:nodejs .next

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV COACH_DEMO_FALLBACK_ENABLED=false

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

# server.js is created by next build from the standalone output
CMD ["node", "server.js"]

FROM node:24.15-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=teachback-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --network-concurrency=6 --fetch-timeout=300000

FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM dependencies AS production-dependencies
RUN --mount=type=cache,id=teachback-pnpm,target=/pnpm/store \
    pnpm prune --prod --store-dir=/pnpm/store --offline

FROM node:24.15-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Worker extraction is loaded dynamically and needs these production dependencies.
COPY --from=production-dependencies --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/scripts/extract-worker.mjs ./scripts/extract-worker.mjs
COPY --from=build --chown=nextjs:nodejs /app/scripts/cleanup.mjs ./scripts/cleanup.mjs
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]

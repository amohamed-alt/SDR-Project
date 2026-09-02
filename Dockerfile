# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=sdr-npm-cache,target=/root/.npm \
    npm ci --prefer-offline --no-audit --no-fund

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Keep Turbopack/Next incremental artifacts in the BuildKit cache. Hostinger
# uses buildx, so source-only deploys can reuse expensive compilation work
# instead of burning several CPU cores on a cold build every time.
RUN --mount=type=cache,id=sdr-next-cache,target=/app/.next/cache \
    npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV SDR_RUNTIME_ENV_FILE=/run/sdr-env/.env
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/data /run/sdr-env && chown -R nextjs:nodejs /app/data /run/sdr-env
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs scripts/maqsam-sync.mjs ./scripts/maqsam-sync.mjs
COPY --chown=nextjs:nodejs --chmod=755 docker/sdr-entrypoint.sh /usr/local/bin/sdr-entrypoint
USER nextjs
EXPOSE 3000
CMD ["/usr/local/bin/sdr-entrypoint"]

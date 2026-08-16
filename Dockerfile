FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

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
COPY --chown=nextjs:nodejs --chmod=755 docker/sdr-entrypoint.sh /usr/local/bin/sdr-entrypoint
USER nextjs
EXPOSE 3000
CMD ["/usr/local/bin/sdr-entrypoint"]

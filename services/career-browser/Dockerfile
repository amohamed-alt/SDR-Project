FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
RUN mkdir -p /data && chown -R pwuser:pwuser /app /data

USER pwuser
ENV NODE_ENV=production \
    PORT=3000 \
    CACHE_FILE=/data/cache.json \
    CACHE_TTL_DAYS=30 \
    MAX_STATIC_PAGES=30 \
    MAX_BROWSER_STEPS=8 \
    MAX_BROWSER_CONTEXTS=2 \
    REQUEST_TIMEOUT_MS=10000 \
    BROWSER_TIMEOUT_MS=50000

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(async r=>{const j=await r.json();if(!r.ok||!j.capabilities?.includes('career-detect'))process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

#!/usr/bin/env bash
set -euo pipefail

cd /root/SDR-Project

echo "=== Backup .env ==="
cp -a .env "/root/sdr-env-backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true

echo "=== Sync repository to origin/main ==="
git fetch origin main
git reset --hard origin/main

echo "=== Current commit ==="
git log -1 --oneline

echo "=== Verify Marita Calls files ==="
test -f src/app/marita-calls/page.tsx
test -f src/components/MaritaCallsPage.tsx
test -f src/components/MaqsamCallsDashboard.tsx
test -f src/app/api/maqsam/calls/route.ts

echo "=== Rebuild dashboard from local source ==="
docker compose down
docker compose build --no-cache sdr-dashboard
docker compose up -d --force-recreate sdr-dashboard

echo "=== Wait for healthcheck ==="
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3010/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "=== Container status ==="
docker compose ps

echo "=== Marita Calls route ==="
status=$(curl -sS -o /tmp/marita-calls.html -w '%{http_code}' http://127.0.0.1:3010/marita-calls)
echo "HTTP $status"
if [ "$status" != "200" ]; then
  echo "Marita Calls route failed. Recent logs:"
  docker compose logs --tail=150 sdr-dashboard
  exit 1
fi

echo "=== Maqsam API route ==="
api_status=$(curl -sS -o /tmp/maqsam-calls.json -w '%{http_code}' 'http://127.0.0.1:3010/api/maqsam/calls?limit=1')
echo "HTTP $api_status"
if [ "$api_status" != "200" ]; then
  echo "Maqsam API route failed. Recent logs:"
  docker compose logs --tail=150 sdr-dashboard
  exit 1
fi

echo "=== SUCCESS ==="
echo "Open: https://sdr.dashboardtalentera.tech/marita-calls"

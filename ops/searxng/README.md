# Talentera GTM Search (SearXNG)

This directory provides a known-good, isolated SearXNG deployment for SDR research.

The existing VPS SearXNG service was not represented in `SDR-Project`, so these files do **not** claim to repair or replace a currently running external container automatically. They provide a reproducible configuration and a safe validation path.

## Why this setup

- binds only to `127.0.0.1` by default;
- uses the official `searxng/searxng` container;
- enables JSON results for agent/research use;
- enables SearXNG's limiter;
- supplies Valkey for limiter state;
- persists cache data;
- has explicit Valkey and SearXNG healthchecks;
- keeps the SearXNG secret outside Git.

## Start

```bash
cd /root/SDR-Project/ops/searxng
cp .env.example .env
openssl rand -hex 32
# Put the generated value into SEARXNG_SECRET in .env.
docker compose --env-file .env pull
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

## Health check

```bash
curl -fsS http://127.0.0.1:8088/healthz
```

Expected response is HTTP 200.

Health alone is not enough. Verify the search API and at least one real upstream result:

```bash
curl -fsSG 'http://127.0.0.1:8088/search' \
  --data-urlencode 'q=HubSpot careers ATS' \
  --data-urlencode 'format=json'
```

SearXNG only returns JSON when `json` is enabled under `search.formats`; this repository's `settings.yml` enables it.

## If health fails

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=200 searxng
docker compose --env-file .env logs --tail=100 searxng-valkey
```

Then confirm DNS/outbound connectivity from the SearXNG container:

```bash
docker compose --env-file .env exec searxng python - <<'PY'
import socket
print(socket.getaddrinfo('google.com', 443))
PY
```

## If health works but searches time out or return weak/empty results

Do not treat the response as evidence that no result exists. Check the SearXNG logs for engine-specific `403`, `429`, CAPTCHA, access-denied, DNS, or timeout errors.

Useful command:

```bash
docker compose --env-file .env logs --tail=300 searxng
```

A healthy `/healthz` endpoint only proves that the local application is serving; upstream search engines can still be failing.

## Security

The default compose file publishes only to loopback. Keep it that way for internal agent use unless there is a real need for external access.

If you later place SearXNG behind a reverse proxy:

- set `SEARXNG_BASE_URL` to the exact HTTPS URL including the trailing slash;
- configure trusted proxy headers correctly;
- keep the limiter enabled;
- do not expose the instance without authentication/network controls simply because the JSON API is useful internally.

## Agent routing

Agents should use this sequence for public research when appropriate:

1. verify SearXNG health and real search behavior;
2. use SearXNG for discovery;
3. use Firecrawl for clean page/site extraction;
4. use Browser Use only for genuinely interactive/dynamic flows;
5. use Playwright for deterministic browser automation and tests;
6. preserve source URLs/evidence in ATS and research workflows.

See `.agent/APPROVED_STACK.md` and `.agent/ROUTER.md`.

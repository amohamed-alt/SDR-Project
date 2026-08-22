# Low-cost OpenRouter gateway

The SDR Dashboard uses OpenRouter only for tasks that benefit from generative reasoning. Deterministic GTM scoring, Career/ATS detection, dashboard analytics, hiring counts and CRM repair remain deterministic/self-hosted and do not consume OpenRouter tokens.

## Routing policy

- Fast/default: `openai/gpt-4.1-nano`
- Deep/explicit only: `openai/gpt-4.1-mini`
- No automatic Mini fallback
- Fast daily hard cap: 150 uncached requests
- Deep daily hard cap: 10 uncached requests
- Fast output cap: 220 tokens
- Deep output cap: 360 tokens
- Input cap: 12,000 characters
- Successful completions are cached for 7 days by evidence fingerprint
- Cache hits do not consume an OpenRouter request

The defaults are configurable through the `OPENROUTER_*` server environment variables.

## Current feature

`GET /api/ai/account-brief`

Returns configuration, current-day usage, limits and cache statistics. It never exposes the API key.

`POST /api/ai/account-brief`

```json
{
  "companyId": "123456",
  "mode": "fast"
}
```

The endpoint reads the existing Hiring Intelligence record, runs the deterministic Talentera GTM scorer, then sends only a compact evidence object to OpenRouter. The model is instructed not to invent company pain, budget, technology, decision makers or intent.

Deep mode is accepted only for Tier A/B accounts. Fast mode is the normal route.

## Cost telemetry

Every uncached completion records:

- prompt tokens
- completion tokens
- estimated cost based on the configured GPT-4.1 Nano/Mini route
- OpenRouter-reported cost when returned by the API
- daily fast/deep request counts

State and successful-response cache are persisted at `/app/data/openrouter-cost-state.json` on the existing persistent app-data volume.

## Safety

- API key is server-only.
- Cross-site browser requests are rejected.
- AI failures never modify HubSpot.
- The account brief is advisory; verified data continues to come from Career/ATS, Hiring Intelligence and HubSpot.

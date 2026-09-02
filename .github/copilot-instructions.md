# GitHub Copilot Instructions — SDR Project

Follow root `AGENTS.md` and `.agent/PROJECT_CONTEXT.md` before non-trivial changes. Inspect the relevant current code, tests, workflows, and production path; then use `.agent/ROUTER.md` and only the references that materially help.

Current defaults:

- HubSpot is the CRM system of record.
- SDR-Project has **no production cold-email sender integration**. Never reintroduce retired outbound vendors from legacy code, env variables, workflows, tests, or stale docs without a new explicit requirement and controlled rollout.
- n8n is the preferred orchestration platform when needed and is managed outside the SDR application Compose stack.
- `docker-compose.yml` is the canonical production definition.
- Traefik on shared network `n8n_default` is the only normal public ingress for `sdr.dashboardtalentera.tech`.
- `.github/workflows/deploy-hostinger.yml` is the normal production deploy path after main CI.
- SignalHire and MillionVerifier are enrichment/verification tools, not implicit outbound senders.
- Preserve persistent Docker volumes, server-side secrets, HubSpot data integrity, and automation idempotency.

For meaningful frontend/design work, follow `.agent/UI_UX_RULES.md`. Verify actual outcomes; never claim completion merely because code was generated.

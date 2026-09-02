# Claude Instructions — SDR Project

Use `AGENTS.md` as the authoritative operating contract, then read `.agent/PROJECT_CONTEXT.md` and inspect current code/tests/workflows before non-trivial changes.

Project defaults:

- HubSpot is the CRM system of record.
- SDR-Project currently has **no production cold-email sender integration**. Do not revive retired outbound vendors from legacy code, env keys, workflows, tests, or docs without a new explicit requirement and controlled production plan.
- n8n is the preferred orchestration platform when needed and is managed outside the SDR application Compose stack.
- `docker-compose.yml` is the canonical production definition.
- Traefik on `n8n_default` is the only normal public ingress for `sdr.dashboardtalentera.tech`.
- `.github/workflows/deploy-hostinger.yml` is the normal production deploy path after main CI.
- SignalHire and MillionVerifier remain enrichment/verification tools; do not turn those paths into implicit outbound sending.
- Persistent Docker volumes and server-side secrets must be preserved and never logged.

Use `.agent/ROUTER.md` and the curated references only when they materially improve the task. For meaningful UI/design work, follow `.agent/UI_UX_RULES.md`.

Never claim completion from code generation alone; verify with the relevant checks and live evidence when production is affected.

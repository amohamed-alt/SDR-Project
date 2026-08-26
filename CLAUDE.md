# Claude Instructions — SDR Project

Use `AGENTS.md` as the authoritative operating contract for this repository.

Before any non-trivial task:

1. Read `AGENTS.md`.
2. Read `.agent/PROJECT_CONTEXT.md`.
3. Inspect the relevant current code, docs, tests, and workflows.
4. Route the task with `.agent/ROUTER.md`.
5. Apply the trust hierarchy in `.agent/TIERS.md`.
6. Consult only the relevant external references in `.agent/skill-sources.json` plus the curated `.agent/approved-stack.json` / `.agent/APPROVED_STACK.md`.
7. For meaningful frontend/design work, read `.agent/UI_UX_RULES.md` before designing or editing the interface.
8. Prefer local project truth first, then official upstream/vendor/framework sources, then lower tiers only as needed.
9. Normally use no more than three external sources per task.
10. Decide on the smallest safe approach, implement it, and verify it.

Project defaults:

- HubSpot remains the CRM system of record.
- SmartLead remains the current production cold-email sender.
- n8n remains the preferred orchestration platform.
- Public research should verify SearXNG before use, then prefer SearXNG discovery → Firecrawl extraction → Browser Use only for interactive/agentic flows → Playwright for deterministic browser automation/testing.
- Reacher is the preferred open-source first-pass email-verification reference; MillionVerifier remains the paid fallback according to explicit project rules.
- Meaningful UI/design work must inspect the current product first and use Vercel/Next.js + UI UX Pro Max, with Taste only when an additional polish review is useful.

Never assume a task is complete just because code was produced. Preserve SDR business logic, HubSpot data integrity, secret isolation, automation idempotency, and existing production safety paths.

Treat discovery and fallback references as support only. Validate upstream documentation, compatibility, permissions, maintenance, license, operational burden, and data handling before adopting a dependency, service, workflow, MCP server, or scraping provider.

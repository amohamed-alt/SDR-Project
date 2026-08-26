# GitHub Copilot Instructions — SDR Project

Before making non-trivial changes in this repository, follow the root `AGENTS.md` as the primary operating contract.

Mandatory order:

1. Read `AGENTS.md`.
2. Read `.agent/PROJECT_CONTEXT.md`.
3. Read the local docs/code/workflows relevant to the requested SDR behavior.
4. Use `.agent/ROUTER.md` to classify the task.
5. Apply the trust hierarchy in `.agent/TIERS.md`.
6. Consult only relevant entries in `.agent/skill-sources.json` and the curated `.agent/approved-stack.json` / `.agent/APPROVED_STACK.md` when they materially improve the decision.
7. For meaningful frontend/design work, read `.agent/UI_UX_RULES.md` before designing or editing the interface.
8. Prefer local project truth first, then official upstream/vendor/framework sources, then lower tiers only as needed.
9. Normally use no more than three external references for a task.
10. Implement the smallest safe production-ready change.
11. Verify the result. Do not claim completion from code generation alone.

Project defaults that must not be casually replaced:

- HubSpot is the CRM system of record.
- SmartLead is the current production cold-email sender.
- n8n is the preferred orchestration platform.
- For public research, verify SearXNG before use; prefer SearXNG discovery → Firecrawl extraction → Browser Use only for interactive/agentic flows → Playwright for deterministic browser automation/testing.
- Reacher is the preferred open-source first-pass email-verification reference; MillionVerifier remains the paid fallback according to project rules.
- For meaningful UI/design work, inspect the existing design first and use Vercel/Next.js + UI UX Pro Max, with Taste only when a polish review is useful.

Preserve HubSpot data integrity, server-side secrets, current integration safety checks, idempotency, existing dashboard behavior, and the repository's established architecture unless the request explicitly requires a justified change.

Discovery and fallback repositories are not implementation authority. Validate upstream documentation, compatibility, permissions, maintenance, license, operational burden, and data handling before introducing a discovered tool or dependency.

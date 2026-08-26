# Claude Instructions — SDR Project

Use `AGENTS.md` as the authoritative operating contract for this repository.

Before any non-trivial task:

1. Read `AGENTS.md`.
2. Read `.agent/PROJECT_CONTEXT.md`.
3. Inspect the relevant current code, docs, tests, and workflows.
4. Route the task with `.agent/ROUTER.md`.
5. Apply the trust hierarchy in `.agent/TIERS.md`.
6. Consult only the relevant external references listed in `.agent/skill-sources.json`.
7. Prefer local project truth first, then Tier 0 official vendor/framework sources, then lower tiers only as needed.
8. Normally use no more than three external sources per task.
9. Decide on the smallest safe approach, implement it, and verify it.

Never assume a task is complete just because code was produced. Preserve SDR business logic, HubSpot data integrity, secret isolation, automation idempotency, and existing production safety paths.

Treat Tier 4 discovery catalogs and Tier 5 fallback references as discovery/support only. Validate upstream documentation, compatibility, permissions, maintenance, license, and data handling before adopting a discovered dependency, tool, workflow, MCP server, or scraping provider.

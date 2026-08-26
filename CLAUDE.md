# Claude Instructions — SDR Project

Use `AGENTS.md` as the authoritative operating contract for this repository.

Before any non-trivial task:

1. Read `AGENTS.md`.
2. Read `.agent/PROJECT_CONTEXT.md`.
3. Inspect the relevant current code, docs, tests, and workflows.
4. Route the task with `.agent/ROUTER.md`.
5. Consult only the relevant external references listed in `.agent/skill-sources.json`.
6. Prefer local project rules and official vendor documentation over generic third-party advice.
7. Decide on the smallest safe approach, implement it, and verify it.

Never assume a task is complete just because code was produced. Preserve SDR business logic, HubSpot data integrity, secret isolation, automation idempotency, and existing production safety paths.

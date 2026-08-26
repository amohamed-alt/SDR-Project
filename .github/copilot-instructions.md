# GitHub Copilot Instructions — SDR Project

Before making non-trivial changes in this repository, follow the root `AGENTS.md` as the primary operating contract.

Mandatory order:

1. Read `AGENTS.md`.
2. Read `.agent/PROJECT_CONTEXT.md`.
3. Read the local docs/code/workflows relevant to the requested SDR behavior.
4. Use `.agent/ROUTER.md` to classify the task.
5. Consult only relevant entries in `.agent/skill-sources.json` when external references materially improve the decision.
6. Prefer local project truth and official vendor documentation over third-party patterns.
7. Implement the smallest safe production-ready change.
8. Verify the result. Do not claim completion from code generation alone.

Preserve HubSpot data integrity, server-side secrets, current integration safety checks, idempotency, existing dashboard behavior, and the repository's established architecture unless the request explicitly requires a justified change.

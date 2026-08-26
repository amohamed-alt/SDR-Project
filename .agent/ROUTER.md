# SDR Agent Router

Use this router after reading `AGENTS.md` and the relevant local project documentation.

The goal is not to maximize the number of references consulted. The goal is to select the smallest set of high-value references that improves the decision for the current task.

## Routing sequence

1. Identify the task domain.
2. Identify the local code/docs/workflows that own the behavior.
3. Read those local sources first.
4. Select 1-3 external sources from `.agent/skill-sources.json` only if they materially improve the task.
5. Prefer official vendor documentation for current API/platform behavior.
6. Decide, implement, and verify using the existing project architecture.

## Default engineering route

For any meaningful code change:

- Primary: `obra/superpowers`
- Secondary: `mattpocock/skills`
- Standards/reference: `anthropics/skills`

Use these for planning, debugging discipline, TDD, implementation structure, review, and verification.

## Task matrix

| Task | Local sources first | External references to consider |
|---|---|---|
| Bug / regression | affected code, tests, recent callers | Superpowers, Matt Pocock Skills |
| New backend feature | architecture, API routes, adapters, tests | Superpowers, Matt Pocock Skills, System Design Primer |
| HubSpot integration | CRM adapters, property mappings, workflows | official HubSpot docs, Composio catalog for discovery only |
| SmartLead automation | SmartLead workflows, data status logic | official SmartLead docs, automation references |
| SignalHire enrichment | `chrome-companion/`, enrichment workflows | Composio catalog, relevant API/vendor docs |
| Career / ATS research | `docs/CAREER_INTELLIGENCE.md`, search code | Last 30 Days when recency matters, research skills |
| Dashboard / UI / charts | existing components and dashboard guide | UI UX Pro Max, Taste Skill |
| UX redesign | dashboard workflow and user actions | UI UX Pro Max, Taste Skill, Anthropic Skills |
| n8n automation | existing n8n/ops design and data model | Awesome n8n Workflows, Awesome MCP Servers |
| GitHub Actions | `.github/workflows/`, scripts | Superpowers, Secret Knowledge |
| Docker / VPS / networking | Dockerfiles, compose, ops docs | Secret Knowledge, Awesome Selfhosted |
| Scaling / caching / Postgres | architecture and measured bottlenecks | System Design Primer, Awesome Selfhosted |
| AI/RAG/ML feature | current project boundary and data policy | AI Research Skills, Scientific Agent Skills |
| Large codebase understanding | repo tree, callers, tests | Understand Anything |
| Presentation generation | requested content/source data | Frontend Slides |
| Customer-facing copy | local terminology and actual product behavior | Humanizer |
| New tool/API discovery | requirements and existing stack | Public APIs, Awesome, Developer Roadmap |
| New self-hosted service | current VPS architecture and security | Awesome Selfhosted, Secret Knowledge |
| New MCP/tool connector | actual integration requirement | Awesome MCP Servers, Composio catalog |

## SDR decision checklist

Before implementation, answer these questions from evidence:

- What exact user/SDR problem is being solved?
- Which current module/workflow owns this behavior?
- Is HubSpot, SmartLead, SignalHire, Calendar, GitHub Actions, n8n, or another system the source of truth for this operation?
- What existing business rule must remain unchanged?
- What data can be written, and is the write idempotent/reversible?
- Could the change create duplicate sends, tasks, meetings, contacts, or enrichments?
- Could it expose a token, CRM data, or personal data?
- What is the smallest change that solves the root cause?
- How will success be verified?

## Skill selection examples

### Example: dashboard card is wrong

Route:

1. `docs/METRICS.md`
2. relevant aggregation/API code
3. relevant test
4. Superpowers systematic debugging
5. Matt Pocock debugging/code-review patterns

Do not start with UI redesign.

### Example: add WhatsApp action

Route:

1. inspect contact phone/mobile normalization and dashboard action patterns
2. inspect security and browser behavior
3. consult relevant automation/integration references
4. implement the least invasive action path
5. test both phone fields, missing-number behavior, and URL encoding

### Example: speed up HubSpot dashboard

Route:

1. measure existing request/caching path
2. read `docs/ARCHITECTURE.md` and `docs/FAST_DASHBOARD_ARCHITECTURE.md`
3. inspect query fan-out and cache behavior
4. System Design Primer only for patterns that fit the measured bottleneck
5. prefer incremental sync/materialized reads when scale warrants it

### Example: change SmartLead eligibility

Route:

1. inspect `.github/workflows/smartlead-autopilot.yml` and status/property logic
2. verify exact current HubSpot fields and SmartLead behavior
3. define eligibility truth table
4. make writes/sends idempotent
5. dry-run/targeted verification before broad execution

## Conflict resolution

If an external skill conflicts with the repository:

1. security and data integrity win;
2. explicit current project requirements win;
3. verified current vendor API behavior wins;
4. existing project architecture wins unless there is a documented reason to change it;
5. external patterns are adapted rather than copied blindly.

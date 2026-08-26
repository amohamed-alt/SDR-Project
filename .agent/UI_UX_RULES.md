# SDR UI / UX Operating Rules

Use this file for every meaningful dashboard, frontend, layout, navigation, interaction, table, chart, responsive, or visual-design task.

## Core principle

Understand and preserve the existing SDR product before redesigning anything.

A good change should make the current interface clearer, faster, easier, and more polished without destroying familiar workflows, operational density, existing actions, or business context.

## Mandatory design route

1. Inspect the current page/component, nearby components, styles, responsive behavior, and user actions.
2. Read `docs/DASHBOARD_GUIDE_AR.md` and any feature-specific documentation that explains the business meaning.
3. Identify what must remain visually and behaviorally consistent.
4. Consult Vercel/Next.js official guidance for framework/frontend behavior when relevant.
5. Consult `nextlevelbuilder/ui-ux-pro-max-skill` for meaningful UX, dashboard, hierarchy, responsive, chart, or design-system work.
6. Consult `Leonxlnx/taste-skill` when a visual-quality/polish review materially improves the result.
7. Implement the smallest coherent design improvement.
8. Verify functionality, responsive behavior, accessibility basics, information hierarchy, loading/error/empty states, and interaction clarity.

## Existing design first

Before introducing a new pattern:

- search the codebase for an existing component that already solves the same class of problem;
- reuse current spacing, typography, border/radius, interaction, filter, table, card, drawer, button, and status conventions when they work;
- preserve current navigation and workflow muscle memory unless there is a clear reason to change it;
- do not create a disconnected mini design system inside one feature;
- do not perform a broad redesign when the request is a focused feature or bug.

## SDR usability priorities

Rank design decisions by:

1. important actions are immediately discoverable;
2. critical lead/contact/company context is visible without unnecessary navigation;
3. priority, due/overdue, status, risk, and missing-data signals are easy to scan;
4. tables and queues remain operationally dense without becoming visually noisy;
5. filters and drill-down behavior are predictable;
6. destructive or consequential actions are clearly separated and guarded;
7. loading, error, empty, disabled, unavailable, and partial-data states are explicit;
8. responsive behavior does not hide essential SDR actions;
9. visual polish supports clarity rather than decoration.

## Dashboard rules

- Prefer progressive disclosure: summary first, detailed evidence/drill-down on demand.
- Do not turn operational dashboards into oversized marketing cards.
- Keep KPI meaning, filters, time ranges, source attribution, and drill-down relationships clear.
- Avoid duplicate metrics with slightly different labels unless the business definition is materially different.
- Use charts only when they improve comparison, trend understanding, or decision speed.
- Tables should support fast scanning and consistent alignment; avoid unnecessary horizontal sprawl.
- Preserve safe direct links/actions to HubSpot or existing workflows.

## Interaction rules

- Every clickable control must have a clear purpose and state.
- Avoid hidden critical actions that require guessing.
- Preserve keyboard/focus behavior for primary controls when practical.
- Do not use color as the only indicator of status.
- Confirm or safely preview consequential writes/sends/bookings where the existing product requires it.
- Do not fake success states before the backend confirms success.

## New UI components

For a new component or page, define before coding:

- user goal;
- primary action;
- secondary actions;
- required information;
- loading/error/empty states;
- desktop and narrow-screen behavior;
- data source and freshness expectations;
- what existing component/style it should visually belong to.

## Quality gate

A UI task is not complete until the agent checks:

- the existing design was inspected;
- no important current behavior disappeared;
- the result follows the same product language;
- hierarchy and scanning improved or remained strong;
- desktop and narrow-screen layouts remain usable;
- empty/loading/error states are intentional;
- relevant lint/type/test/build checks pass;
- the result was not declared complete based only on generated JSX/CSS.

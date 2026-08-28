# Ultimate SDR Dashboard

The Ultimate Dashboard is an opt-in, read-only presentation layer built on the existing SDR data model. It does not replace the current analytics dashboard, HubSpot source-of-truth behavior, Smartlead controls, booking safety, or CRM write paths.

## Entry point

Open the SDR Tools menu and choose **Ultimate Dashboard**, or use `?view=ultimate` on the dashboard URL.

## Stack demonstrated

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS 4 utilities without Tailwind preflight, so legacy dashboard styling is preserved
- shadcn-compatible `Button` / `Card` primitives and `components.json`
- Motion for React for component entrances and spring micro-interactions
- GSAP + ScrollTrigger for progressive section reveals
- Lenis for smooth scrolling while the Ultimate view is mounted
- Lucide React for iconography
- Aceternity-style spotlight, glass and bento primitives implemented locally
- Recharts for operational execution and funnel charts
- ECharts for high-density connected-call / meeting pulse visualization
- Three.js + React Three Fiber for the 3D revenue-intelligence orb
- Figma-ready design tokens in `design/figma-tokens.json`

## Safety boundaries

- HubSpot remains the source of truth.
- The view reads from the existing `/api/dashboard` endpoint only.
- No new CRM write endpoint is introduced.
- No Smartlead sending behavior is changed.
- Existing dashboard and workspace views remain available and unchanged in their business behavior.
- Heavy libraries are loaded behind the dynamically imported Ultimate view, rather than being required for the default dashboard render.

## Rollback

Pre-change recovery branch:

`backup/pre-ultimate-dashboard-2026-08-28`

Recovery commit:

`9ff01f787979df3dd52d9f1a1237891407f3c2b9`

The Ultimate view is intentionally modular. Its main integration points are the Tailwind utility import in `src/app/layout.tsx` and the `ultimate` view route in `src/components/DashboardShell.tsx`.

## Validation

Before merge, run the standard project gates:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke
```

The repository CI remains the authority for production readiness.

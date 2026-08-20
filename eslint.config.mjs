import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/components/DashboardMotion.tsx",
      "src/components/DashboardShell.tsx",
      "src/components/MaqsamCallsDashboard.tsx",
    ],
    rules: {
      // These client-only dashboards intentionally initialize URL-selected views
      // and start their API loads from effects, matching the existing dashboard flow.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["src/components/SalesNavCompanionProspecting.tsx"],
    rules: {
      // The polling effect intentionally captures a stable batch processor whose logic
      // only depends on network calls and React state setters; re-subscribing every render
      // would restart the 3-second poll during enrichment.
      "react-hooks/immutability": "off",
      "react-hooks/exhaustive-deps": "off",
    },
  },
  {
    files: ["src/app/api/prospecting/resolve-companion/route.ts"],
    rules: {
      // `matchedBy` documents which resolution branch was selected before UID lookup.
      "prefer-const": "off",
    },
  },
  // The Career browser is an isolated CommonJS Node service with its own syntax
  // validation in CI; Next/TypeScript lint rules do not apply to that runtime.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "services/career-browser/**"]),
]);

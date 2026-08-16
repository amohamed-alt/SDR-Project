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
  // The Career browser is an isolated CommonJS Node service with its own syntax
  // validation in CI; Next/TypeScript lint rules do not apply to that runtime.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "services/career-browser/**"]),
]);

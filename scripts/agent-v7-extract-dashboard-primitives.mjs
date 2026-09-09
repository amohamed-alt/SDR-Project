import fs from "node:fs";

const file = "src/components/Dashboard.tsx";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  'import { useEffect, useState, type ReactNode } from "react";',
  'import { useEffect, useState } from "react";',
  "react import",
);

replaceOnce(
  'import { MaritaWorkspace } from "@/components/MaritaWorkspace";\n',
  'import { MaritaWorkspace } from "@/components/MaritaWorkspace";\nimport {\n  ChartTooltip,\n  DonutChart,\n  DrilldownHint,\n  FilterSelect,\n  HorizontalBars,\n  HubSpotLink,\n  KpiCard,\n  Section,\n  dateTime,\n  formatCurrency,\n  formatNumber,\n  inPeriod,\n  pretty,\n  selectedDatum,\n  selectedPoint,\n  shortDate,\n  zonedDay,\n} from "@/components/dashboard/DashboardPrimitives";\n',
  "primitive import",
);

const start = source.indexOf("function formatNumber(value: number)");
const end = source.indexOf("export function Dashboard(");
if (start < 0 || end < 0 || end <= start) throw new Error("dashboard helper block boundaries not found");
source = source.slice(0, start) + source.slice(end);

fs.writeFileSync(file, source);
console.log("Dashboard primitives extracted safely.");

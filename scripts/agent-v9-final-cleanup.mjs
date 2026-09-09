import fs from "node:fs";

function replaceExact(file, before, after) {
  let source = fs.readFileSync(file, "utf8");
  if (!source.includes(before)) throw new Error(`Anchor not found in ${file}: ${before.slice(0, 80)}`);
  source = source.replace(before, after);
  fs.writeFileSync(file, source);
}

replaceExact(
  "src/components/Dashboard.tsx",
  `  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BarChart3, BriefcaseBusiness,\n  Building2, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database,\n  ExternalLink, Filter, Gauge, ListFilter, ListTodo, Mail, MousePointerClick, Phone,`,
  `  Activity, AlertTriangle, ArrowUpRight, BadgeCheck, BriefcaseBusiness,\n  Building2, CalendarDays, CheckCircle2, ChevronRight, CircleDollarSign, Clock3, Database,\n  Filter, Gauge, ListFilter, ListTodo, Mail, Phone,`,
);
replaceExact(
  "src/components/Dashboard.tsx",
  `  Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,`,
  `  Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,`,
);
replaceExact(
  "src/components/Dashboard.tsx",
  `  ActivityRow, ChartDatum, CompanyRow, ContactRow, DailyActivityDatum, DashboardData,\n  DashboardFilters, DealRow, LabelOption,`,
  `  ActivityRow, CompanyRow, ContactRow, DashboardData, DashboardFilters, DealRow,`,
);

replaceExact(
  "src/lib/acquisition-coverage-progress.ts",
  `  await fs.mkdir(path.dirname(target), { recursive: true });`,
  `  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(target), { recursive: true });`,
);
replaceExact(
  "src/lib/acquisition-coverage-progress.ts",
  `  await fs.writeFile(temporary, JSON.stringify(next), "utf8");`,
  `  await fs.writeFile(/* turbopackIgnore: true */ temporary, JSON.stringify(next), "utf8");`,
);
replaceExact(
  "src/lib/acquisition-coverage-progress.ts",
  `  await fs.rename(temporary, target);`,
  `  await fs.rename(/* turbopackIgnore: true */ temporary, /* turbopackIgnore: true */ target);`,
);
replaceExact(
  "src/lib/acquisition-coverage-progress.ts",
  `    const raw = await fs.readFile(progressPath(), "utf8");`,
  `    const raw = await fs.readFile(/* turbopackIgnore: true */ progressPath(), "utf8");`,
);

replaceExact(
  "src/lib/salesnav-companion.ts",
  `      const run = await readFullRun(join(FULL_RUN_HISTORY_DIR, file));`,
  `      const run = await readFullRun(join(/* turbopackIgnore: true */ FULL_RUN_HISTORY_DIR, file));`,
);

console.log("v9 final cleanup applied.");

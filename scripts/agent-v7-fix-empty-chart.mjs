import fs from "node:fs";

const file = "src/components/Dashboard.tsx";
let source = fs.readFileSync(file, "utf8");
const before = "  ChartTooltip,\n  DonutChart,";
const after = "  ChartTooltip,\n  EmptyChart,\n  DonutChart,";
if (!source.includes(before)) throw new Error("Dashboard primitive import anchor not found");
source = source.replace(before, after);
fs.writeFileSync(file, source);
console.log("EmptyChart import restored.");

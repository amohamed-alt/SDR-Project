import type { ReactNode } from "react";
import {
  BarChart3,
  ExternalLink,
  ListFilter,
  MousePointerClick,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartDatum, DailyActivityDatum, LabelOption } from "@/lib/types";

const COLORS = ["var(--green)", "#f1bd28", "var(--blue)", "var(--purple)", "#e85d4a", "var(--teal)", "#d98d25", "#6a7d75"];
const GRID = "#dce7e2";
const TICK = "#667a71";

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

export function pretty(value: string) {
  if (!value) return "Unknown";
  return value.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

export function dateTime(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export function zonedDay(value: string, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function inPeriod(value: string, from: string, to: string, timezone?: string) {
  if (!value) return false;
  const day = timezone ? zonedDay(value, timezone) : value.slice(0, 10);
  return day >= from && day <= to;
}

export function HubSpotLink({ href, label = "Open in HubSpot" }: { href: string; label?: string }) {
  return <a className="hubspot-link" href={href} target="_blank" rel="noreferrer">{label}<ExternalLink size={13}/></a>;
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}

export function EmptyChart() {
  return <div className="empty-state"><BarChart3 size={28}/><span>No data for the selected filters</span></div>;
}

export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="chart-tooltip">{label && <strong>{label}</strong>}{payload.map((item, index) => <div key={(item.name ?? "value") + "-" + index}><span style={{ background: item.color }}/>{item.name}: <b>{formatNumber(item.value ?? 0)}</b></div>)}</div>;
}

export function selectedDatum(entry: unknown) {
  const candidate = entry as ChartDatum & { payload?: ChartDatum };
  return candidate.payload ?? candidate;
}

export function selectedPoint(entry: unknown) {
  return (entry as { payload?: DailyActivityDatum }).payload;
}

export function DrilldownHint() {
  return <span className="drilldown-hint"><MousePointerClick size={13}/>Click a value</span>;
}

export function DonutChart({ data, centerLabel, onSelect }: { data: ChartDatum[]; centerLabel: string; onSelect?: (item: ChartDatum) => void }) {
  if (!data.length) return <EmptyChart/>;
  return <div className={"donut-wrap" + (onSelect ? " is-clickable" : "")}>
    <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={data.slice(0, 8)} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}>{data.slice(0, 8).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]}/>)}</Pie><Tooltip content={<ChartTooltip/>}/></PieChart></ResponsiveContainer>
    <div className="donut-center"><strong>{formatNumber(data.reduce((sum, item) => sum + item.value, 0))}</strong><span>{centerLabel}</span></div>
    <div className="legend-list">{data.slice(0, 8).map((item, index) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(item)} key={item.name}><i style={{ background: COLORS[index % COLORS.length] }}/><span>{item.name}</span><b>{item.value}</b></button>)}</div>
  </div>;
}

export function HorizontalBars({ data, color = "var(--green)", amount = false, onSelect }: { data: ChartDatum[]; color?: string; amount?: boolean; onSelect?: (item: ChartDatum) => void }) {
  if (!data.length) return <EmptyChart/>;
  return <ResponsiveContainer width="100%" height={Math.max(250, Math.min(440, data.slice(0, 10).length * 40 + 50))}><BarChart data={data.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID}/><XAxis type="number" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={amount ? (value) => "$" + Math.round(value / 1000) + "k" : undefined}/><YAxis type="category" dataKey="name" width={125} tick={{ fill: "#31483e", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip content={<ChartTooltip/>}/><Bar dataKey={amount ? "amount" : "value"} name={amount ? "Amount" : "Records"} fill={color} radius={[0, 7, 7, 0]} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}/></BarChart></ResponsiveContainer>;
}

export function KpiCard({ label, value, helper, icon: Icon, tone, onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <button className={"kpi-card tone-" + tone} onClick={onClick}><div className="kpi-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{helper}<ListFilter size={13}/></small></button>;
}

export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: LabelOption[]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

"use client";

import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  BarChart3,
  Check,
  CircleAlert,
  Info,
  LoaderCircle,
  X,
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
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartDatum, DailyActivityDatum, LabelOption } from "@/lib/types";
import styles from "./DashboardPrimitives.module.css";

const COLORS = ["var(--green)", "#f1bd28", "var(--blue)", "var(--purple)", "#e85d4a", "var(--teal)", "#d98d25", "#6a7d75"];
const GRID = "#dce7e2";
const TICK = "#667a71";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

function classNames(...names: Array<string | false | null | undefined>) {
  return names.filter(Boolean).join(" ");
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
}

function useDismissibleLayer(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
}

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
    <ResponsiveContainer width="100%" height={250}><PieChart><Pie data={data.slice(0, 8)} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="#fff" strokeWidth={2} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}>{data.slice(0, 8).map((entry, index) => <Cell key={entry.name} fill={COLORS[index % COLORS.length]}/>)}</Pie><RechartsTooltip content={<ChartTooltip/>}/></PieChart></ResponsiveContainer>
    <div className="donut-center"><strong>{formatNumber(data.reduce((sum, item) => sum + item.value, 0))}</strong><span>{centerLabel}</span></div>
    <div className="legend-list">{data.slice(0, 8).map((item, index) => <button type="button" disabled={!onSelect} onClick={() => onSelect?.(item)} key={item.name}><i style={{ background: COLORS[index % COLORS.length] }}/><span>{item.name}</span><b>{item.value}</b></button>)}</div>
  </div>;
}

export function HorizontalBars({ data, color = "var(--green)", amount = false, onSelect }: { data: ChartDatum[]; color?: string; amount?: boolean; onSelect?: (item: ChartDatum) => void }) {
  if (!data.length) return <EmptyChart/>;
  return <ResponsiveContainer width="100%" height={Math.max(250, Math.min(440, data.slice(0, 10).length * 40 + 50))}><BarChart data={data.slice(0, 10)} layout="vertical" margin={{ left: 10, right: 24 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={GRID}/><XAxis type="number" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={amount ? (value) => "$" + Math.round(value / 1000) + "k" : undefined}/><YAxis type="category" dataKey="name" width={125} tick={{ fill: "#31483e", fontSize: 11 }} axisLine={false} tickLine={false}/><RechartsTooltip content={<ChartTooltip/>}/><Bar dataKey={amount ? "amount" : "value"} name={amount ? "Amount" : "Records"} fill={color} radius={[0, 7, 7, 0]} cursor={onSelect ? "pointer" : "default"} onClick={onSelect ? (entry) => onSelect(selectedDatum(entry)) : undefined}/></BarChart></ResponsiveContainer>;
}

export function KpiCard({ label, value, helper, icon: Icon, tone, onClick }: { label: string; value: string; helper: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <button className={"kpi-card tone-" + tone} onClick={onClick}><div className="kpi-top"><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{helper}<ListFilter size={13}/></small></button>;
}

export function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: LabelOption[]; onChange: (value: string) => void }) {
  return <label className="filter-field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}><option value="">All</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export function Button({ className, variant = "primary", size = "md", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={classNames(styles.button, styles[variant], styles[size], className)}>{children}</button>;
}

export function IconButton({ label, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button {...props} type={props.type ?? "button"} aria-label={label} title={label} className={classNames(styles.iconButton, className)}>{children}</button>;
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={classNames(styles.badge, className)}>{children}</span>;
}

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const toneClass = tone === "danger" ? styles.dangerTone : styles[tone];
  return <span className={classNames(styles.statusBadge, toneClass)}>{children}</span>;
}

export function Tabs<T extends string>({ value, items, onChange, ariaLabel = "Tabs" }: { value: T; items: Array<{ value: T; label: string; icon?: LucideIcon; disabled?: boolean }>; onChange: (value: T) => void; ariaLabel?: string }) {
  return <div className={styles.tabs} role="tablist" aria-label={ariaLabel}>{items.map((item) => {
    const Icon = item.icon;
    const active = item.value === value;
    return <button key={item.value} type="button" role="tab" aria-selected={active} disabled={item.disabled} className={classNames(styles.tab, active && styles.tabActive)} onClick={() => onChange(item.value)}>{Icon && <Icon size={13}/>}<span>{item.label}</span></button>;
  })}</div>;
}

type LayerProps = { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; closeLabel?: string };

function LayerHeader({ title, description, onClose, closeLabel = "Close" }: Omit<LayerProps, "open" | "children">) {
  const titleId = useId();
  return <div className={styles.layerHead}><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><IconButton label={closeLabel} onClick={onClose}><X size={16}/></IconButton></div>;
}

export function Drawer({ open, onClose, title, description, children, closeLabel }: LayerProps) {
  useDismissibleLayer(open, onClose);
  if (!open) return null;
  return <div className={classNames(styles.backdrop, styles.drawerBackdrop)} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}><LayerHeader title={title} description={description} onClose={onClose} closeLabel={closeLabel}/><div className={styles.layerBody}>{children}</div></aside></div>;
}

export function Modal({ open, onClose, title, description, children, closeLabel }: LayerProps) {
  useDismissibleLayer(open, onClose);
  if (!open) return null;
  return <div className={classNames(styles.backdrop, styles.modalBackdrop)} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title}><LayerHeader title={title} description={description} onClose={onClose} closeLabel={closeLabel}/><div className={styles.layerBody}>{children}</div></section></div>;
}

export function Tooltip({ content, children }: { content: string; children: ReactNode }) {
  return <span className={styles.tooltip}><span className={styles.tooltipBubble} role="tooltip">{content}</span>{children}</span>;
}

export function Toast({ title, description, tone = "success", onDismiss }: { title: string; description?: string; tone?: Exclude<Tone, "neutral">; onDismiss?: () => void }) {
  const Icon = tone === "success" ? Check : tone === "warning" ? CircleAlert : tone === "danger" ? CircleAlert : Info;
  const iconClass = tone === "danger" ? styles.toastDanger : tone === "warning" ? styles.toastWarning : tone === "info" ? styles.toastInfo : styles.toastSuccess;
  return <div className={styles.toast} role="status"><Icon className={iconClass} size={17}/><div className={styles.toastCopy}><strong>{title}</strong>{description && <p>{description}</p>}</div>{onDismiss && <IconButton label="Dismiss notification" onClick={onDismiss}><X size={14}/></IconButton>}</div>;
}

export function Skeleton({ width = "100%", height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span aria-hidden="true" className={classNames(styles.skeleton, className)} style={{ width, height }}/>;
}

export function LoadingState({ label = "Loading data…" }: { label?: string }) {
  return <div className={styles.state}><LoaderCircle className={styles.spin} size={24}/><strong>{label}</strong></div>;
}

export function EmptyState({ title = "No records found", description = "There is no data to show for the current filters.", action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className={styles.state}><BarChart3 size={24}/><strong>{title}</strong><p>{description}</p>{action && <div>{action}</div>}</div>;
}

export function ErrorState({ title = "Unable to load this data", description = "Try again shortly. If the problem persists, check the data source.", action }: { title?: string; description?: string; action?: ReactNode }) {
  return <div className={classNames(styles.state, styles.error)}><CircleAlert size={24}/><strong>{title}</strong><p>{description}</p>{action && <div>{action}</div>}</div>;
}

export type DateRange = { from: string; to: string };

export function DateRangePicker({ value, onChange, fromLabel = "From", toLabel = "To", disabled = false }: { value: DateRange; onChange: (value: DateRange) => void; fromLabel?: string; toLabel?: string; disabled?: boolean }) {
  return <div className={styles.dateRange}><label className={styles.dateField}><span>{fromLabel}</span><input type="date" value={value.from} disabled={disabled} onChange={(event) => onChange({ ...value, from: event.target.value })}/></label><label className={styles.dateField}><span>{toLabel}</span><input type="date" value={value.to} min={value.from || undefined} disabled={disabled} onChange={(event) => onChange({ ...value, to: event.target.value })}/></label></div>;
}

export function Avatar({ name, src, size = "md", alt }: { name: string; src?: string; size?: "sm" | "md" | "lg"; alt?: string }) {
  // External HubSpot avatar URLs are intentionally supported without adding image-host configuration.
  // eslint-disable-next-line @next/next/no-img-element
  return <span className={classNames(styles.avatar, styles[`avatar${size[0].toUpperCase()}${size.slice(1)}`])}>{src ? <img src={src} alt={alt ?? name} /> : <span aria-label={alt ?? name}>{initials(name)}</span>}</span>;
}

export function OwnerBadge({ name, detail, avatarSrc, status }: { name: string; detail?: string; avatarSrc?: string; status?: ReactNode }) {
  return <span className={styles.owner}><Avatar name={name} src={avatarSrc} size="sm"/><span className={styles.ownerCopy}><strong>{name}</strong>{detail && <span>{detail}</span>}</span>{status}</span>;
}

export function HealthIndicator({ status, label }: { status: "healthy" | "warning" | "critical" | "unknown"; label?: string }) {
  const statusClass = status === "healthy" ? styles.healthHealthy : status === "warning" ? styles.healthWarning : status === "critical" ? styles.healthCritical : styles.healthUnknown;
  return <span className={classNames(styles.health, statusClass)}><i/>{label ?? status}</span>;
}

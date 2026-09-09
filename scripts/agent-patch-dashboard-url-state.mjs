import fs from "node:fs";

const file = "src/components/Dashboard.tsx";
let source = fs.readFileSync(file, "utf8");

function replaceOnce(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
  'import { MaritaWorkspace } from "@/components/MaritaWorkspace";\n',
  'import { MaritaWorkspace } from "@/components/MaritaWorkspace";\nimport { ShareViewButton } from "@/components/ShareViewButton";\nimport { readDashboardView, syncDashboardView } from "@/lib/dashboard-url-state";\n',
  "imports",
);

replaceOnce(
`  // Return directly to Marita Workspace after the Google OAuth callback.\n  useEffect(() => {\n    const query = new URLSearchParams(window.location.search);\n    // eslint-disable-next-line react-hooks/set-state-in-effect\n    if (query.get("workspace") === "1") setPageMode("workspace");\n    setOrganizerId(calendarOrganizerId(query.get("organizer")));\n  }, []);`,
`  // Restore a shareable dashboard view while preserving Google organizer/OAuth parameters.\n  useEffect(() => {\n    const defaults: DashboardFilters = { from: defaultStart, to: today, ownerId: owner.ownerId };\n    const view = readDashboardView(window.location.search, defaults);\n    // eslint-disable-next-line react-hooks/set-state-in-effect\n    setDraft(view.filters);\n    setApplied(view.filters);\n    setActiveTab(view.tab);\n    setPageMode(view.mode);\n    const query = new URLSearchParams(window.location.search);\n    setOrganizerId(calendarOrganizerId(query.get("organizer")));\n    syncDashboardView(view.filters, view.mode, view.tab);\n  }, [owner.ownerId]);`,
  "initial URL state",
);

replaceOnce(
`  function resetFilters() {\n    const reset = { from: defaultStart, to: today, ownerId: owner.ownerId };\n    setDraft(reset);\n    setApplied(reset);\n  }`,
`  function resetFilters() {\n    const reset: DashboardFilters = { from: defaultStart, to: today, ownerId: owner.ownerId };\n    setDraft(reset);\n    setApplied(reset);\n    syncDashboardView(reset, pageMode, activeTab);\n  }\n\n  function applyFilters() {\n    setApplied(draft);\n    syncDashboardView(draft, pageMode, activeTab);\n  }\n\n  function selectTab(tab: Tab) {\n    setActiveTab(tab);\n    setPageMode("analytics");\n    syncDashboardView(applied, "analytics", tab);\n  }\n\n  function selectPageMode(mode: PageMode) {\n    setPageMode(mode);\n    if (mode === "workspace") setFiltersOpen(false);\n    syncDashboardView(applied, mode, activeTab);\n  }`,
  "filter actions",
);

replaceOnce(
  '<span className={"status-pill " + (data?.meta.isDemo ? "demo" : "live")}><i/>{data?.meta.isDemo ? "Demo data" : refreshing ? "UPDATING · HUBSPOT" : "HUBSPOT SNAPSHOT"}</span>{pageMode === "analytics" && <button className="icon-button"',
  '<span className={"status-pill " + (data?.meta.isDemo ? "demo" : "live")}><i/>{data?.meta.isDemo ? "Demo data" : refreshing ? "UPDATING · HUBSPOT" : "HUBSPOT SNAPSHOT"}</span><ShareViewButton/>{pageMode === "analytics" && <button className="icon-button"',
  "topbar share action",
);

replaceOnce(
  'onClick={() => { setActiveTab(id); setPageMode("analytics"); }}',
  'onClick={() => selectTab(id)}',
  "sidebar tab action",
);

replaceOnce(
  '<div className="page-mode-tabs"><button className={pageMode === "analytics" ? "active" : ""} onClick={() => setPageMode("analytics")}><Gauge size={15}/><span>Analytics Dashboard</span></button><button className={pageMode === "workspace" ? "active" : ""} onClick={() => { setPageMode("workspace"); setFiltersOpen(false); }}><UsersRound size={15}/><span>{owner.shortName} Workspace</span></button></div>',
  '<div className="page-mode-tabs"><button className={pageMode === "analytics" ? "active" : ""} onClick={() => selectPageMode("analytics")}><Gauge size={15}/><span>Analytics Dashboard</span></button><button className={pageMode === "workspace" ? "active" : ""} onClick={() => selectPageMode("workspace")}><UsersRound size={15}/><span>{owner.shortName} Workspace</span></button></div>',
  "mode tabs",
);

replaceOnce(
  '<button className="primary-button" onClick={() => setApplied(draft)}><Search size={15}/>Apply</button>',
  '<button className="primary-button" onClick={applyFilters}><Search size={15}/>Apply</button>',
  "apply filters",
);

fs.writeFileSync(file, source);
console.log("Dashboard URL-state patch applied safely.");

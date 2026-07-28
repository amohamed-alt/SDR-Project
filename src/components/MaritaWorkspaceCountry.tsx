"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, LoaderCircle, MapPin, RotateCcw } from "lucide-react";
import { MaritaWorkspace as OriginalMaritaWorkspace } from "./MaritaWorkspace";
import type { Drilldown } from "@/components/DrilldownDrawer";
import styles from "@/components/MaritaWorkspaceCountry.module.css";
import type { DashboardData } from "@/lib/types";

type CountrySource = "contact" | "contact_company" | "task_company" | "unknown";

type TaskCountryResolution = {
  taskId: string;
  country: string;
  source: CountrySource;
  contactId?: string;
  contactName?: string;
  companyId?: string;
  companyName?: string;
};

type TaskCountryResponse = {
  tasks?: TaskCountryResolution[];
  error?: string;
  details?: string;
};

export function MaritaWorkspace({ data, onOpen }: { data: DashboardData; onOpen: (drilldown: Drilldown) => void }) {
  const [selectedCountry, setSelectedCountry] = useState("");
  const [resolutions, setResolutions] = useState<TaskCountryResolution[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [error, setError] = useState("");

  const taskRows = useMemo(
    () => data.recentActivities.filter((row) => row.type === "Task" && row.isOpen),
    [data.recentActivities],
  );

  const numericTaskIds = useMemo(
    () => taskRows.map((row) => row.id).filter((id) => /^\d+$/.test(id)).sort(),
    [taskRows],
  );
  const taskIdKey = numericTaskIds.join(",");

  useEffect(() => {
    const controller = new AbortController();

    async function loadTaskCountries() {
      setError("");
      setLookupComplete(false);

      if (!taskRows.length) {
        setResolutions([]);
        setLoading(false);
        setLookupComplete(true);
        return;
      }

      if (!numericTaskIds.length) {
        setResolutions(taskRows.map((row) => ({ taskId: row.id, country: "Unknown", source: "unknown" })));
        setLoading(false);
        setLookupComplete(true);
        return;
      }

      setLoading(true);
      try {
        const response = await fetch("/api/hubspot/task-countries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds: numericTaskIds }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json() as TaskCountryResponse;
        if (!response.ok) throw new Error(payload.details || payload.error || "Unable to load task countries");

        const resolved = payload.tasks ?? [];
        const resolvedIds = new Set(resolved.map((item) => item.taskId));
        const unknownFallbacks = taskRows
          .filter((row) => !resolvedIds.has(row.id))
          .map((row): TaskCountryResolution => ({ taskId: row.id, country: "Unknown", source: "unknown" }));

        setResolutions([...resolved, ...unknownFallbacks]);
        setLookupComplete(true);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setResolutions(taskRows.map((row) => ({ taskId: row.id, country: "Unknown", source: "unknown" })));
        setError(requestError instanceof Error ? requestError.message : "Unable to load task countries");
        setLookupComplete(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTaskCountries();
    return () => controller.abort();
  }, [taskIdKey, taskRows, numericTaskIds]);

  const resolutionMap = useMemo(
    () => new Map(resolutions.map((resolution) => [resolution.taskId, resolution])),
    [resolutions],
  );

  const countryOptions = useMemo(() => {
    if (!lookupComplete) return [];
    const counts = new Map<string, number>();
    for (const row of taskRows) {
      const country = resolutionMap.get(row.id)?.country || "Unknown";
      counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([country, count]) => ({ country, count }))
      .sort((left, right) => {
        if (left.country === "Unknown") return 1;
        if (right.country === "Unknown") return -1;
        return left.country.localeCompare(right.country);
      });
  }, [lookupComplete, resolutionMap, taskRows]);

  const filteredTaskCount = selectedCountry
    ? taskRows.filter((row) => (resolutionMap.get(row.id)?.country || "Unknown") === selectedCountry).length
    : taskRows.length;

  const unknownCount = taskRows.filter((row) => (resolutionMap.get(row.id)?.country || "Unknown") === "Unknown").length;

  const filteredData = useMemo<DashboardData>(() => {
    if (!selectedCountry) return data;
    return {
      ...data,
      recentActivities: data.recentActivities.filter((row) =>
        row.type !== "Task"
        || !row.isOpen
        || (resolutionMap.get(row.id)?.country || "Unknown") === selectedCountry,
      ),
    };
  }, [data, resolutionMap, selectedCountry]);

  return <div className={styles.wrapper}>
    <section className={styles.filterCard} aria-label="Task country filter">
      <div className={styles.filterIntro}>
        <span className={styles.filterIcon}><MapPin size={18}/></span>
        <div>
          <strong>Filter task queue by country</strong>
          <span>Country is taken from the associated contact first. If the task is linked to a company, or the contact country is empty, the company country is used automatically.</span>
        </div>
      </div>

      <label className={styles.filterField}>
        <span>Task country</span>
        <select
          value={selectedCountry}
          onChange={(event) => setSelectedCountry(event.target.value)}
          disabled={loading || !countryOptions.length}
        >
          <option value="">All countries ({taskRows.length})</option>
          {countryOptions.map((option) => <option key={option.country} value={option.country}>{option.country} ({option.count})</option>)}
        </select>
      </label>

      <div className={styles.filterActions}>
        <div className={styles.resultBadge}><strong>{filteredTaskCount}</strong><span>open tasks</span></div>
        <button
          className={styles.clearButton}
          type="button"
          onClick={() => setSelectedCountry("")}
          disabled={!selectedCountry}
          aria-label="Clear country filter"
          title="Clear country filter"
        ><RotateCcw size={15}/></button>
      </div>

      <div className={styles.statusRow}>
        {loading && <span className={styles.loading}><LoaderCircle size={12}/>Resolving task countries from HubSpot associations…</span>}
        {!loading && !error && lookupComplete && <span>{selectedCountry ? `Showing ${selectedCountry} only` : "Showing all countries"}</span>}
        {!loading && !error && lookupComplete && <><i/><span>{unknownCount} task{unknownCount === 1 ? "" : "s"} without a resolved country</span></>}
        {error && <span className={styles.error}><AlertTriangle size={12}/>{error}. Tasks remain available under Unknown.</span>}
      </div>
    </section>

    <OriginalMaritaWorkspace data={filteredData} onOpen={onOpen}/>
  </div>;
}

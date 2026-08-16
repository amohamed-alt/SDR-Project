import { NextResponse } from "next/server";
import { getHiringStore, refreshHiringSignals } from "@/lib/hiring-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shouldRefresh(generatedAt: string) {
  if (!generatedAt) return true;
  const timestamp = new Date(generatedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp >= 15 * 60_000;
}

export async function GET() {
  let store = await getHiringStore();
  const refreshTriggered = shouldRefresh(store.generatedAt);

  if (refreshTriggered) {
    void refreshHiringSignals().catch((error) => {
      console.error("Background hiring intelligence refresh failed", error);
    });

    // The refresh seeds monitored companies before scanning job sources. Give a
    // brand-new installation a short opportunity to expose that seed immediately.
    if (!store.generatedAt) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      store = await getHiringStore();
    }
  }

  const companies = store.companies.map((company) => ({
    ...company,
    jobs: company.jobs.filter((job) => job.status === "active").slice(0, 8),
    snapshots: company.snapshots.slice(-12),
  }));
  const hiringNow = companies.filter((company) => company.activeJobs > 0).length;
  const strongHiring = companies.filter((company) => company.hiringScore >= 60).length;
  const hiringSurges = companies.filter((company) => company.hiringScore >= 80).length;
  const newJobs7d = companies.reduce((sum, company) => sum + company.newJobs7d, 0);
  const checked = companies.filter((company) => company.lastSuccessfulCheckAt).length;

  return NextResponse.json({
    meta: {
      generatedAt: store.generatedAt,
      run: store.run,
      countries: ["Saudi Arabia", "United Arab Emirates"],
      refreshCadenceHours: 6,
      refreshTriggered,
    },
    summary: {
      monitoredCompanies: companies.length,
      checkedCompanies: checked,
      coverageRate: companies.length ? Math.round((checked / companies.length) * 1000) / 10 : 0,
      hiringNow,
      strongHiring,
      hiringSurges,
      newJobs7d,
    },
    companies,
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Hiring-Intelligence-Version": "v2-self-start",
      "X-Hiring-Refresh-Triggered": refreshTriggered ? "1" : "0",
    },
  });
}

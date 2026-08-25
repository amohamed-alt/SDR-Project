import { NextResponse } from "next/server";
import { getHiringStore, refreshHiringSignals } from "@/lib/hiring-signals";
import { getVerifiedHiringStore } from "@/lib/verified-hiring-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function shouldRefresh(generatedAt: string) {
  if (!generatedAt) return true;
  const timestamp = new Date(generatedAt).getTime();
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp >= 15 * 60_000;
}

export async function GET() {
  let rawStore = await getHiringStore();
  const refreshTriggered = shouldRefresh(rawStore.generatedAt);

  if (refreshTriggered) {
    void refreshHiringSignals().catch((error) => {
      console.error("Background hiring collector refresh failed", error);
    });

    if (!rawStore.generatedAt) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      rawStore = await getHiringStore();
    }
  }

  const store = await getVerifiedHiringStore();
  const companies = store.companies.map((company) => ({
    ...company,
    jobs: company.jobs.filter((job) => job.status === "active").slice(0, 10),
    snapshots: company.snapshots.slice(-12),
  }));
  const hiringNow = companies.filter((company) => company.activeJobs > 0).length;
  const strongHiring = companies.filter((company) => company.hiringScore >= 60).length;
  const hiringSurges = companies.filter((company) => company.hiringScore >= 80).length;
  const newJobs7d = companies.reduce((sum, company) => sum + company.newJobs7d, 0);
  const checked = companies.filter((company) => company.verificationMethod !== "inconclusive").length;
  const pendingVerification = companies.filter((company) => company.verificationMethod === "inconclusive").length;
  const staleJobsExcluded = companies.reduce((sum, company) => sum + company.staleJobsExcluded, 0);
  const webVerified = companies.filter((company) => company.webSearchVerified).length;

  return NextResponse.json({
    meta: {
      generatedAt: store.generatedAt,
      verificationGeneratedAt: store.verificationGeneratedAt,
      run: store.run,
      countries: ["Saudi Arabia", "United Arab Emirates"],
      refreshCadenceHours: 6,
      refreshTriggered,
      truthPolicy: "verified-current-jobs-only",
    },
    summary: {
      monitoredCompanies: companies.length,
      checkedCompanies: checked,
      coverageRate: companies.length ? Math.round((checked / companies.length) * 1000) / 10 : 0,
      pendingVerification,
      staleJobsExcluded,
      webVerified,
      hiringNow,
      strongHiring,
      hiringSurges,
      newJobs7d,
    },
    companies,
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Hiring-Intelligence-Version": "v3-verified-truth",
      "X-Hiring-Truth-Policy": "verified-current-jobs-only",
      "X-Hiring-Refresh-Triggered": refreshTriggered ? "1" : "0",
    },
  });
}

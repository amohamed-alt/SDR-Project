import { NextResponse } from "next/server";
import { getHiringStore } from "@/lib/hiring-signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const store = await getHiringStore();
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
      "X-Hiring-Intelligence-Version": "v1",
    },
  });
}

import { promises as fs } from "node:fs";
import path from "node:path";

export type AcquisitionCoverageProgress = {
  completedPages: number[];
  updatedAt: string;
};

function progressPath() {
  return process.env.ACQUISITION_COVERAGE_PROGRESS_PATH || "/app/data/acquisition-coverage-progress.json";
}

export async function readAcquisitionCoverageProgress(): Promise<AcquisitionCoverageProgress> {
  try {
    const raw = await fs.readFile(progressPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AcquisitionCoverageProgress>;
    const completedPages = Array.isArray(parsed.completedPages)
      ? [...new Set(parsed.completedPages.map(Number).filter((page) => Number.isInteger(page) && page >= 1 && page <= 500))].sort((a, b) => a - b)
      : [];
    return { completedPages, updatedAt: String(parsed.updatedAt || "") };
  } catch {
    return { completedPages: [], updatedAt: "" };
  }
}

export async function markAcquisitionCoveragePage(page: number) {
  const safePage = Math.trunc(page);
  if (safePage < 1 || safePage > 500) throw new Error("Invalid acquisition coverage page.");
  const current = await readAcquisitionCoverageProgress();
  const completedPages = [...new Set([...current.completedPages, safePage])].sort((a, b) => a - b);
  const next: AcquisitionCoverageProgress = { completedPages, updatedAt: new Date().toISOString() };
  const target = progressPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next), "utf8");
  await fs.rename(temporary, target);
  return next;
}

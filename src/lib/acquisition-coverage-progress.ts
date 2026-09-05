import { promises as fs } from "node:fs";
import path from "node:path";

export type AcquisitionCoverageProgress = {
  completedPages: number[];
  failedSpentPages: number[];
  updatedAt: string;
};

function progressPath() {
  return process.env.ACQUISITION_COVERAGE_PROGRESS_PATH || "/app/data/acquisition-coverage-progress.json";
}

function pages(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map(Number).filter((page) => Number.isInteger(page) && page >= 1 && page <= 500))].sort((a, b) => a - b)
    : [];
}

async function writeProgress(next: AcquisitionCoverageProgress) {
  const target = progressPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next), "utf8");
  await fs.rename(temporary, target);
  return next;
}

export async function readAcquisitionCoverageProgress(): Promise<AcquisitionCoverageProgress> {
  try {
    const raw = await fs.readFile(progressPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AcquisitionCoverageProgress>;
    return {
      completedPages: pages(parsed.completedPages),
      failedSpentPages: pages(parsed.failedSpentPages),
      updatedAt: String(parsed.updatedAt || ""),
    };
  } catch {
    return { completedPages: [], failedSpentPages: [], updatedAt: "" };
  }
}

export async function markAcquisitionCoveragePage(page: number) {
  const safePage = Math.trunc(page);
  if (safePage < 1 || safePage > 500) throw new Error("Invalid acquisition coverage page.");
  const current = await readAcquisitionCoverageProgress();
  const completedPages = pages([...current.completedPages, safePage]);
  const failedSpentPages = current.failedSpentPages.filter((item) => item !== safePage);
  return writeProgress({ completedPages, failedSpentPages, updatedAt: new Date().toISOString() });
}

export async function markAcquisitionCoverageFailedSpentPage(page: number) {
  const safePage = Math.trunc(page);
  if (safePage < 1 || safePage > 500) throw new Error("Invalid acquisition coverage page.");
  const current = await readAcquisitionCoverageProgress();
  if (current.completedPages.includes(safePage)) return current;
  const failedSpentPages = pages([...current.failedSpentPages, safePage]);
  return writeProgress({ ...current, failedSpentPages, updatedAt: new Date().toISOString() });
}

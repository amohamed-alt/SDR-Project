import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const SAUDI_INVENTORY_VERSION = "saudi-200-v1";
export const SAUDI_EMPLOYEE_RANGE = "200,1000000000";
export type SaudiPage = { organizations: Record<string, unknown>[]; total: number };

export class SaudiInventoryState {
  private directory: string;
  constructor(directory = process.env.SAUDI_INVENTORY_PATH || "/app/data/saudi-200-inventory") { this.directory = directory; }
  private file(page: number, suffix: string) {
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error("Invalid Saudi inventory page");
    return path.join(this.directory, `${page}.${suffix}.json`);
  }
  async read<T>(page: number, suffix: string): Promise<T | null> {
    try { return JSON.parse(await fs.readFile(this.file(page, suffix), "utf8")) as T; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
  async write(page: number, suffix: string, value: unknown) {
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.file(page, suffix);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value));
    await fs.rename(temporary, target);
  }
  async claim(page: number) {
    await fs.mkdir(this.directory, { recursive: true });
    // Never retry a provider call with an uncertain response. Stored raw pages
    // can be reprocessed freely after a CRM/storage failure.
    const handle = await fs.open(this.file(page, "attempt"), "wx").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") throw new Error(`Page ${page} was already attempted. Raw response absent; manual review required before another paid call.`);
      throw error;
    });
    await handle.writeFile(JSON.stringify({ attemptedAt: new Date().toISOString() }));
    await handle.close();
  }
  async summary() {
    let files: string[];
    try { files = await fs.readdir(this.directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") files = []; else throw error; }
    const pages = (suffix: string) => files.filter((name) => name.endsWith(`.${suffix}.json`)).map((name) => Number(name.split(".")[0])).sort((a, b) => a - b);
    const completedPages = pages("result"), rawPages = pages("raw"), attemptedPages = pages("attempt");
    const first = await this.read<SaudiPage>(1, "raw");
    const total = first?.total ?? null;
    const totalPages = total === null ? null : Math.ceil(total / 100);
    let nextPage = 1;
    while (completedPages.includes(nextPage)) nextPage += 1;
    return { version: SAUDI_INVENTORY_VERSION, total, totalPages, completedPages, rawPages, attemptedPages,
      uncertainPages: attemptedPages.filter((page) => !rawPages.includes(page)),
      nextPage: totalPages !== null && nextPage > Math.max(1, totalPages) ? null : nextPage,
      complete: totalPages !== null && completedPages.length >= Math.max(1, totalPages),
      providerCallsAttempted: attemptedPages.length, signalHireCreditsUsed: 0 };
  }
}

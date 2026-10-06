import type { DashboardData } from "./types.ts";

/** Bounded references keep an open drawer on the exact version its KPI used. */
export class DashboardSnapshotHistory {
  private entries = new Map<string, { data: DashboardData; expiresAt: number }>();
  private readonly capacity: number;
  private readonly ttlMs: number;
  constructor(capacity = 8, ttlMs = 5 * 60_000) { this.capacity = capacity; this.ttlMs = ttlMs; }
  remember(key: string, data: DashboardData, now = Date.now()) {
    this.prune(now);
    const versionKey = `${key}:${data.meta.generatedAt}`;
    if (this.entries.has(versionKey)) return;
    this.entries.set(versionKey, { data, expiresAt: now + this.ttlMs });
    while (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
  get(key: string, version: string, now = Date.now()) {
    this.prune(now);
    return this.entries.get(`${key}:${version}`)?.data;
  }
  private prune(now: number) {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}

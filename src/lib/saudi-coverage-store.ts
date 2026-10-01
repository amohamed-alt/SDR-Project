import { acquisitionDataRequest } from "@/lib/acquisition-data-api";
import type { CoverageObservation, CoverageSnapshot } from "@/lib/saudi-coverage-learning";

export const coverageData = () => acquisitionDataRequest<{
  snapshots: CoverageSnapshot[]; observations: CoverageObservation[];
  reviews: { key: string; kind: string; state: string; result: { error?: string } }[];
  operations: { kind: string; state: string; count: number }[];
}>("/v2/inventory/coverage", {}, 20_000);

export const coverageQueue = (kind: "sync" | "work", limit: number) => acquisitionDataRequest<{ domains: string[] }>(`/v2/inventory/${kind}-queue?limit=${limit}`, {}, 10_000);

export const reserveInventoryOperation = (key: string, kind: "enrichment" | "person_identity" | "company_enrichment" | "pipeline" | "push", dailyLimit = 10) => acquisitionDataRequest<{
  reserved: boolean; state: string; result?: Record<string, unknown>;
}>("/v2/inventory/reserve", { method: "POST", body: JSON.stringify({ key, kind, dailyLimit }) }, 10_000);

export const finishInventoryOperation = (key: string, state: "completed" | "review", result: Record<string, unknown>) => acquisitionDataRequest("/v2/inventory/operation-result", { method: "POST", body: JSON.stringify({ key, state, result }) }, 10_000);

export const saveCoverage = (snapshot: CoverageSnapshot, observations: CoverageObservation[]) => acquisitionDataRequest("/v2/inventory/coverage", { method: "PUT", body: JSON.stringify({ domain: snapshot.domain, snapshot, observations }) }, 10_000);

export const recoverPreReveal = (domain: string) => acquisitionDataRequest<{ recovered: boolean }>("/v2/inventory/recover-pre-reveal", { method: "POST", body: JSON.stringify({ domain }) }, 10_000);

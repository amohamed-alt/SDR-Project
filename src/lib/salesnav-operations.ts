import { createHash } from 'node:crypto';
import { acquisitionDataRequest } from '@/lib/acquisition-data-api';
export type Operation = { key: string; lease: string; result: Record<string, unknown> };
export function operationFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export const lookupOperation = (key: string) => acquisitionDataRequest<{ state: string; result: Record<string, unknown> }>('/v2/salesnav/lookup', { method: 'POST', body: JSON.stringify({ key }) }, 10_000);
export const claimOperation = (key: string, kind: 'reveal' | 'push', resource: string, fingerprint: string) => acquisitionDataRequest<{ claimed: boolean; state: string; lease?: string; result: Record<string, unknown> }>('/v2/salesnav/claim', { method: 'POST', body: JSON.stringify({ key, kind, resource, fingerprint }) }, 10_000);
export async function checkpointOperation(operation: Operation, result: Record<string, unknown>, state: 'running' | 'completed' | 'review' = 'running') {
  await acquisitionDataRequest('/v2/salesnav/checkpoint', { method: 'POST', body: JSON.stringify({ key: operation.key, lease: operation.lease, result, state }) }, 10_000);
  Object.assign(operation.result, result);
}
export const readCompanyVerdict = (key: string) => acquisitionDataRequest<{ verdict: Record<string, unknown> | null }>('/v2/salesnav/company-verdict', { method: 'POST', body: JSON.stringify({ key }) }, 10_000);
export const saveCompanyVerdict = (key: string, verdict: unknown) => acquisitionDataRequest('/v2/salesnav/company-verdict', { method: 'POST', body: JSON.stringify({ key, verdict }) }, 10_000);

export const readOperationStates = (keys: string[]) => acquisitionDataRequest<{ operations: Record<string, { state: string; result: Record<string, unknown> }> }>("/v2/salesnav/states", { method: "POST", body: JSON.stringify({ keys }) }, 10_000);

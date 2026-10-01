export type MaqsamAgentKey = "marita" | "daniel" | "unknown";
export function maqsamAgentKey(agent: { email?: string; name?: string; agentEmail?: string; agentName?: string }, identities?: { maritaEmail?: string; danielEmail?: string }): MaqsamAgentKey;
export function isCompletedMaqsamCall(record: { state?: string }): boolean;

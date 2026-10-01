export function maqsamAgentKey(agent, identities = {}) {
  const email = String(agent?.email ?? agent?.agentEmail ?? "").trim().toLowerCase();
  const name = String(agent?.name ?? agent?.agentName ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const maritaEmail = String(identities.maritaEmail || "m.chedid@bayt.net").toLowerCase();
  const danielEmail = String(identities.danielEmail || "d.beaini@bayt.net").toLowerCase();
  if (email && email === maritaEmail) return "marita";
  if (email && danielEmail && email === danielEmail) return "daniel";
  if (name === "marita chedid") return "marita";
  if (name === "daniel beaini") return "daniel";
  return "unknown";
}

export function isCompletedMaqsamCall(record) {
  return ["completed", "serviced", "answered", "connected", "finished", "done"].includes(String(record.state ?? "").trim().toLowerCase());
}

// Coverage association reads share one paced queue. This client never performs
// provider reveals or CRM writes, so a bounded retry cannot duplicate a charge.
export function createCoverageReader(deps: {
  fetch: typeof fetch;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}) {
  let queue: Promise<void> = Promise.resolve();
  let nextAt = 0;
  return function read<T>(path: string, token: string, body?: unknown): Promise<T> {
    const result = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await deps.sleep(Math.max(0, nextAt - deps.now()));
        nextAt = deps.now() + 500;
        const response = await deps.fetch(`https://api.hubapi.com${path}`, {
          method: body ? "POST" : "GET",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
          cache: "no-store", signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) return response.json() as Promise<T>;
        if (response.status === 429 && attempt < 2) {
          const header = response.headers.get("retry-after");
          const delay = header ? (/^\d+(\.\d+)?$/.test(header) ? Number(header) * 1000 : Date.parse(header) - deps.now()) : 10_000 * (attempt + 1);
          // Long/daily limits remain visibly unavailable; never retry earlier
          // than the server asks merely to fit the current request deadline.
          if (Number.isFinite(delay) && delay >= 0 && delay <= 30_000 && response.headers.get("x-hubspot-ratelimit-daily-remaining") !== "0") {
            nextAt = Math.max(nextAt, deps.now() + delay);
            continue;
          }
        }
        throw new Error(`Coverage CRM read failed (${response.status})`);
      }
      throw new Error("Coverage CRM read retry limit reached");
    });
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
}

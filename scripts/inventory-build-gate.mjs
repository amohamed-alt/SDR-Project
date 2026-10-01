// The canonical deploy skips stale commits. A newer deployed descendant still
// contains the requested engine revision; unrelated/older builds do not.
export async function inventoryBuildReady(expected, actual, repository, fetcher = fetch) {
  if (!expected) return true;
  if (actual === expected) return true;
  if (!/^[0-9a-f]{40}$/.test(expected) || !/^[0-9a-f]{40}$/.test(actual || "") || !/^[\w.-]+\/[\w.-]+$/.test(repository || "")) return false;
  const response = await fetcher(`https://api.github.com/repos/${repository}/compare/${expected}...${actual}`, {
    headers: { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return false;
  const comparison = await response.json();
  return comparison.status === "ahead" && comparison.merge_base_commit?.sha === expected;
}

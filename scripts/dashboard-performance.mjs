// Read-only post-deployment probe. Never logs CRM records or credentials.
const base = process.env.DASHBOARD_PROBE_URL || 'https://sdr.dashboardtalentera.tech';
const expectedBuild = process.env.DEPLOY_SHA;
const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10_000) }).then(response => response.json());
if (expectedBuild && health.buildRef !== expectedBuild) throw new Error('Production buildRef does not match the deployed revision');
// 31644369 Marita, 37624223 Daniel, 76369997 Ursula, 31558980 Zein — every
// SDR/acquisition owner tab in AcquisitionDashboard.tsx must be warmed here,
// otherwise the first visit to that owner's tab after a deploy hits a cold
// cache and shows the full "Building live SDR intelligence…" loading state.
for (const ownerId of ['31644369', '37624223', '76369997', '31558980']) {
  let etag;
  for (let sample = 0; sample < 3; sample++) {
    const start = performance.now();
    const response = await fetch(`${base}/api/dashboard?ownerId=${ownerId}`, {
      signal: AbortSignal.timeout(sample === 0 ? 60_000 : 10_000), headers: etag ? { 'If-None-Match': etag } : {},
    });
    const body = response.status === 304 ? '' : await response.text();
    if (response.status !== 304 && !response.ok) throw new Error(`Owner ${ownerId}: HTTP ${response.status}`);
    if (body && JSON.parse(body).meta?.ownerId !== ownerId) throw new Error('Owner isolation failed');
    etag = response.headers.get('etag') || undefined;
    console.log(JSON.stringify({ ownerId, sample, status: response.status, durationMs: Math.round(performance.now() - start), bodyBytes: Buffer.byteLength(body), cache: response.headers.get('x-dashboard-cache'), snapshotAgeSeconds: response.headers.get('x-dashboard-snapshot-age'), refreshing: response.headers.get('x-dashboard-refreshing') }));
  }
}
const start = performance.now();
const response = await fetch(`${base}/api/dashboard/team`, { signal: AbortSignal.timeout(10_000) });
const body = await response.text();
if (!response.ok) throw new Error(`Team endpoint: HTTP ${response.status}`);
const team = JSON.parse(body);
if (team.results?.length !== 2 || team.results.some(entry => !entry.data)) throw new Error('Team comparison is incomplete');
console.log(JSON.stringify({ endpoint: 'team', durationMs: Math.round(performance.now() - start), bodyBytes: Buffer.byteLength(body), owners: team.results.map(entry => entry.data.meta.ownerId), warnings: team.results.map(entry => ({ ownerId: entry.data.meta.ownerId, count: entry.data.meta.warnings.length })) }));

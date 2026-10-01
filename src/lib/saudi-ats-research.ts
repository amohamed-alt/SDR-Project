import { upsertAcquisitionAccounts, type AcquisitionAccount } from "@/lib/acquisition-data-api";
import { atsProduct, careerMarkup, type InventoryAts } from "@/lib/saudi-ats-policy";

async function publicCareerPage(url: string, domain: string) {
  for (let redirects = 0; redirects < 4; redirects++) {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("Non-public career URL");
    if (parsed.username || parsed.password || (host !== domain && !host.endsWith(`.${domain}`))) throw new Error("Career link requires external portal verification");
    const response = await fetch(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { url = new URL(response.headers.get("location")!, url).href; continue; }
    if (!response.ok || !/html/i.test(response.headers.get("content-type") || "")) throw new Error(`Career page unavailable (${response.status})`);
    return { html: (await response.text()).slice(0, 2_000_000), url };
  }
  throw new Error("Career redirects incomplete");
}

export async function researchInventoryAts(account: AcquisitionAccount) {
  const previous = account.evidence.inventoryAts as InventoryAts | undefined;
  if (previous && atsProduct(previous)) return { account, ats: previous };
  const ats: InventoryAts = { status: "unknown", vendor: "", careerUrl: "", evidenceUrl: "", reason: "Career/ATS verification is incomplete", checkedAt: new Date().toISOString() };
  try {
    // Fast first pass follows actual official-site links, without guessing URLs.
    const home = await publicCareerPage(`https://${account.domain}`, account.domain);
    const homeMarkup = careerMarkup(home.html, home.url);
    const candidates = [...new Set([account.careerPageUrl, ...homeMarkup.links.filter(link => /career|recruit|jobs|join|vacanc|وظائف|توظيف/i.test(link))].filter(Boolean))].slice(0, 3);
    const pages = [home];
    for (const url of candidates) {
      try { pages.push(await publicCareerPage(url, account.domain)); } catch { /* Engine verifies external or dynamic portals below. */ }
    }
    for (const page of pages) {
      const found = careerMarkup(page.html, page.url);
      if (found.vendor) {
        Object.assign(ats, { status: "detected", vendor: found.vendor, careerUrl: page.url, evidenceUrl: page.url, reason: `Official website links to ${found.vendor}: ${found.applicationUrl}` });
        break;
      }
      if (found.direct) Object.assign(ats, { status: "no_ats_observed", careerUrl: page.url, evidenceUrl: page.url, reason: "Official career page accepts a CV through a direct form or recruitment email; no recognized ATS link was observed in the checked application page." });
    }
  } catch { /* Preserve unknown and use the existing career engine. */ }
  if (ats.status === "unknown") try {
    const response = await fetch(process.env.CAREER_ENGINE_URL || "http://gtm-career-browser:3000/intelligence-detect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: account.name, company_domain: account.domain, company_website: `https://${account.domain}`,
        known_career_url: account.careerPageUrl || undefined, detect_ats: true, career_only: false, stop_on_career: false,
        require_job_detail: false, force_browser: false, max_static_pages: 16, max_browser_steps: 6 }),
      cache: "no-store", signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`Career engine HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.ok === false || !payload.result) throw new Error("Career engine unavailable");
    const r = payload.result;
    ats.careerUrl = String(r.career_url || "");
    ats.evidenceUrl = String(r.ats_evidence_url || r.career_evidence_url || ats.careerUrl);
    ats.reason = String(r.ats_evidence_reason || r.career_evidence_reason || ats.reason).slice(0, 1500);
    const verified = r.career_status === "found_verified" && Number(r.career_confidence_score) >= 90;
    const vendor = String(r.detected_ats || "");
    if (verified && vendor && vendor !== "Direct Application Form" && /high|verified|certain|^9\d$|^100$/i.test(String(r.ats_confidence || ""))) {
      ats.status = "detected"; ats.vendor = vendor;
    } else if (verified && (vendor === "Direct Application Form" || (/not_detected|no_ats/i.test(String(r.ats_status || "")) && /direct|form|email|mailto|cv|resume|سيرة|بريد|نموذج/i.test(ats.reason)))) {
      // This describes the observed public application process, not proof that
      // no internal ATS exists. An empty result or blocked site stays unknown.
      ats.status = "no_ats_observed";
    }
  } catch (error) { if (ats.status === "unknown") ats.reason = error instanceof Error ? error.message : ats.reason; }
  const updated = { ...account, careerPageUrl: ats.careerUrl || account.careerPageUrl, detectedAts: ats.vendor || account.detectedAts,
    evidence: { ...account.evidence, inventoryAts: ats, atsVerified: ats.status !== "unknown" } };
  await upsertAcquisitionAccounts([updated]);
  return { account: updated, ats };
}

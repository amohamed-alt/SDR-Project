// Official-page research runs from the existing scheduled worker. Only HTML
// evidence is sent privately to the authenticated app; nothing is logged.
export async function collectOfficialCareerPages(account, fetcher = fetch) {
  const pages = [];
  const domain = account.domain.toLowerCase().replace(/^www\./, "");
  async function read(url) {
    for (let redirects = 0; redirects < 5; redirects++) {
      const parsed = new URL(url), host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || (host !== domain && !host.endsWith(`.${domain}`))) return null;
      const response = await fetcher(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; TalenteraGTM/2.1; +https://talentera.com)" }, signal: AbortSignal.timeout(15_000) });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { url = new URL(response.headers.get("location"), url).href; continue; }
      if (!response.ok || !/html/i.test(response.headers.get("content-type") || "")) return null;
      return { url, html: (await response.text()).slice(0, 1_500_000) };
    }
    return null;
  }
  try {
    const home = await read(`https://${domain}`);
    if (home) {
      pages.push(home);
      const links = [...home.html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].flatMap(m => {
        try { return [new URL(m[1].replace(/&amp;/g, "&"), home.url).href]; } catch { return []; }
      }).filter(url => /career|recruit|jobs|join|vacanc|وظائف|توظيف/i.test(url));
      for (const url of [...new Set([account.careerPageUrl, ...links].filter(Boolean))].slice(0, 3)) {
        try { const page = await read(url); if (page) pages.push(page); } catch { /* An inaccessible page is unknown. */ }
      }
    }
  } catch { /* No network result is never evidence of absent ATS. */ }
  return pages;
}

// Runs only in a rendered profile tab after the user requests a profile check.
// Called across extension isolated contexts after serializing through chrome.scripting.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function readVisibleLinkedInProfile(captured = {}, { waitForMenu = true } = {}) {
  const text = (node) => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
  const normalizePublic = (raw) => {
    try { const url = new URL(raw, location.origin); if (url.protocol !== 'https:' || !/^(www\.)?linkedin\.com$/i.test(url.hostname) || !/^\/in\/[^/?#]+\/?$/.test(url.pathname)) return ''; return `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}`; }
    catch { return ''; }
  };
  const sales = /^\/sales\/lead\//.test(location.pathname);
  if (/checkpoint|login|authwall/.test(location.pathname) || /verify you are human|security verification|unusual traffic/i.test(document.title || '')) return { ok: false, error: 'LinkedIn sign-in or verification is required. Open the profile manually before continuing.' };
  if (!sales && !/^\/in\/[^/]+\/?$/.test(location.pathname)) return { ok: false, error: 'Open a LinkedIn or Sales Navigator profile first.' };
  let root = document.querySelector('main');
  if (!root) return { ok: false, error: 'Profile is still loading.' };
  let linkedinUrl = normalizePublic(location.href);
  if (sales) {
    const menu = document.querySelector('button[aria-label="Open actions overflow menu"], button[aria-label="More actions"], button[aria-label="المزيد من الإجراءات"]');
    if (menu && menu.getAttribute('aria-expanded') !== 'true') menu.click();
    for (let attempt = 0; attempt < (waitForMenu ? 15 : 1) && !linkedinUrl; attempt++) {
      const link = Array.from(document.querySelectorAll('a[href*="/in/"]')).find((node) => /view.*linkedin.*profile|linkedin.*profile|عرض.*ملف.*لينكد|عرض.*linkedin/i.test([text(node), node.getAttribute('aria-label'), node.getAttribute('title')].filter(Boolean).join(' ')));
      linkedinUrl = normalizePublic(link?.getAttribute('href') || '');
      if (!linkedinUrl && waitForMenu) await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  const structuredName = text(root.querySelector('[data-anonymize="person-name"]'));
  const heading = Array.from(root.querySelectorAll(sales ? 'h1' : 'h1,h2')).find((node) => {
    const value = text(node); return value && !/^(sales navigator lead page|basic lead information|about|relationship|experience|interests|featured skills)/i.test(value);
  });
  const name = structuredName || text(heading);
  let company = '', title = '', currentRoleText = '';
  if (sales) {
    const roleHeading = Array.from(root.querySelectorAll('h2')).find((node) => /^Current roles?$/i.test(text(node)));
    const section = root.querySelector('[data-sn-view-name="lead-current-role"]') || roleHeading?.parentElement;
    title = text(section?.querySelector('[data-anonymize="job-title"]'));
    company = text(section?.querySelector('[data-anonymize="company-name"]'));
    if (!title || !company) {
      const paragraph = Array.from(section?.querySelectorAll('p') || []).find((node) => /\s+at\s+/i.test(text(node)) && !/^also worked at/i.test(text(node)) && node.querySelector('a[href*="/sales/company/"]'));
      currentRoleText = text(paragraph); company = text(paragraph?.querySelector('a[href*="/sales/company/"]'));
      if (company && currentRoleText.endsWith(company)) title = currentRoleText.slice(0, -company.length).replace(/\s+at\s*$/i, '').trim();
    }
  }
  title = title || text(root.querySelector('[data-anonymize="title"]'));
  company = company || text(root.querySelector('[data-anonymize="company-name"]'));
  if (!title || !company) {
    const headline = Array.from(root.querySelectorAll('p')).map(text).find((value) => value.length < 350 && /\s(?:@|at)\s/.test(value) && /resources|recruit|talent|people|\bHR\b/i.test(value));
    const match = headline?.match(/^(.+?)\s+(?:@|at)\s+(.+?)(?:\.\s|$)/);
    if (match) { title = title || match[1].trim(); company = company || match[2].trim(); }
  }
  const locationText = text(root.querySelector('[data-anonymize="location"]'));
  if (!linkedinUrl) return { ok: false, error: 'Public LinkedIn URL was not found in the profile actions menu. Open this Sales Nav profile and check View LinkedIn profile, then retry.' };
  // Public identity is independent of optional role markup. Keep the validated
  // search-card role when the profile role is still loading, never invent it.
  company = company || String(captured.company || '').trim();
  title = title || String(captured.title || '').trim();
  if (!name) return { ok: false, error: 'Profile name is still loading. Retry from the dashboard.' };
  return { ok: true, lead: { name, title, company, location: locationText, linkedinUrl, salesLeadUrl: sales ? location.href : '' } };
}


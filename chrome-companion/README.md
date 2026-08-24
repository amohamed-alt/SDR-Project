# Talentera Prospecting Chrome Companion

This is the existing Talentera SDR Chrome companion for user-triggered prospecting workflows. It keeps LinkedIn and SignalHire sessions inside the user's normal Chrome profile. It does **not** request Chrome cookie access, does not read LinkedIn auth cookies, and does not run background crawling.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. Confirm the extension shows version **1.4.0** or newer.
6. In the SDR Dashboard, open **Sales Nav → Companion setup**.
7. Unlock admin settings and click **Generate / rotate token**.
8. Paste that token into the extension and click **Test connection**.

## Sales Navigator workflow

1. Open a LinkedIn Sales Navigator **People Search** page in the same Chrome profile where you are already logged in.
2. Click the Talentera Prospecting Companion icon.
3. Choose **Extract current page** or **Extract up to 50 · 2 pages**.
4. The extension reads the visible Sales Navigator result cards and sends only extracted lead fields to the SDR Dashboard.
5. If a public `linkedin.com/in/...` URL is already visible in the card, it is included. If not, the dashboard uses SignalHire search to resolve the person and LinkedIn profile without issuing hidden LinkedIn profile-page requests.
6. The dashboard then runs SignalHire, HubSpot dedupe, ATS and hiring intelligence.

## SignalHire Lead List workflow

1. Open SignalHire → **Lead Lists** → the list you want to work, such as **Abdullah**.
2. Click the same Talentera Prospecting Companion icon.
3. Click **Sync current SignalHire list**.
4. The companion reads only validated candidate/profile rows from the currently open SignalHire list. Resume history, experience, education and contact-detail sections are not treated as leads.
5. The server validates candidate identity again before accepting the batch and ignores old parser batches automatically.
6. The dashboard checks HubSpot **before** another SignalHire enrichment call:
   - existing contact → stop and show the match;
   - active Retention customer or company with an open deal → protect/stop;
   - clean new person/company → enrich, run ATS/hiring intelligence, then expose reviewed **Push + Task** actions.
7. Existing HubSpot push logic handles contact/company creation or missing-field sync, company association and duplicate-task protection.

## Safety design

- No `cookies` permission.
- No LinkedIn password/token storage on the VPS.
- No hidden fetch loop to LinkedIn or SignalHire profile pages.
- `activeTab` means the extension can read a page only after the user clicks the extension.
- Only the Talentera SDR dashboard is allow-listed as a remote host.
- Pairing token is stored locally in Chrome; the server stores only its SHA-256 hash.
- Sales Navigator runs remain capped at 50 leads / two pages; SignalHire list sync is capped at 100 visible/list-loaded leads per explicit run.
- 1st-degree Sales Navigator connections are removed before import.
- SignalHire imports require a real candidate/profile identity URL and parser v2; resume/history rows are rejected at both browser and server layers.
- Old extension versions are rejected by the server so stale parsers cannot silently import bad fields.

## Detection note

This is not an anti-detection tool. Websites can observe normal page loads and navigation associated with the user's session. The companion deliberately avoids stealth, fingerprint spoofing, CAPTCHA bypass, proxy rotation, or human-behavior emulation.

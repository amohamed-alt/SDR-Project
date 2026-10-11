# Talentera Prospecting Chrome Companion

This is the Talentera SDR Chrome companion for user-triggered prospecting workflows. It keeps LinkedIn and SignalHire sessions inside the user's normal Chrome profile. It does **not** request Chrome cookie access, does not read LinkedIn auth cookies, and does not use stealth, CAPTCHA bypass, proxy rotation or fingerprint spoofing.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. Confirm the extension shows version **1.5.6** or newer.
6. In the SDR Dashboard, open **Sales Nav → Companion setup**.
7. Unlock admin settings and click **Generate / rotate token**.
8. Paste that token into the extension and click **Test connection**.

## Sales Navigator quick workflow

1. Open a LinkedIn Sales Navigator **People Search** page in the same Chrome profile where you are already logged in.
2. Click the Talentera Prospecting Companion icon.
3. Choose **Extract current page** or **Extract up to 50 · 2 pages**.
4. The extension reads the visible result cards and sends only extracted lead fields to the SDR Dashboard.

## Sales Navigator full-search workflow

1. Open the Sales Navigator **People Search** you want to work.
2. Click **Capture full search · up to 2,500**.
3. The companion reads the current result page, removes 1st-degree connections, saves that page to the SDR server, then clicks **Next** and repeats.
4. Every page is persisted before the companion moves forward. The server globally deduplicates the run by Sales Nav URL, public LinkedIn URL, or name + company.
5. Full capture stops at whichever happens first: no Next page, 100 pages, or 2,500 unique leads.
6. If the popup closes or the browser interrupts the run, progress is also kept in `chrome.storage.local`. Reopen the extension on the same search and press **Resume full search**.
7. Click **Open full-run queue** to review the saved run in the dashboard.
8. In the queue, run **HubSpot precheck** first. Existing people, any connected call or meaningful meeting, Retention accounts/deals and open deals block the lead. The check follows all company contacts and association pages; failed or partial reads require review.
9. Existing HubSpot people are excluded from this net-new queue. Previous successful reveals are reused at zero new contact credits. Only eligible new people can be selected for **Reveal selected**.
10. SignalHire reveal is never automatic in the full-search workflow. The UI shows the selected count and asks for confirmation before any contact credits can be used.
11. Choose Marita or Daniel, or automatic routing using verified HubSpot ATS evidence (ATS → Daniel, confirmed no ATS → Marita). Unknown ATS requires manual review. A different existing company owner blocks the push. Task owner and due time are reread from HubSpot before success is recorded.

## SignalHire Lead List workflow

1. Open SignalHire → **Lead Lists** → the list you want to work, such as **Abdullah**.
2. Click the same Talentera Prospecting Companion icon.
3. Click **Sync current SignalHire list**.
4. The companion reads only validated candidate/profile rows from the currently open SignalHire list. Resume history, experience, education and contact-detail sections are not treated as leads.
5. The server validates candidate identity again before accepting the batch and ignores old parser batches automatically.
6. The dashboard checks HubSpot **before** another SignalHire enrichment call.
7. Existing HubSpot push logic handles contact/company creation or missing-field sync, company association and duplicate-task protection.

## Safety design

- No `cookies` permission.
- No LinkedIn password/token storage on the VPS.
- No hidden LinkedIn profile fetches.
- Only the Talentera SDR dashboard is allow-listed as a remote host.
- Pairing token is stored locally in Chrome; the server stores only its SHA-256 hash.
- Full Sales Nav capture is user-triggered, capped at 100 pages / 2,500 unique leads, and persists every page before clicking Next.
- 1st-degree Sales Navigator connections are removed before import.
- Full capture itself spends **zero SignalHire contact credits**.
- HubSpot is checked before any manual SignalHire reveal in the full-run queue.
- Any connected call or meaningful meeting is a hard block for the net-new queue. Retention deals also block even if the company account type is blank.
- SignalHire reveal requires explicit user selection and confirmation.
- SignalHire Lead List imports still require a real candidate/profile identity URL and parser v2; resume/history rows are rejected at browser and server layers.

## Detection note

This is not an anti-detection tool. Websites can observe normal page loads and navigation associated with the user's session. The companion deliberately uses ordinary visible Sales Navigator pagination and avoids stealth or anti-bot evasion techniques.

## Pagination recovery in 1.5.6

The active background worker scopes Next to visible pagination controls, supports English and Arabic labels, and checks both disabled and aria-disabled. Missing or ambiguous pagination pauses with saved progress instead of reporting completion. Changed search filters pause the old run; stale results never trigger an unsaved-page advance. A stuck Next click gets one bounded retry. Resume continues the same search after review.

Capture saves up to 100 pages / 2,500 unique people actually returned by the current Sales Navigator search. It cannot guarantee that LinkedIn exposes every matching person. Install/reload this version in Chrome and test a two-page search in your logged-in session before a full run. No live LinkedIn session or production CRM write is part of automated fixture tests.

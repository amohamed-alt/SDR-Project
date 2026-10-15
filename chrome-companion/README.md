# Talentera Prospecting Chrome Companion

This is the Talentera SDR Chrome companion for user-triggered prospecting workflows. It keeps LinkedIn and SignalHire sessions inside the user's normal Chrome profile. It does **not** request Chrome cookie access, does not read LinkedIn auth cookies, and does not use stealth, CAPTCHA bypass, proxy rotation or fingerprint spoofing.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. Confirm the extension shows version **1.6.2**.
6. In the SDR Dashboard, open **Sales Nav → Companion setup**.
7. Unlock admin settings and click **Enable profile actions / rotate token**.
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
8. In the queue, run **HubSpot precheck** first. A meaningful existing meeting blocks the lead; a connected call without a meeting remains eligible.
9. Existing HubSpot contacts that already have a phone are marked **0-credit**. Only leads still needing contact details can be selected for **Reveal selected**.
10. SignalHire reveal is never automatic in the full-search workflow. The UI shows the selected count and asks for confirmation before any contact credits can be used.
11. Revealed rows can then run ATS / career-page intelligence and be reviewed before **Push + Tasks**.

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
- Meeting history is a hard block for the full-run queue; connected-call-only accounts stay eligible.
- SignalHire reveal requires explicit user selection and confirmation.
- SignalHire Lead List imports still require a real candidate/profile identity URL and parser v2; resume/history rows are rejected at browser and server layers.

## Detection note

This is not an anti-detection tool. Websites can observe normal page loads and navigation associated with the user's session. The companion deliberately uses ordinary visible Sales Navigator pagination and avoids stealth or anti-bot evasion techniques.


## v1.6.0: work the current 25 without opening the dashboard

1. Reload the unpacked extension to install v1.6.0. In Companion setup, enable profile actions / rotate token once, then save the new token in the extension. Previous capture tokens deliberately cannot reveal or push via the new controls.
2. Stay on the Sales Navigator People Search page and open the extension.
3. Click **Load current page · up to 25**. This reads the cards only and uses no contact credits.
4. Select the people to review and click **Read profiles + HubSpot Check**. Chrome asks for optional LinkedIn host access on the first click. This allows the companion to open ordinary temporary Sales Navigator profile tabs, read the current role and **View LinkedIn profile** link, then close them. The search tab stays in place. No cookie access or hidden profile API is used.
5. Existing HubSpot people, Retention companies, meaningful meetings, incomplete communication checks and mismatched provider identities are blocked. The current queue policy continues to allow connected calls without a meeting.
6. Select eligible people and click **Reveal selected**. Confirm credit use. The server reuses the reveal ledger; it does not accept arbitrary client-supplied phone data for push.
7. Choose **Marita or Daniel**, the date and the local time. Select the ready people and click **Push + CALL tasks**. Confirm the exact owner/time. The server rechecks eligibility and rereads the written task, its owner/time and contact association before reporting success.
8. Progress is kept in local extension storage when the popup closes. Reopen to review. **Stop after current lead** cancels remaining work; it does not reverse completed operations.

Search captures now read `data-anonymize="title"`; `job-title` contains tenure on current search cards. Plain `/in/` URLs are absent from these cards, so they are completed during the explicit profile-reading step rather than invented or inferred.

The page queue is limited to the loaded page. Full-search capture remains available separately and uses the persistent dashboard queue.

Rebuild the versioned download after extension changes with `python3 scripts/package-companion.py` from the repository root.

## v1.6.2: dashboard visual system

The popup now shares the SDR dashboard green palette, compact table hierarchy, semantic status badges, four live queue counters and a dedicated dispatch panel. Full capture, list sync and pairing settings use progressive disclosure. Existing permissions, confirmation prompts and server safety gates are unchanged. The hosted design preview uses explicitly labeled sample data and cannot perform CRM or enrichment actions.

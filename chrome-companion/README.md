# Talentera Prospecting Chrome Companion

This is the Talentera SDR Chrome companion for user-triggered prospecting workflows. It keeps LinkedIn and SignalHire sessions inside the user's normal Chrome profile. It does **not** request Chrome cookie access, does not read LinkedIn auth cookies, and does not use stealth, CAPTCHA bypass, proxy rotation or fingerprint spoofing.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. Confirm the extension shows version **1.5.7** or newer.
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
3. The companion reads the current result page, counts 1st-degree connections for later exclusion, saves that page to the SDR server, then clicks **Next** and repeats.
4. Every page is persisted before the companion moves forward. The server globally deduplicates the run by stable Sales Nav entity ID or public LinkedIn slug. Weak name/company hints can be captured but cannot reveal or push.
5. Full capture stops at whichever happens first: no Next page, 100 pages, or 2,500 unique leads.
6. If the popup closes or the browser interrupts the run, progress is also kept in `chrome.storage.local`. Reopen the extension on the same search and press **Resume full search**.
7. Click **Open full-run queue** to review the saved run in the dashboard.
8. In the queue, run **HubSpot precheck** first. An existing person, Retention account/deal, meaningful meeting or any connected call across all company contacts blocks the lead. Partial HubSpot reads require review.
9. Existing HubSpot contacts are blocked in this net-new queue. Eligible cached reveals are reused with **0 new credits**.
10. SignalHire reveal is never automatic in the full-search workflow. The UI shows the selected count and asks for confirmation before any contact credits can be used.
11. Revealed rows must pass a fresh HubSpot check and have a usable phone before **Push + Tasks**. ATS evidence is reviewed separately; missing evidence requires manual routing.

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
- 1st-degree Sales Navigator connections are captured and counted, then excluded before reveal or push.
- Full capture itself spends **zero SignalHire contact credits**.
- HubSpot is checked before any manual SignalHire reveal in the full-run queue.
- Meeting history and every connected call are hard blocks for the net-new full-run queue. All company contacts and associated Retention deals are checked.
- SignalHire reveal requires explicit user selection and confirmation.
- SignalHire Lead List imports still require a real candidate/profile identity URL and parser v2; resume/history rows are rejected at browser and server layers.

## Detection note

This is not an anti-detection tool. Websites can observe normal page loads and navigation associated with the user's session. The companion deliberately uses ordinary visible Sales Navigator pagination and avoids stealth or anti-bot evasion techniques.

## Version 1.5.6 dispatch and pagination

- Start a new full-search capture on page 1. Resume is permitted on the saved search.
- Next must be a single visible identifiable pagination button. Disabled Next ends the run. Missing/ambiguous Next pauses with saved progress rather than claiming completion.
- Changed search filters and stalled navigation pause the run. No CAPTCHA bypass or automatic paid enrichment is performed.
- Queue dispatch can select Marita, Daniel, or Auto. Auto uses server-verified company ATS status: detected ATS → Daniel; confirmed no ATS → Marita; unknown → manual review. Existing ownership conflicts block reassignment.
- Push requires SDR admin access, rechecks the full company graph without the preview cache, requires a usable phone, and reads back task owner/date/type before marking success.
- LinkedIn prohibits third-party extensions that scrape or automate its site. Running this companion may restrict the account. Official CRM Sync requires Sales Navigator Advanced Plus.
- Selectors are tested against fixtures; actual Sales Navigator UI and a live end-to-end capture must be verified in the user's Chrome before rollout.


## Version 1.5.7 capture integrity

First-degree people are captured and counted, then excluded before reveal. Lead IDs ignore tracking parameters and preserve opaque Sales Navigator IDs. Capture pauses when a non-final page yields fewer than 25 distinct cards, when the observed page skips an expected page, or when pagination is uncertain. Repeated Start/Resume cannot run alongside a processing continuation.

The Ready queue restores saved reveal/push results from Postgres. Task date/time is a lower bound: the existing SDR capacity and workday scheduler chooses the actual date. Unknown provider/CRM request outcomes require reconciliation before another request. No automatic paid reveal or automatic CRM push is added.

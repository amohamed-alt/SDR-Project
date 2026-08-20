# Talentera Sales Nav Chrome Companion

This extension keeps LinkedIn authentication inside the user's normal Chrome session. It does **not** request Chrome cookie access, does not read `li_at` / `JSESSIONID`, and does not run background crawling.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. In the SDR Dashboard, open **Sales Nav → Net New → Companion setup**.
6. Unlock admin settings and click **Generate / rotate token**.
7. Paste that token into the extension and click **Test connection**.

## Use

1. Open a LinkedIn Sales Navigator **People Search** page in the same Chrome profile where you are already logged in.
2. Click the Talentera Sales Nav Companion icon.
3. Choose **Extract current page** or **Extract up to 50 · 2 pages**.
4. The extension sends only extracted lead fields to the SDR Dashboard. The dashboard then runs SignalHire, HubSpot dedupe, ATS and hiring intelligence.

## Safety design

- No `cookies` permission.
- No LinkedIn password/token storage on the VPS.
- `activeTab` means the extension can read a page only after the user clicks the extension.
- Only the Talentera SDR dashboard is allow-listed as a remote host.
- Pairing token is stored locally in Chrome; the server stores only its SHA-256 hash.
- Each run is user-triggered and capped at 50 leads / two pages.
- 1st-degree connections are removed before import.

# Talentera Sales Nav Chrome Companion

This extension keeps LinkedIn authentication inside the user's normal Chrome session. It does **not** request Chrome cookie access, does not read `li_at` / `JSESSIONID`, and does not run background crawling.

## Install

1. Download this `chrome-companion` folder.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the `chrome-companion` folder.
5. Confirm the extension shows version **1.2.0** or newer.
6. In the SDR Dashboard, open **Sales Nav → Net New → Companion setup**.
7. Unlock admin settings and click **Generate / rotate token**.
8. Paste that token into the extension and click **Test connection**.

## Use

1. Open a LinkedIn Sales Navigator **People Search** page in the same Chrome profile where you are already logged in.
2. Click the Talentera Sales Nav Companion icon.
3. Choose **Extract current page** or **Extract up to 50 · 2 pages**.
4. The extension reads the visible Sales Navigator result cards and sends only extracted lead fields to the SDR Dashboard.
5. If a public `linkedin.com/in/...` URL is already visible in the card, it is included. If not, the dashboard uses SignalHire search to resolve the person and LinkedIn profile without issuing hidden LinkedIn profile-page requests.
6. The dashboard then runs SignalHire, HubSpot dedupe, ATS and hiring intelligence.

## Safety design

- No `cookies` permission.
- No LinkedIn password/token storage on the VPS.
- No hidden fetch loop to Sales Navigator profile pages.
- `activeTab` means the extension can read a page only after the user clicks the extension.
- Only the Talentera SDR dashboard is allow-listed as a remote host.
- Pairing token is stored locally in Chrome; the server stores only its SHA-256 hash.
- Each run is user-triggered and capped at 50 leads / two pages.
- 1st-degree connections are removed before import.
- Old extension versions are rejected by the server so stale parsers cannot silently import bad company/profile data.

## Detection note

This is not an anti-detection tool. LinkedIn can observe normal page loads and navigation associated with the user's session. The companion deliberately avoids stealth, fingerprint spoofing, CAPTCHA bypass, proxy rotation, or human-behavior emulation.

# Smartlead Outreach Command Center

## Purpose

Smartlead is the email execution layer for Marita's SDR portfolio. The SDR dashboard remains the control plane: it decides who is eligible, protects Sales-owned conversations, prepares localized Talentera copy through the existing OpenRouter gateway, and shows execution coverage before anything is queued.

The Smartlead API key is server-only. It is supplied by the GitHub Actions secret `SMARTLEAD_API_KEY`, passed to the Hostinger deployment, and never returned to the browser.

## Hard safety boundaries

1. The source queue must resolve to Marita (`ownerId=31644369`).
2. Existing Marita Priority exclusions remain in force: Retention, open deals, Closed Won, proposal-shared stages, and companies with a Connected call do not enter the email queue.
3. A recent Sales email, meeting, or communication from a configured Sales owner protects the entire company for the configured lookback window (45 days by default).
4. If any Sales activity safety scan fails, preparation and launch fail closed.
5. Unsafe email statuses, invalid addresses, duplicates, and leads already in the Talentera Smartlead campaign are blocked.
6. Smartlead global block, unsubscribe, community-bounce and cross-campaign duplicate protections are never bypassed.
7. The server repeats the complete eligibility and Sales-safety check immediately before uploading a prepared batch.
8. Creating or refreshing the campaign never starts it automatically. Starting/resuming is a separate confirmed Owner action and requires at least one attached sender.

## Localization and segmentation

The copy engine routes each lead by:

- country / locale
- industry bucket
- persona
- ATS context

Saudi Arabia uses warm professional Saudi business Arabic (`ar-SA`). Other GCC markets use neutral Gulf Arabic (`ar-GCC`). Markets outside that Arabic routing use concise English.

Industry buckets include healthcare, retail, logistics, financial services, education, hospitality, construction/real estate, technology, and a safe generic fallback.

OpenRouter generates one reusable template per segment for a prepared batch. The output is sanitized and rendered with controlled fields. If AI output is unavailable or malformed, deterministic fallback copy is used instead of blocking the queue or emitting unsafe content.

## Three-touch campaign

The bootstrap action creates or refreshes:

`Talentera | Marita SDR | Localized 3-Touch`

Policy:

- plain-text sending
- open tracking disabled
- click tracking disabled
- stop on reply
- Riyadh timezone
- Sunday through Thursday schedule
- default sending window 09:30–16:30
- default minimum 5 minutes between emails
- default 75 new leads per day
- Touch 1: day 0
- Touch 2: +3 days
- Touch 3: +4 days after Touch 2

The Smartlead sequence uses per-lead custom fields for the subject and body of all three touches, which lets a single campaign remain operationally simple while copy changes by country, industry, persona and ATS context.

## Dashboard metrics

The Smartlead Outreach view reports:

- Ready: currently safe Marita email contacts
- Today: planned new leads under the configured daily cap
- Tomorrow: next day's remaining new leads
- Next 48h: combined new-lead coverage
- Coverage: number of days the current Ready queue can sustain the configured daily cap
- Prepared: leads staged locally but not yet uploaded to Smartlead
- Sender accounts and assignment state
- campaign status
- sent / replies / bounces / unsubscribes when Smartlead analytics are available
- blocked-by-Sales and other queue exclusion reasons

## Operator workflow

1. Open **SDR Tools → Smartlead Outreach**.
2. Enter the existing Owner key for the browser session.
3. Click **Create campaign** (or **Refresh campaign**) to ensure the safe three-touch structure exists. This does not start the campaign.
4. Select the warmed Talentera sender accounts and click **Attach selected**.
5. Review Ready / Today / Tomorrow / Coverage and blocked records.
6. Click **Prepare today** to generate localized copy. No email is sent at this step.
7. Review the copy samples.
8. Click **Queue prepared batch**. The server repeats all CRM and Sales checks before uploading the surviving leads.
9. Use **Start / resume** only when the campaign should actually execute. Use **Pause** at any time to stop future scheduled sends.

## Production environment

Required GitHub Actions secrets:

- `SMARTLEAD_API_KEY`
- `OPENROUTER_API_KEY`
- `ACQUISITION_OWNER_TOKEN`
- existing HubSpot / Hostinger / SignalHire secrets used by the SDR application

Relevant optional environment controls:

- `SMARTLEAD_CAMPAIGN_ID`
- `SMARTLEAD_CAMPAIGN_NAME`
- `SMARTLEAD_DAILY_NEW_LEADS`
- `SMARTLEAD_SALES_ACTIVITY_LOOKBACK_DAYS`
- `SMARTLEAD_START_HOUR`
- `SMARTLEAD_END_HOUR`
- `SMARTLEAD_MIN_TIME_BETWEEN_EMAILS`
- `SMARTLEAD_PREPARED_PATH`

The deployment workflow validates the Smartlead API key directly before deploying, passes the secret into the Hostinger runtime, then checks `/api/smartlead` in production to verify the application can see the configuration. A temporarily unhealthy Sales safety scan is surfaced as a warning and keeps outreach locked rather than bypassing the protection.

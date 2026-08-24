# Smartlead campaign safety runbook

Keep `SMARTLEAD_AUTOPILOT_ENABLED=false` until every enforced launch gate below passes. The verified `orchestrator-v3` route is the only approved send path; legacy launch routes stay disabled. Primeforge is a read-only advisory in this project for now: it cannot block deployment or sending, buy domains, create mailboxes, change DNS, export credentials, renew, or delete infrastructure.

## Approved sender inventory

- Exactly 15 eligible inboxes: three on each approved sending domain.
- Talentera: `jointalentera.com`, `usetalentera.com`, `talenteramena.com`.
- Evalufy: `getevalufy.com`, `evalufyhq.com`.
- Never attach the core `talentera.com` domain or any unlisted domain.
- Every inbox must report healthy SMTP and IMAP, warmup enabled with an active/ready state or reputation at least 90, and an explicit daily limit.
- Campaign-email capacity is capped at 20 per inbox. The global new-lead cap is 50 per business day, split 15/15 across Talentera Arabic/English and 10/10 across Evalufy Arabic/English.
- `15 inboxes x 20` means 300 total campaign emails, not 300 new recipients. New touches and follow-ups share that capacity. At a steady 50 new recipients, the three-touch sequence can produce up to about 150 scheduled campaign emails on a collision day; the remaining capacity is deliberate safety headroom.

## DNS and credentials

- Confirm SPF, DKIM, DMARC, and MX for each of the five sending domains. DMARC reports must go to a monitored mailbox.
- Keep the primary company domain isolated from cold outreach.
- Rotate the Smartlead and Primeforge API keys that were embedded in the earlier mailbox-provisioning workflow before launch.
- Remove inline keys from workflow JSON and use the platform credential store or runtime secrets. Never paste keys into nodes, logs, repository files, or campaign custom fields.

## Verification and audience gates

- MillionVerifier `valid` is the only accepted result.
- `catch_all`, `unknown`, `invalid`, and `disposable` never enter Smartlead.
- A SignalHire replacement is accepted only when it is a work email, matches the current employer, and independently passes MillionVerifier.
- Persistent verification history is display/audit data only. Every daily send run bypasses old HubSpot and local statuses and makes a fresh MillionVerifier request for each unique email it considers. Only duplicate use of the same email inside that one run may reuse the newly returned result.
- Global blocklist, unsubscribe list, community bounce list, cross-campaign duplicate checks, HubSpot Sales activity, and the local send ledger all remain enforced.
- Verification runs independently per language/product lane. Final selection re-enforces 15/15/10/10, so a language-skewed queue cannot overflow one campaign and create an accidental next-day backlog.

## Recipient routing

- No verified ATS detected: route to Talentera. A detected standard or custom ATS: route to Evalufy as the assessment layer without replacing the current system.
- Product is selected first, then deterministic recipient-language routing selects the exact Arabic or English campaign.
- High-confidence Arabic names written in Latin are normalized for the Arabic greeting. Safely recognized split compound names such as `Abd` + `Alrahman` become `عبدالرحمن`; ambiguous or foreign names stay English.
- Arabic and English sequence copy is isolated. An optional AI opening line is discarded if its script does not match the selected campaign.
- Use the workflow's manual `dry-run` mode for a read-only 50-recipient routing audit. Actions logs expose aggregate lane counts only; the authenticated endpoint keeps masked row-level details private. Every post-deploy `setup` automatically runs the same aggregate audit. It performs no campaign writes and sends nothing.

## Campaign configuration

- Three plain-text touches: Day 1, Day 5, and about Day 11.
- Open and click tracking off; no links or images.
- Stop on reply, auto-pause same-domain leads on reply, add unsubscribe tags, respect mailbox sending limits, and keep domain-level rate limiting on.
- Send Sunday-Thursday, 09:30-16:30 Asia/Riyadh, with at least 15 minutes between emails.
- Smartlead high-bounce auto-protection is 2%. The orchestrator also blocks at 2% bounce after 50 sends and pauses all managed campaigns on the first recorded spam complaint.
- Four campaigns are the visible managed topology: Talentera Arabic, Talentera English, Evalufy Arabic, and Evalufy English. Any other Talentera/Evalufy `Marita SDR` campaign is legacy, is reported in setup, and is paused when empty; active legacy leads block the new autopilot to prevent duplicate sends.

## Golden Hours

- GitHub Actions makes idempotent attempts at 08:45, 09:05, and 09:25 Riyadh time, Sunday-Thursday.
- These are retries for one daily batch, not three batches. A successful date lock prevents the same 50 from being processed twice.
- Smartlead controls the actual 09:30-16:30 Riyadh sending window and applies the 15-minute minimum gap plus ESP matching.

## Launch order

1. Rotate exposed keys and move every secret to managed credentials.
2. Verify DNS and warmup history for all five domains and all 15 inboxes.
3. Run the workflow in `dry-run` mode and review all 50 masked product/language/campaign decisions.
4. Run the workflow in `setup` mode. It must pass sender inventory, sender reconciliation, four-campaign parity, and legacy-campaign safety with zero blocking warnings.
5. Confirm MillionVerifier has credits and SignalHire is configured.
6. Review all four sequence variants.
7. Set the repository variable `SMARTLEAD_AUTOPILOT_ENABLED=true` and deploy.
8. Watch the first 50 new recipients manually. Pause immediately on any spam complaint, unusual provider block, bounce spike, or reply-stop failure.

Primeforge health is reported as an advisory only. Every setup and daily run still independently enforces the Smartlead inventory: exactly three eligible inboxes on each approved domain (15 total), healthy SMTP/IMAP, active warmup, sending limits, sender-to-brand routing, campaign parity, HubSpot Sales activity, MillionVerifier validity, bounce rate, and spam complaints.

To stop sending, set `SMARTLEAD_AUTOPILOT_ENABLED=false`, redeploy, and pause all four managed campaigns in Smartlead. Do not delete inboxes while active leads still depend on them.

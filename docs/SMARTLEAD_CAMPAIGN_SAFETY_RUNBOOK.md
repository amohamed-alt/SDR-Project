# Smartlead campaign safety runbook

Keep `SMARTLEAD_AUTOPILOT_ENABLED=false` until every launch gate below passes. The verified `orchestrator-v3` route is the only approved send path; legacy launch routes stay disabled.

## Approved sender inventory

- Exactly 15 eligible inboxes: three on each approved sending domain.
- Talentera: `jointalentera.com`, `usetalentera.com`, `talenteramena.com`.
- Evalufy: `getevalufy.com`, `evalufyhq.com`.
- Never attach the core `talentera.com` domain or any unlisted domain.
- Every inbox must report healthy SMTP and IMAP, warmup enabled with an active/ready state or reputation at least 90, and an explicit daily limit.
- Campaign-email capacity is capped at 20 per inbox. The global new-lead cap is 50 per business day, split 15/15 across Talentera Arabic/English and 10/10 across Evalufy Arabic/English.

## DNS and credentials

- Confirm SPF, DKIM, DMARC, and MX for each of the five sending domains. DMARC reports must go to a monitored mailbox.
- Keep the primary company domain isolated from cold outreach.
- Rotate the Smartlead and Primeforge API keys that were embedded in the earlier mailbox-provisioning workflow before launch.
- Remove inline keys from workflow JSON and use the platform credential store or runtime secrets. Never paste keys into nodes, logs, repository files, or campaign custom fields.

## Verification and audience gates

- MillionVerifier `valid` is the only accepted result.
- `catch_all`, `unknown`, `invalid`, and `disposable` never enter Smartlead.
- A SignalHire replacement is accepted only when it is a work email, matches the current employer, and independently passes MillionVerifier.
- Valid-verification cache expires after 14 days; catch-all and unknown results retry after 24 hours.
- Global blocklist, unsubscribe list, community bounce list, cross-campaign duplicate checks, HubSpot Sales activity, and the local send ledger all remain enforced.

## Campaign configuration

- Three plain-text touches: Day 1, Day 5, and about Day 11.
- Open and click tracking off; no links or images.
- Stop on reply, auto-pause same-domain leads on reply, add unsubscribe tags, respect mailbox sending limits, and keep domain-level rate limiting on.
- Send Sunday-Thursday, 09:30-16:30 Asia/Riyadh, with at least 15 minutes between emails.
- Smartlead high-bounce auto-protection is 2%. The orchestrator also blocks at 2% bounce after 50 sends or 0.3% spam complaints after 50 sends.

## Launch order

1. Rotate exposed keys and move every secret to managed credentials.
2. Verify DNS and warmup history for all five domains and all 15 inboxes.
3. Run the workflow in `setup` mode. It must pass sender inventory, sender reconciliation, and four-campaign parity with zero warnings.
4. Confirm MillionVerifier has credits and SignalHire is configured.
5. Review a small sample of recipients and all four sequence variants.
6. Set the repository variable `SMARTLEAD_AUTOPILOT_ENABLED=true` and deploy.
7. Watch the first 50 sends manually. Pause immediately on any spam complaint, unusual provider block, bounce spike, or reply-stop failure.

To stop sending, set `SMARTLEAD_AUTOPILOT_ENABLED=false`, redeploy, and pause all four managed campaigns in Smartlead. Do not delete inboxes while active leads still depend on them.

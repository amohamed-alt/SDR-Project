# Sales Navigator session setup

The Sales Nav extractor reads LinkedIn session values from the VPS runtime environment only. Never commit these values to GitHub.

Required:
- `LINKEDIN_LI_AT`

Optional:
- `LINKEDIN_JSESSIONID`

After updating `/root/SDR-Project/.env`, recreate the `sdr-dashboard` and `gtm-career-browser` services so Docker Compose injects the new values.

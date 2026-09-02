# SDR production cleanup — 2026-09-02

This change retires cancelled outreach integrations (SmartLead and PrimeForge), removes legacy one-off deployment/recovery artifacts, consolidates production onto one Docker Compose file, routes the dashboard exclusively through Traefik, caps Docker logs, and shortens the CI/deployment path.

Persistent database/application volumes are intentionally preserved.

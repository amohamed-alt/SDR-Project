#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/root/SDR-Project"
SOURCE_ENV="${1:-$REPO_DIR/.env}"
TARGET_ENV="${SDR_ENV_FILE:-/root/sdr-production.env}"
DATA_DIR="$REPO_DIR/data"
GOOGLE_STORE="$DATA_DIR/google-calendar.json"

cd "$REPO_DIR"

if [ -f "$TARGET_ENV" ]; then
  BACKUP="${TARGET_ENV}.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a "$TARGET_ENV" "$BACKUP"
  echo "Backed up persistent env to $BACKUP"
elif [ -f "$SOURCE_ENV" ]; then
  cp -a "$SOURCE_ENV" "$TARGET_ENV"
  echo "Migrated existing env from $SOURCE_ENV to $TARGET_ENV"
else
  echo "ERROR: neither $TARGET_ENV nor $SOURCE_ENV exists."
  echo "Create $TARGET_ENV once with the production secrets, then rerun this script."
  exit 1
fi

TARGET_ENV="$TARGET_ENV" GOOGLE_STORE="$GOOGLE_STORE" python3 - <<'PY'
import os
import re
import secrets
from pathlib import Path

env_path = Path(os.environ["TARGET_ENV"])
google_store = Path(os.environ["GOOGLE_STORE"])

fixed = {
    "HUBSPOT_PORTAL_ID": "145742477",
    "HUBSPOT_UI_DOMAIN": "app-eu1.hubspot.com",
    "HUBSPOT_TIMEZONE": "Asia/Riyadh",
    "DEFAULT_SDR_OWNER_ID": "31644369",
    "NEXT_PUBLIC_DEFAULT_START_DATE": "2026-07-01",
    "DISABLE_AUTH": "true",
    "DEMO_MODE": "false",
    "GOOGLE_REDIRECT_URI": "https://sdr.dashboardtalentera.tech/api/google/callback",
    "MARITA_GOOGLE_EMAIL": "m.chedid@talentera.com",
    "GOOGLE_TOKEN_STORE_PATH": "/app/data/google-calendar.json",
}

remove = {
    "DASHBOARD_USERNAME",
    "DASHBOARD_PASSWORD",
    "SDR_BUILD_REF",
}

lines = env_path.read_text(encoding="utf-8").splitlines()
values = {}
order = []
extras = []

for line in lines:
    m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
    if not m:
        extras.append(line)
        continue
    key, raw = m.group(1), m.group(2)
    if key in remove:
        continue
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        value = value[1:-1]
    if key not in values:
        order.append(key)
    values[key] = value

values.update(fixed)
for key in fixed:
    if key not in order:
        order.append(key)

if not values.get("GOOGLE_TOKEN_ENCRYPTION_KEY"):
    if google_store.exists() and google_store.stat().st_size > 2:
        raise SystemExit(
            "GOOGLE_TOKEN_ENCRYPTION_KEY is missing while an existing Google token store is present. "
            "Restore the previous encryption key before continuing so Calendar access is not lost."
        )
    values["GOOGLE_TOKEN_ENCRYPTION_KEY"] = secrets.token_hex(32)
    order.append("GOOGLE_TOKEN_ENCRYPTION_KEY")

required = [
    "HUBSPOT_PRIVATE_APP_TOKEN",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
]
missing = [key for key in required if not values.get(key)]
if missing:
    raise SystemExit(
        "Missing required production values in persistent env: " + ", ".join(missing)
    )

def quote(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"

result = []
seen = set()
for key in order:
    if key in seen or key in remove or key not in values:
        continue
    result.append(f"{key}={quote(values[key])}")
    seen.add(key)

# Preserve comments/blank lines only when they do not duplicate key assignments.
for line in extras:
    if line.strip() == "" or line.lstrip().startswith("#"):
        result.append(line)

env_path.write_text("\n".join(result).rstrip() + "\n", encoding="utf-8")
print(f"Persistent production environment ready: {env_path}")
PY

chmod 600 "$TARGET_ENV"
mkdir -p "$DATA_DIR"
chown -R 1001:1001 "$DATA_DIR"
chmod 700 "$DATA_DIR"

export SDR_ENV_FILE="$TARGET_ENV"
docker compose config >/dev/null
docker compose up -d --force-recreate

sleep 20

echo
echo "=== CONTAINER STATUS ==="
docker compose ps

echo
echo "=== NON-SECRET CONFIG CHECK ==="
docker compose exec -T sdr-dashboard node - <<'NODE'
const checks = [
  ["HUBSPOT_PRIVATE_APP_TOKEN", true],
  ["GOOGLE_CLIENT_ID", true],
  ["GOOGLE_CLIENT_SECRET", true],
  ["GOOGLE_TOKEN_ENCRYPTION_KEY", true],
  ["GOOGLE_REDIRECT_URI", false],
  ["MARITA_GOOGLE_EMAIL", false],
  ["DISABLE_AUTH", false],
  ["DEMO_MODE", false],
];

for (const [key, secret] of checks) {
  const value = process.env[key] ?? "";
  console.log(secret
    ? `${key}: ${value ? `SET (${value.length} characters)` : "MISSING"}`
    : `${key}: ${value || "MISSING"}`);
}
NODE

echo
echo "=== PUBLIC HEALTH ==="
curl -k -sS https://sdr.dashboardtalentera.tech/api/health
echo

echo "One-time migration complete. Future deployments use $TARGET_ENV automatically."

#!/usr/bin/env python3
"""Rename your CSV's columns to the ones the enrichment engine reads.

The engine hard-codes Apollo's stock headers. Any reshaped or re-exported CSV
matches none of them, and the run writes an EMPTY file with no error at all.
Run this first. Edit MAPPING to match your own column names.

    python3 adapter.py input.csv output.csv            # everything usable
    python3 adapter.py input.csv sample.csv 10         # first 10 rows
    python3 adapter.py input.csv strict.csv 0 --strict # drop unverified emails
"""
import csv, io, sys, re

# ─── EDIT THIS ────────────────────────────────────────────────────
# left  = the column name the engine needs (do not change these)
# right = the column name in YOUR csv
MAPPING = {
    "Email":               "Email",                 # REQUIRED
    "First Name":          "First Name",
    "Last Name":           "Last Name",
    "Title":               "Title",
    "Company Name":        "Company Name",
    "Website":             "Website",               # REQUIRED for research
    "City":                "City",
    "State":               "State",
    "Person Linkedin Url": "Person Linkedin Url",
    "Keywords":            "Industry",
    "# Employees":         "# Employees",
}
STATUS_COLUMN = "Email Status"   # your verification column, "" if none
# Values that mean "safe to send". Lowercase substrings.
GOOD = ["verified", "ok", "valid"]
BAD  = ["personal", "not independently verified", "not found",
        "extrapolated", "likely", "catch", "unknown", "invalid"]
# ──────────────────────────────────────────────────────────────────

SRC, DST = sys.argv[1], sys.argv[2]
LIMIT  = int(sys.argv[3]) if len(sys.argv) > 3 else 0
STRICT = "--strict" in sys.argv
OUT = list(MAPPING) + ["result"]

def g(r, c): return (r.get(c) or "").strip() if c else ""

def sendable(s):
    s = s.lower()
    if not s: return False
    if any(b in s for b in BAD): return False
    return any(x in s for x in GOOD)

rows = list(csv.DictReader(io.open(SRC, encoding="utf-8-sig")))
if not rows: sys.exit("empty csv")

missing = [v for v in MAPPING.values() if v and v not in rows[0]]
if missing:
    print("!! these columns are not in your csv - fix MAPPING:")
    for m in missing: print("   ", m)
    print("\nyour actual columns:")
    for c in rows[0]: print("   ", c)
    sys.exit(1)

kept, drop = [], {"no_email":0, "no_name":0, "no_site":0, "masked":0, "unverified":0}
for r in rows:
    email = g(r, MAPPING["Email"])
    if "@" not in email: drop["no_email"] += 1; continue
    if not g(r, MAPPING["First Name"]): drop["no_name"] += 1; continue
    site = g(r, MAPPING["Website"])
    if not site: drop["no_site"] += 1; continue
    # providers mask unrevealed contacts as "Ahmed Al***r" - never mail these
    if re.search(r"\*\*", g(r, MAPPING["First Name"]) + g(r, MAPPING["Last Name"])):
        drop["masked"] += 1; continue
    if STRICT and STATUS_COLUMN and not sendable(g(r, STATUS_COLUMN)):
        drop["unverified"] += 1; continue
    if not site.startswith("http"): site = "https://" + site
    out = {k: g(r, v) for k, v in MAPPING.items()}
    out["Website"] = site
    out["result"] = "ok"        # the engine's allowlist wants this literal value
    kept.append(out)

if LIMIT: kept = kept[:LIMIT]
with io.open(DST, "w", newline="", encoding="utf-8-sig") as f:
    w = csv.DictWriter(f, fieldnames=OUT); w.writeheader(); w.writerows(kept)

print(f"in  {len(rows)}")
for k, v in drop.items(): print(f"  dropped {k:12s} {v}")
print(f"out {len(kept)}  ->  {DST}")
print(f"\nThis is the number to price against - NOT the size of your export.")
---
name: enrichment-engine
description: >
  Bulk cold-email personalisation. Takes a verified contact CSV, pulls live
  company data with Firecrawl, and uses Claude to write per-contact subject
  lines and opening lines from your prompt. Writes in the language of the ICP
  being targeted. Use for "personalise 500 contacts", "write first lines at
  scale", "bulk cold email copy", "Clay alternative". Do NOT use for writing a
  single email or choosing an angle — that is proximity.
license: none — see Licence gate below
compatibility: "Requires Python 3.9+ and git. Anthropic API key required. Firecrawl key optional but recommended."
metadata:
  author: touseef028
  repository: "https://github.com/touseef028/enrichment"
  vendored: false
allowed-tools: Bash(python3:*) Bash(git:*) Bash(sed:*) Read Write WebFetch
---

# Enrichment Engine

Turn a verified contact list into per-contact cold-email copy. Firecrawl does the
research because it is cheap at gathering. Claude does the writing because it is
good at writing. Splitting them cuts roughly 60% of the cost versus letting Claude
research as well.

Resolve the directory containing this file as `SKILL_DIR`. The upstream tool is
NOT vendored here — step 1 clones it.

## Guardrails

- **Never vendor, commit, or redistribute the upstream source.** Clone it at run
  time and leave it outside this repo.
- Never print or log API keys. The upstream UI takes them per run and stores
  nothing; keep it that way.
- Never run the full list before a 20-row sample has passed audit. A bad prompt
  repeated 2,000 times costs credits and domain reputation.
- State the real post-filter row count before quoting any cost. The engine drops
  every row that is not verified `ok`, so the headline list size is never the
  number you pay for.
- Do not expose the tool to the network. It is a single-user local tool.

## Step 0 — Licence gate

Run this once per session, before anything else:

```bash
curl -s https://api.github.com/repos/touseef028/enrichment --jq '.license' 2>/dev/null \
  || curl -s https://api.github.com/repos/touseef028/enrichment | grep -o '"license":[^,]*'
```

The upstream repo has **no LICENSE file**. Under default copyright that means all
rights reserved: public visibility grants the right to view and fork within
GitHub, not to use, modify, or redistribute — including commercially.

- If the licence is still `null` **and** this run is for client or revenue work,
  say so plainly in one sentence and ask the user to confirm they want to
  proceed. Do not refuse, and do not repeat the warning later in the run.
- If a LICENSE has since appeared, note which one and move on.
- Offer once to draft a short note asking the author to add a licence.

This is a factual flag, not legal advice. Say that once if it comes up.

## Step 1 — Get the tool

```bash
git clone https://github.com/touseef028/enrichment.git ~/.cache/enrichment-engine 2>/dev/null \
  || git -C ~/.cache/enrichment-engine pull --ff-only
```

Then apply the fixes in [`references/patches.md`](references/patches.md). The
UTF-8 BOM patch is **not optional** for any non-ASCII language — without it the
output CSV opens as mojibake in Excel and the run looks broken when it is not.

## Step 2 — Get the prompt

The engine has no prompt of its own. The prompt IS the product; everything else
is plumbing.

**If the user has no prompt ready, do not write one from scratch.** Run
`/proximity` first — it holds the 14-principle ruleset and an auditor, and its
output is the raw material for this prompt. Then convert that output using
[`references/prompt-template.md`](references/prompt-template.md).

Two hard rules for the finished prompt:

1. It must instruct Claude to return **only a JSON object**.
2. The JSON keys become the output CSV columns. Changing the fields means
   changing that JSON — never the code.

## Step 3 — Set the language from the ICP

Ask which ICP this list targets, then read
[`references/language-routing.md`](references/language-routing.md) and apply it.

Language follows the audience, not the tool: an Arabic-speaking ICP gets Arabic
copy, an English-speaking ICP stays English, and a mixed list routes per contact.
Do not default to English silently — for a Gulf or MENA list that is a wrong
answer delivered confidently.

## Step 4 — Filter and count

Run the list through MillionVerifier first if it has not been. The engine keeps
only rows whose result column equals `ok`.

Report before spending anything:

- rows in, rows surviving the filter, percentage dropped
- Firecrawl credits needed at the current settings
- estimated Claude cost

Use [`references/cost-and-limits.md`](references/cost-and-limits.md) for the
arithmetic and the free-tier ceiling.

## Step 5 — Sample run

Run 20 rows. Never more on the first pass.

```bash
cd ~/.cache/enrichment-engine && ./start.sh
```

Open http://localhost:5050, paste the keys and the prompt, upload the sample.

## Step 6 — Audit the sample

Pass the 20 rows through the auditor in `/proximity`. This is the quality gate
the engine itself does not have.

- Passed → continue to step 7.
- Failed → revise the prompt against the specific feedback, re-run the same 20.
  Do not widen the sample to escape a failing audit.

Check by hand, on the sample, before the audit:

- Does the opening line use a detail that only appears in `{research}`? If it
  could have been written from the CSV alone, the research is not landing.
- Did any row come back with empty research? A thin or JS-only site returns
  nothing and the line degrades to generic. Count these.
- In the target language, does it read as written by a person from that market?

## Step 7 — Full run

Only after a pass. Checkpointing is automatic — if it crashes or is stopped,
re-running resumes from the last checkpoint rather than starting over.

Report on completion: rows written, rows with empty research, actual spend, and
the output path.

## Reference files

| File | Use it for |
|---|---|
| [`references/prompt-template.md`](references/prompt-template.md) | Turning a proximity output into a working prompt |
| [`references/language-routing.md`](references/language-routing.md) | Matching copy language to the ICP |
| [`references/patches.md`](references/patches.md) | The BOM fix and the language patch |
| [`references/cost-and-limits.md`](references/cost-and-limits.md) | Credits, rate limits, tier choice |

## Related

- `08-messaging/01-angle-selection/proximity` — decides the angle and writes the
  reference copy. **Run first.**
- `04-enrichment/04-verification` — produces the verified list this consumes.
- `03-data-sources/03-maps-scraping/google-maps-scraper` — same
  clone-do-not-vendor pattern, for a tool that does carry a licence.
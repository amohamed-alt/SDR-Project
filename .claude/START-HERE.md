# Cold email at scale — what to do, in order

Three skills and two templates. They turn a contact list into personalised cold
email copy — a subject line and a full email body per contact, or a whole
4-email sequence.

Read this once before touching anything. Most of what goes wrong here fails
*silently* — the tool finishes, the file looks full, and the copy is generic.

---

## Step 1 — Install (5 minutes)

Copy the three folders in `skills/` into either:

```
~/.claude/skills/                    # available in every project
<your-project>/.claude/skills/       # this project only
```

Restart Claude Code. Check they loaded by typing `/` and looking for
`proximity`, `enrichment-engine` and `humanizer`.

## Step 2 — Get the accounts (do this before anything else)

| Service | What it does | Cost |
|---|---|---|
| firecrawl.dev | Reads each company's website so the copy can be specific | Hobby $16/mo ≈ 1,600 contacts |
| console.anthropic.com | Writes the copy | ~$5 per 1,000 contacts |
| MillionVerifier or similar | Verifies emails before you send | pay as you go |

**The thing that traps everyone: a Claude Pro or Max subscription is NOT an API
key.** Console billing is completely separate. Your key must start `sk-ant-`.
If you would rather use OpenRouter, patch 8 in
`skills/enrichment-engine/references/patches.md` makes that work.

## Step 3 — Run `/proximity` on your own website

Type `/proximity`. It asks for your website URL, reads it, and shows you a
positioning snapshot. Correct anything wrong — it saves what you confirm.

**Do not skip this and write the prompt yourself.** Proximity produces three
things the next step needs and cannot invent:

1. the angle — what the copy opens from
2. the banned-opener list — the specific phrases that flatten cold email
3. the spam-word list for your niche

## Step 4 — Prepare your list

**Check the column names first.** The engine hard-codes Apollo's stock headers.
If your CSV uses anything else, it silently drops every row and writes an empty
file with no error.

Open `templates/adapter.py`, edit the `MAPPING` block to match your column
names, then:

```bash
python3 templates/adapter.py your-list.csv ready.csv 0 --strict
```

It prints how many rows survive. **That number is what you price against, not
the size of your export.** A 2,000-row export routinely becomes 900 after
dropping rows with no email, no website, or a provider-masked name like
`Ahmed Al***r`.

## Step 5 — Build the prompt

For a single email, the skill's own
`references/prompt-template.md` is enough.

For a full 4-email sequence, start from
`templates/prompt-4-email-sequence.txt` and fill in every `[BRACKETED]` part
from your proximity run.

The JSON keys at the bottom become your spreadsheet columns. Name them once and
do not change them mid-campaign, or you end up merging two files with different
shapes.

## Step 6 — Apply the patches

`skills/enrichment-engine/references/patches.md`. Two are not optional:

- **Patch 6** — the tool ships listening on `0.0.0.0`, so the page where you
  type your API keys is reachable by everything on your network.
- **Patch 7** — adds `research_chars` to the output. Without it you cannot tell
  a good run from one where the research never happened.

Add patch 1 if you are writing in any non-English language, or the output CSV
opens as mojibake in Excel and looks broken when the data is fine.

## Step 7 — Run 10 rows. Only 10.

Never run the full list first. A bad prompt repeated 2,000 times costs credits
and your domain reputation.

**Two things tell you instantly whether it worked:**

- **The clock.** About 3 seconds per contact means the research step never ran.
  A real run is 20-30 seconds per contact.
- **The `research_chars` column.** Zero on every row means the same thing. No
  amount of prompt tuning fixes it — go back and check the Firecrawl key.

## Step 8 — Audit the 10 by hand

Ask one question of each opening line:

> Could this have been written from the spreadsheet alone?

If yes, the research is not landing. That is a research problem or a prompt
problem, never something to fix by sending anyway.

Also count how many rows came back with empty research. Thin sites, JavaScript-
only sites and broken SSL all return nothing, and those rows quietly degrade to
generic copy. Knowing the number before you send is the point.

Run the copy back through `/proximity` — it has an auditor that checks spam
triggers and how close the copy sits to what the reader actually wants.

If it fails, fix the prompt and **re-run the same 10**. Do not widen the sample
to escape a bad result.

## Step 9 — Only now, the full list

Checkpointing is automatic, so if it crashes you re-run and it resumes.

---

## The five mistakes that cost the most time

1. **Assuming the export size is the campaign size.** It is usually half.
2. **Leaving the Firecrawl field blank.** It does not error. It writes copy from
   your spreadsheet's industry column and looks completely normal.
3. **Writing the prompt before running proximity.** You get generic copy with a
   first name on top.
4. **Describing your company in the third person in the prompt.** The model
   copies that voice and the email reads like a vendor brochure.
5. **Not checking the column mapping.** Empty output file, no error message.

## On language

The copy language follows the audience, not the tool. Read
`skills/enrichment-engine/references/language-routing.md` before writing for a
non-English market.

Two things from that file worth knowing now: a company's name tells you almost
nothing about what language its website runs in, and if the whole list is one
market you should hardcode the language rather than detect it — detection reads
the research text, so an empty research result silently routes everything to
English.

## On the `humanizer` skill

Run it on any copy that reads like AI wrote it. It strips inflated claims, stock
AI words, filler and repetitive structure. Useful on the second and third emails
in a sequence, which drift into marketing language more than the first.

## Licence note

`enrichment-engine` clones https://github.com/touseef028/enrichment at runtime.
That repo has no LICENSE file, which under default copyright means all rights
reserved — being public grants the right to view and fork on GitHub, not to use
commercially. A factual flag, not legal advice. Decide before revenue work.
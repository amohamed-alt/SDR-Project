# enrichment-engine

Takes a verified contact CSV and writes a personalised subject line and opening
lines for every row. Researches each company live, then writes in whatever
language the ICP speaks.

## How to use

Run `/proximity` first to settle the angle, then ask in your own words:

> Personalise this list of 500 Riyadh contacts in Arabic

You get back: your CSV with copy columns appended, ready for Smartlead or
Instantly.

**Note:** Needs an Anthropic key. A Firecrawl key is optional but without it
there is no live research, and the opening lines lose the detail that makes them
work.

## How to install

This folder came in a handoff bundle. See `START-HERE.md` at the top of the
bundle - copy this folder into `~/.claude/skills/` and restart Claude Code.
## Attribution and licence

The underlying tool is [touseef028/enrichment](https://github.com/touseef028/enrichment),
by touseef028. This skill documents and drives it — it does not contain or
redistribute its code.

That repo carries **no LICENSE file**, which under default copyright means all
rights reserved. Forking on GitHub is permitted; commercial use is not granted.
The skill flags this at the start of a run. Not legal advice.
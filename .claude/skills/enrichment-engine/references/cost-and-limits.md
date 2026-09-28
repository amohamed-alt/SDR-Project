# Cost and limits

Verified against Firecrawl pricing, September 2026. Re-check before quoting —
tiers move.

## Firecrawl credits per contact

| Operation | Default | Credits |
|---|---|---|
| Website scrape | `FIRECRAWL_SCRAPE = True` | 1 |
| Web search (3 results) | `FIRECRAWL_SEARCH = True` | 2 |
| Arabic search pass | off unless patched | +2 |

**Default: 3 credits per contact. With the Arabic pass: 5.**

Search is billed at 2 credits per 10 results, so dropping
`FIRECRAWL_SEARCH_LIMIT` from 3 to 1 saves nothing. To cut search cost, turn
search off entirely.

## Firecrawl tiers

| Tier | Monthly | Credits | Contacts at 3/each |
|---|---|---|---|
| Free | $0 | 1,000 | ~333 |
| Hobby | $16 | 5,000 | ~1,666 |
| Standard | $83 | 100,000 | ~33,000 |

Rate limits on free: 10 req/min for scrape, map and search; 2 concurrent
browsers. See patch 5 in [`patches.md`](patches.md) — the shipped
`DELAY_BETWEEN_CALLS` will trip this.

## Worked example — 2,000 contacts

Assume a 60% pass rate on MillionVerifier, so 1,200 rows actually process.

| Setup | Credits | Firecrawl | Claude | Total |
|---|---|---|---|---|
| Scrape + search | 3,600 | Hobby, $16 | ~$6 | ~$22 |
| Scrape only | 1,200 | Hobby, $16 | ~$6 | ~$22 |
| Scrape + both searches | 6,000 | Standard, $83 | ~$6 | ~$89 |

The jump to Standard is the decision that matters. Scrape-only fits comfortably
inside Hobby; adding the Arabic pass pushes a 2,000-row list past 5,000 credits
and up a tier.

**Always compute against the post-filter count, not the list size.** Quoting on
2,000 when 1,200 will process overstates cost by two thirds and makes the tier
choice look worse than it is.

## Claude cost

`CLAUDE_COST_PER_ROW = 0.005` on Haiku. Roughly right for English.

**Arabic runs higher.** Arabic tokenises to more tokens per character than
English, so the same `RESEARCH_CHAR_LIMIT = 4000` sends noticeably more tokens.
Budget 1.5x the estimate for an Arabic campaign and treat the UI's running total
as a floor.

## Scrape-only — try it first

Turning search off cuts credits by two thirds:

```python
FIRECRAWL_SEARCH = False
```

Whether the copy survives it depends entirely on the sites. A company with a real
website gives the scrape plenty to work with. A one-page brochure site gives
nothing, and then search is carrying the personalisation alone.

Test on 20 rows and read the raw `{research}`. That answers it for the specific
list in front of you, which is the only answer that matters — and it inverts the
cost decision, so do it before choosing a tier.
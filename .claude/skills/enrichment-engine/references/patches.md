# Patches

Applied to the upstream clone at `~/.cache/enrichment-engine`, never committed
back to this repo. Re-apply after every `git pull` — check first, each patch is
idempotent to verify but not to apply twice.

## 1. UTF-8 BOM on output — required for any non-ASCII language

`run_enrichment` writes the output CSV as plain UTF-8. Excel on Windows reads a
BOM-less CSV as the system codepage, so Arabic renders as mojibake and the run
looks broken when the data is fine. The input side already uses `utf-8-sig`;
this makes the output match.

```bash
cd ~/.cache/enrichment-engine
grep -n 'with open(output_path, "w", newline="", encoding="utf-8")' enrichment.py
sed -i '' 's/with open(output_path, "w", newline="", encoding="utf-8")/with open(output_path, "w", newline="", encoding="utf-8-sig")/' enrichment.py
```

On Linux drop the `''` after `-i`.

Verify:

```bash
grep -n 'encoding="utf-8-sig"' enrichment.py   # expect two hits: input and output
```

## 2. `{language}` placeholder — mode C only

Per-contact language detection from the research text. Skip this for a
single-language campaign; mode A needs no code change.

Three edits to `enrichment.py`:

**a. Register the placeholder.** In `PROMPT_PLACEHOLDERS`, add `"language"`:

```python
PROMPT_PLACEHOLDERS = [
    "first_name", "last_name", "title", "company", "location",
    "city", "state", "employees", "keywords", "website",
    "email", "linkedin", "research", "language",
]
```

**b. Add the detector** next to the other helpers, after `trim_text`:

```python
ARABIC_RATIO_THRESHOLD = 0.20

def detect_language(research):
    """Pick the copy language from the research text. Falls back to English."""
    if not research:
        return "English"
    letters = [c for c in research if c.isalpha()]
    if not letters:
        return "English"
    arabic = sum(1 for c in letters if "؀" <= c <= "ۿ")
    return "Arabic" if arabic / len(letters) >= ARABIC_RATIO_THRESHOLD else "English"
```

Counting over `isalpha()` rather than all characters keeps markdown syntax,
digits and URLs from diluting the ratio — those are script-neutral and would
otherwise push every bilingual page under the threshold.

**c. Populate it** in `generate_fields`, directly after `variables["research"] = research`:

```python
    variables["language"] = detect_language(research)
```

Then use `{language}` in the prompt. Test the threshold on 20 rows before
trusting it on a full list — bilingual Gulf sites cluster right around it.

## 3. Arabic search pass — optional, doubles search credits

`build_research` searches with `{company} {location}` in Latin script only. For
an Arabic-market list this misses local coverage.

In `build_research`, replace the search block:

```python
    if FIRECRAWL_SEARCH and company:
        results = firecrawl_search(key, f"{company} {location}".strip())
        calls += 1
        if results:
            parts.append("WEB SEARCH RESULTS:\n" + trim_text(results, RESEARCH_CHAR_LIMIT))
```

with:

```python
    if FIRECRAWL_SEARCH and company:
        queries = [f"{company} {location}".strip()]
        if ARABIC_SEARCH:
            queries.append(f"{company} {ARABIC_SEARCH_SUFFIX}".strip())
        for q in queries:
            results = firecrawl_search(key, q)
            calls += 1
            if results:
                parts.append("WEB SEARCH RESULTS:\n" + trim_text(results, RESEARCH_CHAR_LIMIT))
```

and add to the config block at the top:

```python
ARABIC_SEARCH = True
ARABIC_SEARCH_SUFFIX = "السعودية"      # market term, adjust per campaign
```

Cost impact: 2 extra credits per contact, so 5 per contact instead of 3. On
2,000 contacts that is 10,000 credits instead of 6,000. Check
[`cost-and-limits.md`](cost-and-limits.md) before enabling.

## 4. `location` fallback — non-US lists

`contact_vars` defaults `location` to `"United States"` when City and State are
both blank, which then flows into the search query and the prompt.

```python
    location = ", ".join(filter(None, [city, state])) or "United States"
```

Either populate City in the CSV, or change the fallback to the campaign's market.
Leaving it is the quiet kind of wrong — nothing errors, the copy is just about
the wrong country.

## 5. Rate limiting — free tier only

`DELAY_BETWEEN_CALLS = 0.3` paces roughly 200 requests/minute. The Firecrawl free
tier allows 10/minute for scrape and search, so a free-tier run will hit 429s.

```python
DELAY_BETWEEN_CALLS = 6.5    # free tier: stay under 10 req/min
```

At that pace 2,000 contacts takes over 7 hours with both research sources on.
This is a reason to use a paid tier, not a reason to raise the delay.

## 6. Bind to localhost — do this before anyone opens the page

`app.py` ships listening on `0.0.0.0`, so the page where API keys are typed is
reachable from every device on the network. Fix it before telling anyone the URL.

```bash
cd ~/.cache/enrichment-engine
sed -i '' 's/app.run(host="0.0.0.0", port=5050, debug=False)/app.run(host="127.0.0.1", port=5050, debug=False)/' app.py
```

Verify — the first should answer, the second should refuse:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5050
curl -s -o /dev/null -w "%{http_code}\n" http://$(ipconfig getifaddr en0):5050
```

Restarting leaves the old process holding the port. Kill it by PID from
`lsof -nP -iTCP:5050 -sTCP:LISTEN`, not by `pkill`, or you will silently keep
serving on `0.0.0.0` while believing you fixed it.

## 7. Audit columns — make a research-free run visible

Without these, a run with a blank Firecrawl key looks identical to a good one:
the output CSV is full, and the copy is quietly written from `{keywords}`. Add
both to `generate_fields`, right after `fields["_fc_calls"] = fc_calls`:

```python
    fields["research_chars"] = len(research)
    fields["language_used"] = variables["language"]
```

Then read `research_chars` before reading the copy. Zero across every row means
the research never ran, and no amount of prompt work will fix the output.

Timing is the other tell: roughly 3 seconds per contact is Claude alone. A real
run with scrape plus search is closer to 20-30 seconds per contact.

## 8. OpenRouter keys — for users with no Anthropic Console billing

The UI enables Run on any key starting `sk-`, but the engine calls Anthropic's
Messages API. An OpenRouter key (`sk-or-...`) therefore unlocks the button and
then fails every row. A Claude Pro or Max subscription is not Console billing
and gives no usable key, which is where most people get stuck.

Add above `verification_result` in `enrichment.py`:

```python
OPENROUTER_MODEL = "anthropic/claude-haiku-4.5"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class _Block:
    def __init__(self, text): self.type, self.text = "text", text


class _Resp:
    def __init__(self, text): self.content = [_Block(text)]


class _Messages:
    def __init__(self, key): self.key = key

    def create(self, model=None, max_tokens=1024, messages=None, **kw):
        r = requests.post(
            OPENROUTER_URL,
            headers={"Authorization": f"Bearer {self.key}",
                     "Content-Type": "application/json"},
            json={"model": OPENROUTER_MODEL, "max_tokens": max_tokens,
                  "messages": messages},
            timeout=90,
        )
        r.raise_for_status()
        return _Resp(r.json()["choices"][0]["message"]["content"])


class OpenRouterClient:
    def __init__(self, key): self.messages = _Messages(key)


def make_client(api_key):
    """Anthropic key -> real SDK. OpenRouter key -> shim."""
    if api_key and api_key.startswith("sk-or-"):
        return OpenRouterClient(api_key)
    return anthropic.Anthropic(api_key=api_key)
```

Then swap the one client line in `run_enrichment`:

```python
    client = make_client(anthropic_key)
```

The UI's running cost total assumes Anthropic's direct pricing, so on OpenRouter
treat it as a floor and check their dashboard for the real figure.

## 9. Column mapping — check it before the first run, every time

`contact_vars` reads Apollo's stock headers. Any reshaped or re-exported CSV
matches none of them, and the run writes an empty file with no error at all.
Confirm before spending anything:

```python
import csv, io, sys
sys.path.insert(0, "/Users/you/.cache/enrichment-engine")
import enrichment as E
rows = list(csv.DictReader(io.open("your.csv", encoding="utf-8-sig")))
print("result column found:", E.has_result_column(rows))
print("rows that will run:",
      sum(1 for r in rows if "@" in E.clean_value(r.get("Email", ""))), "/", len(rows))
print("row 1 placeholders:", E.contact_vars(rows[0]))
```

If "rows that will run" is 0, write an adapter that renames the columns. Do not
patch `contact_vars` - an adapter keeps `git pull` on the upstream clone clean.
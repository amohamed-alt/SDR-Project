# Language routing

The copy language follows the ICP, not the tool. Decide once per campaign, then
apply one of the three modes below.

## Deciding the language

Ask the user directly: *"What language should this campaign be written in?"*

If they are unsure, these signals settle it:

| Signal | Reads as |
|---|---|
| Buyer titles appear in Arabic on their LinkedIn | Arabic |
| Company website has an `/ar` version that is the default | Arabic |
| Website is English-only with no Arabic toggle | English |
| Government, family business, or local SME in the Gulf | Arabic |
| Regional HQ of a multinational, or a tech company | English, usually |

**Do not equate country with language.** A large share of Gulf B2B runs in
English at senior level, especially in tech, logistics and finance. Getting this
wrong in either direction reads as not knowing the market.

When genuinely mixed, use mode C.

## Mode A — single language, whole campaign

Simplest and most predictable. Add a language block near the top of the prompt,
before the field definitions:

```
Write every field in Arabic. Do not mix in English words except for
proper nouns, product names, and job titles that are normally left in English.
```

No code change. Use this whenever the list is one market.

## Mode B — English (default, no change)

Leave the prompt as is. English is what `prompt.example.txt` assumes.

## Mode C — per contact, detected from the research

For mixed lists. Adds a `{language}` placeholder that is computed per row from
the Arabic-character ratio of the scraped research, then injected into the
prompt. Apply the patch in [`patches.md`](patches.md), then use:

```
Write every field in {language}.
```

Detection is a ratio over the research text, not a guess by the model, so it is
stable across a run. It fails to *English* when research comes back empty, which
is the safer default — a wrong-language email is worse than a plain one.

Threshold note: the patch triggers Arabic at 20% Arabic characters. Bilingual
Gulf sites often sit between 10% and 40%, so test on a sample before trusting it
on a full list.

## Writing the Arabic ruleset

The banned-opener list in `prompt.example.txt` is English-specific and worth
nothing in Arabic. `I noticed`, `As a leader`, `In today's` have no Arabic
equivalents that matter. Build a fresh list.

**Do not invent it here.** Run `/proximity` with the Arabic-speaking ICP and let
it produce the reference copy and the rules it applied, then lift those into the
prompt. That is the whole point of running proximity first.

Patterns that reliably flatten Arabic cold email, as a starting point for that
run:

- Openers: `في ظل`, `لا يخفى عليكم`, `يسعدني أن`, `في عالم اليوم`, `كشركة رائدة`
- Over-formal address that reads like a government letter rather than a person
- Long compound sentences — Arabic tolerates them grammatically, but they kill
  a cold email the same way they do in English
- Translated English idiom that has no Arabic currency

**Register is a real decision, not a detail.** Formal MSA reads institutional and
distant. Lightly colloquial Gulf register reads human but can read too casual to
a senior buyer. Pick deliberately, per ICP, and record the choice in the prompt.

## Names

Apollo exports Latin-script names: `Mohammed`, not `محمد`. If the copy is Arabic,
the name has to be transliterated or the email opens in two scripts.

Transliteration is genuinely error-prone — `Abdulaziz` maps to both `عبدالعزيز`
and `عبد العزيز`, and `Mohammed` / `Muhammad` / `Mohamed` all map to `محمد`.
Getting someone's name wrong in the first line is worse than the small oddity of
a Latin name in Arabic copy.

Default: instruct the prompt to leave the name in Latin script unless the
research itself shows the Arabic spelling. Only transliterate when the list has
been checked by hand.

## Search queries

`build_research` builds its query as `{company} {location}` — Latin script, so it
surfaces English results only. For an Arabic-market list this systematically
misses the local coverage that makes a first line specific.

The query patch in [`patches.md`](patches.md) adds an Arabic search pass.
It doubles the search credits per contact, so decide against the budget in
[`cost-and-limits.md`](cost-and-limits.md) before enabling it.

## The `location` default

`contact_vars` falls back to `"United States"` when City and State are blank.
On a non-US list that silently injects the wrong country into both the search
query and the prompt. Patch it or ensure City is populated.
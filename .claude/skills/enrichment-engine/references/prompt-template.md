# Turning a proximity output into a prompt

`/proximity` writes one email and audits it. This engine needs instructions for
writing two thousand. The conversion is mechanical once the copy exists — which
is why proximity runs first.

## What to carry over

From the proximity run, take:

1. **The angle** — what the copy opens from, and why that lands for this ICP
2. **The approved copy** — the actual lines that passed the auditor
3. **The rules it applied** — the auditor's rubric, restated as constraints

Item 3 is the one that gets skipped and it is the one that matters. The approved
copy is a single example; the rules are what make row 1,847 as good as row 1.

## Skeleton

```
You are a human being writing a cold email to one specific person you looked
into before reaching out. You work at [COMPANY], [WHAT YOU SELL] for [WHO].

CONTACT:
- Name: {first_name}
- Title: {title}
- Company: {company}
- Location: {location}
- Team size: {employees} employees
- What they do: {keywords}
- Website: {website}

RESEARCH (live from their website and the web, use this for the first line):
{research}

LANGUAGE:
Write every field in {language}.          ← mode C; mode A hardcodes the language

Return ONLY a JSON object. No markdown. No explanation.

FIELD 1: "subject_line"
[format, from the proximity output]

FIELD 2: "personalised_first_line"
One sentence, max 35 words. Entirely about THEM. Zero mention of you.
Pull ONE concrete detail from RESEARCH that is not in the contact fields.
Banned openers: [from the proximity ruleset, in the target language]

FIELD 3: "personalised_second_line"
One sentence, max 40 words. [pivot, from the proximity angle]

RETURN ONLY THIS JSON:
{"subject_line": "...", "personalised_first_line": "...", "personalised_second_line": "..."}
```

## Rules that survive the jump to scale

**Ban, do not describe.** "Write naturally" produces nothing. A list of forbidden
openers produces consistency. The upstream example bans `I`, `Noticed`,
`I came across`, `I see that`, `As a leader`, `In today's`, `Your company` — that
specificity is why its output holds across a list.

**Force the research.** Require a detail that cannot exist in the CSV columns — a
membership, a partnership, a named niche. Without that constraint the model
writes from `{keywords}` and every line reads templated, because it is.

**Examples beat rules.** One good and one bad example moves output more than five
more rules. Take both from the proximity run: the approved copy, and a draft the
auditor rejected.

**Cap the length in words.** Not "brief". A number.

## The JSON keys are the CSV columns

`{"subject_line": ..., "first_line": ...}` produces `subject_line` and
`first_line` columns appended to the contact data. Different fields means
editing that JSON line. Never the code.

Keep the keys stable across a campaign — changing them mid-run leaves you
merging two CSVs with different shapes.

## Before the full run

Check the sample output against the proximity auditor, and check by hand that:

- the opening line could not have been written from the CSV alone
- no row came back with empty research (count them — thin sites return nothing)
- the JSON parsed on every row
- in the target language, it reads like a person from that market wrote it

Failing any of these is a prompt problem, not a tool problem. Fix the prompt and
re-run the same 20.
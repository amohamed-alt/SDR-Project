# Talentera GTM Brain

Talentera GTM Brain is the account-prioritization layer that sits above the existing Career Intelligence and Hiring Intelligence modules. Its job is not to generate generic sales copy. Its job is to decide **which account deserves attention, why now, who should be contacted, which angle should be used, and what must still be validated before outreach**.

## 1. Product objective

Turn a monitored company into one ranked account object containing:

- Talentera priority score and Tier A/B/C/Watch
- market/account fit
- live hiring intent
- hiring velocity
- recruitment complexity
- ATS modernization/displacement opportunity
- TA / recruiting-team investment signals
- HRIS / HR-systems investment signals
- likely buying committee
- regional language route
- recommended channels
- recommended sales angle
- ATS/competitor motion
- evidence-backed reasons
- validation risks
- next actions

The engine deliberately separates **evidence** from **recommendation**. Missing ATS, company size or country data is surfaced as a validation risk instead of being guessed.

## 2. Current data flow

```text
HubSpot acquisition companies
        |
        v
Career Intelligence
career page + ATS evidence
        |
        v
Hiring Intelligence
active jobs + 7d/30d changes + locations + departments + job titles
        |
        v
Talentera GTM Brain
fit + intent + complexity + ATS opportunity + personas + motion
        |
        +--> /account-intelligence UI
        |
        +--> /api/account-intelligence
        |
        +--> future n8n / HubSpot property sync
        |
        +--> future SignalHire contact enrichment
        |
        +--> future Smartlead / WhatsApp / calling execution
```

HubSpot remains the CRM/system of record. The GTM Brain is an intelligence and prioritization layer.

## 3. Core implementation

### `src/lib/talentera-intelligence.ts`

Deterministic scoring and recommendation engine. It has no API keys and can run in server or client contexts.

Exports:

- `scoreTalenteraAccount(input)`
- `scoreTalenteraPortfolio(accounts)`

The portfolio scorer always sorts by:

1. overall Talentera score
2. intent score
3. company name for deterministic ties

### `src/app/api/account-intelligence/route.ts`

Reusable server endpoint for dashboard integrations, n8n and future HubSpot sync.

Supported query parameters:

- `q`: free-text account/signal/ATS search
- `country`: exact normalized market value
- `tier`: `A`, `B`, `C`, `Watch`
- `minScore`: 0–100
- `minIntent`: 0–100
- `limit`: 1–2000, default 500

Examples:

```text
/api/account-intelligence?tier=A
/api/account-intelligence?country=Saudi%20Arabia&minIntent=65
/api/account-intelligence?q=workday&minScore=60
```

### `src/app/account-intelligence/page.tsx`

Dedicated GTM Brain workspace.

### `src/components/AccountIntelligence.tsx`

Prioritized queue and account drawer. The drawer exposes evidence, buying committee, language route, recommended angle, competitor motion and next actions.

## 4. Scoring model

The overall score is intentionally deterministic so the same evidence produces the same rank.

```text
Overall score
= 52% Fit
+ 36% Intent
+ 12% ATS opportunity
```

Missing optional data is excluded from the relevant weighted average rather than converted to a fake zero.

### 4.1 Fit score

Fit considers:

- market priority
- employee count when available
- recruitment complexity
- ATS opportunity

Current market priority starts with:

1. Saudi Arabia
2. United Arab Emirates
3. GCC / MENA expansion markets
4. Egypt
5. other markets

This is code-level prioritization, not a claim that every Saudi account is automatically qualified.

### 4.2 Intent score

Intent considers:

- existing Hiring Intelligence score
- active job volume
- new jobs in 7/30 days
- hiring velocity
- Talent Acquisition / recruiting-team hiring signal
- HRIS / HR-systems / HR-transformation hiring signal

### 4.3 Hiring velocity

```text
active = 0                     -> No active hiring
previous = 0 and active > 0    -> New hiring
+30% or more                   -> Surging
+5% to +30%                    -> Growing
-30% or less                   -> Cooling
otherwise                      -> Stable
```

### 4.4 Recruitment complexity

Complexity uses observable proxies:

- active jobs
- hiring locations
- departments
- recruiting/TA team signals
- HRIS/HR-systems signals

High job volume alone is useful, but multi-location and recruiting-operations evidence increases the score because those conditions create more workflow, governance and reporting complexity.

### 4.5 ATS opportunity

ATS vendors are grouped into commercial motions, not declared as weak/strong products.

#### Enterprise suite

Examples:

- Workday
- Oracle / Taleo
- SAP SuccessFactors
- iCIMS
- Avature
- SmartRecruiters
- Eightfold
- Cornerstone
- Phenom
- UKG

Motion: investigate recruiting-team workarounds, localization, recruiter usability, workflow fit and implementation agility without attacking the enterprise suite.

#### Modern ATS

Examples:

- Greenhouse
- Lever
- Ashby
- Workable
- Recruitee
- Teamtailor
- Zoho Recruit
- Manatal

Motion: investigate enterprise recruiting depth, complex approvals, MENA requirements, Arabic candidate experience, multi-location governance and integrations.

#### Regional HRTech

Examples:

- Elevatus
- Menaitech
- Jisr
- Bayzat
- KayanHR
- People365
- WebHR
- Cazar / SniperHire

Motion: establish whether the existing platform is primarily solving broad HR needs or the Talent Acquisition team's recruiting-specific workflow, automation and reporting needs.

#### Unknown / no ATS

The engine does **not** claim replacement opportunity. It adds a validation task to identify the current recruitment system first.

## 5. Buying signals

Current first-party observable signals include:

- hiring surge
- hiring growth
- high-volume hiring
- TA / recruiting-team investment
- HRIS / HR-systems / HR-transformation investment
- multi-location recruiting
- existing ATS evidence

Future signal families should include:

- new CHRO / VP HR / TA Director
- new Saudi HQ or regional office
- factory / hospital / hotel / retail opening
- funding or acquisition
- major government/private contract
- graduate hiring campaign
- Saudization hiring program
- employer-brand / careers rebuild
- procurement/RFP signal
- new HR transformation initiative

These should be added as evidence objects before they affect scores.

## 6. Persona routing

The engine avoids `HR` as a generic persona.

### HRIS / HR systems signal present

Primary: HRIS / HR Systems Manager  
Secondary: Head / Director Talent Acquisition  
Economic buyer: CHRO / VP HR  
Technical influence: IT / Enterprise Applications

### Higher-volume / multi-location / recruiting-team signal

Primary: Head / Director Talent Acquisition  
Secondary: Recruitment Manager / Talent Operations  
Economic buyer: CHRO / HR Director  
Technical influence: HRIS / IT

### Lower-complexity active account

Primary: Talent Acquisition Manager  
Secondary: HR Director

## 7. Regional language routing

Current route:

- Saudi Arabia: Arabic-first bilingual
- UAE: English-first bilingual
- other markets: English-first

This chooses the outreach strategy, not a literal translation rule. Product terminology may remain in English when that is clearer for the persona.

Before automatic Arabic name conversion is introduced, transliteration should remain a separate confidence-scored service so the system never invents a wrong Arabic name.

## 8. Dashboard operating model

The queue is intentionally sorted by commercial priority, not alphabetical order.

Recommended daily workflow:

1. Open GTM Brain.
2. Filter Tier A.
3. Open account.
4. Validate ATS if listed as unknown/low confidence.
5. Read strongest buying signal.
6. Enrich the recommended primary persona.
7. Use the recommended angle as the message hypothesis.
8. Push only verified contact/account facts to outreach.
9. Record meeting/reply outcomes in HubSpot.
10. Use downstream conversion data to recalibrate scoring later.

## 9. Recommended HubSpot properties

Do not create/update these until the production portal property definitions are approved.

Suggested company properties:

```text
talentera_gtm_score              number
talentera_gtm_tier               enumeration: A/B/C/Watch
talentera_fit_score              number
talentera_intent_score           number
talentera_intent_level           enumeration
talentera_complexity_score       number
talentera_ats_opportunity_score  number
talentera_ats_opportunity        enumeration
talentera_hiring_velocity        enumeration
talentera_primary_persona        text
talentera_secondary_persona      text
talentera_language_route         enumeration
talentera_recommended_angle      multiline text
talentera_strongest_signal       text
talentera_gtm_confidence         enumeration
talentera_gtm_last_scored_at     datetime
```

Recommended sync rule:

- GTM Brain calculates continuously/off-CRM.
- n8n writes only the compact score/recommendation fields.
- HubSpot remains responsible for ownership, tasks, activities, deals and lifecycle.
- The raw research payload stays in the intelligence datastore rather than inflating CRM properties.

## 10. Contact enrichment integration

Future SignalHire step:

```text
Tier A/B account
   -> recommended primary persona
   -> search people
   -> validate seniority + company
   -> enrich email/phone
   -> phone/email validation
   -> associate contact to company
   -> route to SDR queue
```

Do not enrich every employee. Start with the recommended buying committee and use a waterfall only when the first persona cannot be found.

## 11. Outreach execution integration

The GTM Brain should provide structured input to copy generation:

```json
{
  "company": "Example",
  "market": "Saudi Arabia",
  "persona": "Head of Talent Acquisition",
  "strongest_signal": "Hiring surge",
  "evidence": "84 active jobs, +39 in 30d",
  "ats": "Oracle Recruiting Cloud",
  "angle": "High-volume multi-location hiring",
  "language_route": "Arabic-first bilingual"
}
```

The copywriter may use those facts. It must not add unsupported company pain statements.

Recommended execution stack:

- email: Smartlead
- people/contact enrichment: SignalHire-first where available
- CRM: HubSpot
- orchestration: n8n
- calling: current Maqsam integration/workspace
- WhatsApp: only through the approved business/API route and applicable messaging rules

## 12. Closed-won learning layer

The current V1 scorer is rules-based on purpose. The next learning layer should be trained/calibrated from Talentera outcomes, not generic internet conversion benchmarks.

Useful outcome features:

- meeting booked
- meeting attended
- qualified
- opportunity created
- closed won
- closed lost reason
- sales cycle length
- company size
- industry
- country
- ATS before Talentera
- active jobs / hiring velocity at outreach time
- contacted persona
- channel
- language
- signal used

The learning system should first recommend weight changes and show backtests before it is allowed to change production account ranking automatically.

## 13. Reliability and security

- No new secrets are introduced by the scoring engine.
- The score function is deterministic.
- The API returns `Cache-Control: private, no-store`.
- The API reuses the existing local hiring store instead of triggering external scans on every request.
- Unknown/missing evidence reduces confidence or creates validation risks.
- Competitor messaging is framed as a discovery hypothesis rather than an unsupported claim.
- HubSpot writes are intentionally not enabled in this PR; write scopes/property creation need an explicit production rollout.

## 14. Validation

Automated tests cover:

- Saudi high-intent Tier A account ranking
- HRIS / HR systems signal detection
- recruiting-team signal detection
- enterprise ATS motion
- UAE language routing
- missing ATS safety behavior
- missing employee-count normalization
- deterministic portfolio ordering

Run:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## 15. Recommended next build phases

### Phase 2 — CRM sync

- create approved HubSpot company properties
- n8n score sync every 15–30 minutes
- push Tier A/B changes only
- create SLA queue when an account crosses a priority threshold

### Phase 3 — People Brain

- SignalHire persona resolver
- org-chart / buying-committee map
- verified contact association
- wrong-number / missing-email recovery

### Phase 4 — Trigger Brain

- leadership changes
- expansion/funding/contracts/openings
- TA/HRIS role alerts
- job velocity history beyond the current snapshots

### Phase 5 — Outreach Brain

- Arabic/English/bilingual routing
- account-specific angle selection
- controlled copy generation
- Smartlead sequence assignment
- WhatsApp/call follow-up rules

### Phase 6 — Learning Brain

- meeting probability model
- closed-won lookalikes
- lost-deal reason intelligence
- score calibration by market/persona/industry/ATS

The target architecture is a single Talentera GTM operating system: public/company signals are converted into ranked evidence-backed actions, execution happens through the existing sales stack, and HubSpot outcomes teach the next iteration which signals actually create meetings and revenue.

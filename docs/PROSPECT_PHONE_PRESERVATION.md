# Prospect phone preservation

SignalHire contact resolution retains every returned phone and exposes a mobile only when the provider explicitly labels it `mobile`. A captured list number is merged with the resolve results instead of discarded. Digit-equivalent international formatting is deduplicated without guessing a country code.

The push route requires a usable phone before creating CRM objects. New contacts receive the explicitly classified mobile in `mobilephone` and a distinct alternate in `phone` when available. Existing nonempty phone fields remain unchanged. Additional numbers remain in the call task body. WhatsApp fields are not inferred from a mobile label.

Phone writes are read back before the route proceeds. A mismatch fails visibly and asks for reconciliation. Existing company/contact/owner and duplicate-task protections remain in force.

A Search API 402 is identified as exhausted name/company search quota; it does not establish that Contact credits are exhausted. A real public LinkedIn URL uses direct contact resolution and avoids the name/company search. No identifiers are fabricated and no new paid waterfall is enabled.

Validation: regression tests in `tests/prospect-phone-details.test.mjs`, repository tests, TypeScript and production build. These checks do not establish provider phone accuracy or repair historical records.

## WhatsApp service resilience

The online-lead action reuses the real phone and business details already loaded in the workspace if the preparation endpoint has a temporary 429/502/503/504, network failure, or timeout. This prepares a standard draft only and never sends a message. Permission, missing-contact, and invalid-phone responses do not trigger this fallback. Ambiguous local numbers without a known country stay blocked. Hover/focus no longer starts CRM/AI requests; requests begin on click and remain deduplicated. The action title indicates when loaded data was used.

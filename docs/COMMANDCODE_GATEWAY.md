# CommandCode AI gateway

CommandCode is the only provider for task copy, WhatsApp generation, account briefs, Best Accounts explanations and the SDR evidence assistant. GitHub Secret COMMANDCODE_API (alias COMMANDCODE_API_KEY) is forwarded through the existing Hostinger deployment. Repository Variable COMMANDCODE_MODEL overrides the chat-completions model. There is no fallback to the retired provider.

General completions keep persistent evidence/prompt/model cache, daily fast/deep request reservations and bounded input/output. Fast and deep default to the same configured model; deep is explicit. General state is /app/data/commandcode-gateway-state.json; task copy uses /app/data/commandcode-outreach.json. Both use the existing app-data volume. Cost estimates require explicit COMMANDCODE_CUSTOM_INPUT_USD_PER_M / COMMANDCODE_CUSTOM_OUTPUT_USD_PER_M; the UI displays token usage rather than claiming an unknown price.

Native web-search tools from the retired provider are removed. Authoritative ATS and fresh structured official job postings continue to count. Ambiguous/stale generic postings remain inconclusive and are excluded; a language model cannot attest to live job availability without verified sources. Historical verification provenance may remain in stored records.

The deployment job runs scripts/commandcode-live-smoke.mjs using synthetic contacts for both brands plus the general gateway. It checks the deployed provider configuration and authenticated task-input rejection. It performs no CRM writes and sends no outreach. Its separate step reports a provider/key/plan failure without rolling back a healthy application or restoring the retired provider.

Official API contract: https://commandcode.ai/docs/provider

DeepSeek thinking is explicitly disabled for bounded SDR outputs so hidden reasoning cannot consume the visible answer budget. Task copy permits up to 1,200 output tokens while keeping the same strict displayed character limits. The full synthetic test must print `CommandCode live smoke passed` to prove success; deployment success alone is not provider success.

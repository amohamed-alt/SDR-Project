#!/bin/sh
set -eu

RUNTIME_ENV_FILE="${SDR_RUNTIME_ENV_FILE:-/run/sdr-env/.env}"

if [ ! -s "$RUNTIME_ENV_FILE" ]; then
  echo "FATAL: persistent SDR runtime env is missing at $RUNTIME_ENV_FILE" >&2
  exit 78
fi

set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV_FILE"
set +a

# Keep OpenRouter isolated to the GTM research module, but default its premium
# stages to a much cheaper/faster structured-output model than Claude Sonnet.
# An explicit runtime value can still override this later without a redeploy.
GTM_RESEARCH_OPENROUTER_MODEL="${GTM_RESEARCH_OPENROUTER_MODEL:-openai/gpt-4.1-mini}"
export GTM_RESEARCH_OPENROUTER_MODEL

if [ -n "${GTM_RESEARCH_OPENROUTER_API_KEY:-${OPENROUTER_API_KEY:-}}" ]; then
  echo "GTM OpenRouter: configured; premium model=${GTM_RESEARCH_OPENROUTER_MODEL}"
else
  echo "GTM OpenRouter: NOT configured; premium stages will fall back to local Ollama"
fi

exec node server.js

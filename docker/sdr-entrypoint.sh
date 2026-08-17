#!/bin/sh
set -eu

RUNTIME_ENV_FILE="${SDR_RUNTIME_ENV_FILE:-/run/sdr-env/.env}"

if [ ! -s "$RUNTIME_ENV_FILE" ]; then
  echo "FATAL: persistent SDR runtime env is missing at $RUNTIME_ENV_FILE" >&2
  exit 78
fi

# Deployment-injected GTM credentials are kept separately before loading the
# persistent runtime file. This lets a GitHub Actions secret safely override an
# older VPS env file without changing or exposing that file.
DEPLOY_GTM_OPENROUTER_API_KEY="${GTM_RESEARCH_OPENROUTER_API_KEY:-${OPENROUTER_API_KEY:-}}"
DEPLOY_GTM_OPENROUTER_MODEL="${GTM_RESEARCH_OPENROUTER_MODEL:-}"

set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV_FILE"
set +a

if [ -n "$DEPLOY_GTM_OPENROUTER_API_KEY" ]; then
  GTM_RESEARCH_OPENROUTER_API_KEY="$DEPLOY_GTM_OPENROUTER_API_KEY"
  export GTM_RESEARCH_OPENROUTER_API_KEY
fi

if [ -n "$DEPLOY_GTM_OPENROUTER_MODEL" ]; then
  GTM_RESEARCH_OPENROUTER_MODEL="$DEPLOY_GTM_OPENROUTER_MODEL"
else
  GTM_RESEARCH_OPENROUTER_MODEL="${GTM_RESEARCH_OPENROUTER_MODEL:-openai/gpt-4.1-mini}"
fi
export GTM_RESEARCH_OPENROUTER_MODEL

if [ -n "${GTM_RESEARCH_OPENROUTER_API_KEY:-${OPENROUTER_API_KEY:-}}" ]; then
  echo "GTM OpenRouter: configured; premium model=${GTM_RESEARCH_OPENROUTER_MODEL}"
else
  echo "GTM OpenRouter: NOT configured; premium stages will fall back to local Ollama"
fi

exec node server.js

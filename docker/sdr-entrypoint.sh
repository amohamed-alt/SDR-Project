#!/bin/sh
set -eu

RUNTIME_ENV_FILE="${SDR_RUNTIME_ENV_FILE:-/run/sdr-env/.env}"

if [ ! -s "$RUNTIME_ENV_FILE" ]; then
  echo "FATAL: persistent SDR runtime env is missing at $RUNTIME_ENV_FILE" >&2
  exit 78
fi

# Deployment-injected credentials are kept separately before loading the
# persistent runtime file. This lets GitHub Actions secrets safely override an
# older VPS env file without changing or exposing that file.
DEPLOY_OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-${GTM_RESEARCH_OPENROUTER_API_KEY:-}}"
DEPLOY_SIGNALHIRE_API_KEY="${SIGNALHIRE_API_KEY:-}"

set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV_FILE"
set +a

if [ -n "$DEPLOY_OPENROUTER_API_KEY" ]; then
  OPENROUTER_API_KEY="$DEPLOY_OPENROUTER_API_KEY"
elif [ -z "${OPENROUTER_API_KEY:-}" ] && [ -n "${GTM_RESEARCH_OPENROUTER_API_KEY:-}" ]; then
  # Backward-compatible migration from the retired GTM Research secret name.
  OPENROUTER_API_KEY="$GTM_RESEARCH_OPENROUTER_API_KEY"
fi
export OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"

# Keep the old name populated for any older local code during the transition.
if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  GTM_RESEARCH_OPENROUTER_API_KEY="$OPENROUTER_API_KEY"
  export GTM_RESEARCH_OPENROUTER_API_KEY
fi

OPENROUTER_FAST_MODEL="${OPENROUTER_FAST_MODEL:-openai/gpt-4.1-nano}"
OPENROUTER_DEEP_MODEL="${OPENROUTER_DEEP_MODEL:-openai/gpt-4.1-mini}"
export OPENROUTER_FAST_MODEL OPENROUTER_DEEP_MODEL

if [ -n "$DEPLOY_SIGNALHIRE_API_KEY" ]; then
  SIGNALHIRE_API_KEY="$DEPLOY_SIGNALHIRE_API_KEY"
  export SIGNALHIRE_API_KEY
fi

if [ -n "${OPENROUTER_API_KEY:-}" ]; then
  echo "OpenRouter gateway: configured; fast=${OPENROUTER_FAST_MODEL}; deep=${OPENROUTER_DEEP_MODEL}"
else
  echo "OpenRouter gateway: NOT configured; paid AI features are disabled"
fi

if [ -n "${SIGNALHIRE_API_KEY:-}" ]; then
  echo "Prospecting SignalHire: configured"
else
  echo "Prospecting SignalHire: NOT configured"
fi

exec node server.js
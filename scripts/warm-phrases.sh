#!/usr/bin/env bash
# Generates Silia's familiar phrases once for the whole app (all languages). Admin only.
# Needs: SUPABASE_URL (https://<ref>.supabase.co) and WARM_PHRASES_TOKEN (same value as the Supabase secret).
# Usage: SUPABASE_URL=... WARM_PHRASES_TOKEN=... ./scripts/warm-phrases.sh
set -euo pipefail
: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${WARM_PHRASES_TOKEN:?set WARM_PHRASES_TOKEN}"
curl -sS -X POST "$SUPABASE_URL/functions/v1/warm-phrases" \
  -H "x-admin-token: $WARM_PHRASES_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
echo

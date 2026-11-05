#!/bin/sh
# Speed benchmark for the page reading: same photos, several models / reasoning efforts / image sizes.
# Each line prints accuracy (core correct, harmful) and average time per call; full reports in results/<date>/summary.md.
# Pick the fastest setting with core correct >= 90 % and 0 harmful, then set it in Supabase secrets:
#   supabase secrets set OPENAI_READ_MODEL=<model> OPENAI_READ_EFFORT=<effort> && redeploy analyze-snapshot
# Usage: cd experiments/m0-handwriting-test && sh bench.sh   (needs OPENAI_API_KEY in .env)
set -e
MODELS="${MODELS:-gpt-6-luna}"        # add faster vision models to compare, space separated
EFFORTS="${EFFORTS:-low none}"        # gpt-6-luna accepts: none low medium high xhigh (not "minimal")
SIZES="${SIZES:-2048 1536 1280}"
for m in $MODELS; do for e in $EFFORTS; do for s in $SIZES; do
  echo "### model=$m effort=$e size=$s"
  RUNS=${RUNS:-1} MAX_SIDE=$s OPENAI_MODEL=$m OPENAI_REASONING_EFFORT=$e node --env-file=.env run-test.mjs openai
done; done; done

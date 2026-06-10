#!/usr/bin/env bash
#
# SCHEMA DRIFT GUARD
# Fail if the live (linked, production) schema contains anything NOT represented
# by the committed migrations — e.g. DDL pasted straight into the SQL Editor and
# never written as a migration file. This is the check that catches the real
# "migration written in-session, never committed" problem: such changes never
# register a migration version, so only a true schema diff can see them.
#
# Run from apps/web (so the Supabase CLI finds ./supabase) AFTER `supabase link`.
# `supabase db diff --linked` reports the delta between committed migrations and
# the live prod schema; any non-comment output means prod has un-migrated changes.
set -euo pipefail

echo "Diffing committed migrations against the live prod schema (public)…"

if ! out="$(supabase db diff --linked --schema public 2>/dev/null)"; then
  echo "::error::'supabase db diff' failed (link, credentials, or Docker). Failing closed."
  exit 1
fi

# Explicit no-drift signal from the CLI.
if printf '%s\n' "$out" | grep -qiE 'no schema changes found'; then
  echo "OK — live prod schema matches the committed migrations."
  exit 0
fi

# Anything beyond comments/blank lines is a real, un-migrated delta.
meaningful="$(printf '%s\n' "$out" | grep -vE '^[[:space:]]*(--.*)?$' || true)"
if [ -n "$meaningful" ]; then
  echo "::error::Live prod schema differs from the committed migrations (un-migrated changes):"
  echo "----------------------------------------------------------------------"
  printf '%s\n' "$out"
  echo "----------------------------------------------------------------------"
  echo "Someone changed prod outside the migration system. Capture this as a"
  echo "committed migration in apps/web/supabase/migrations/, then re-run."
  exit 1
fi

echo "OK — no schema drift detected."

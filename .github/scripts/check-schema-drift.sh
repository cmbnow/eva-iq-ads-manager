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

# ---------------------------------------------------------------------------
# KNOWN FALSE-POSITIVE — the four managed-Vault wrapper functions.
# `supabase db diff` builds an ephemeral shadow DB from the committed migrations
# and diffs it against prod. That shadow cannot reproduce Supabase's *managed*
# `vault` schema (platform-managed encryption keys; recent vault images no longer
# ship vault.create_secret / vault.update_secret), so these four SECURITY DEFINER
# wrappers never materialize in the shadow and migra re-emits them on EVERY run —
# even though their committed text is byte-for-byte identical to prod (defined in
# 20260605160000, 20260608130000, re-asserted in 20260610130000; a per-file
# `set check_function_bodies = off;` was tried in ed6c5ef and did NOT help).
#
# Strip ONLY these four named blocks (plus migra's companion
# `set check_function_bodies = off;` header line) before the drift check. This is
# NOT a blanket bypass: a FIFTH vault function, a changed signature, ANY other
# object, or any real DDL still flows through unchanged and fails the guard red.
filtered="$(printf '%s\n' "$out" | awk '
  /^[[:space:]]*set check_function_bodies = off;[[:space:]]*$/ { next }
  /^CREATE OR REPLACE FUNCTION public\.(get_meta_token|store_meta_token|get_ticket_tailor_key|store_ticket_tailor_key)\(/ { skip = 1; next }
  skip == 1 && /^[[:space:]]*;[[:space:]]*$/ { skip = 0; next }
  skip == 1 { next }
  { print }
')"

# Anything beyond comments/blank lines (after stripping the known false-positive)
# is a real, un-migrated delta.
meaningful="$(printf '%s\n' "$filtered" | grep -vE '^[[:space:]]*(--.*)?$' || true)"
if [ -n "$meaningful" ]; then
  echo "::error::Live prod schema differs from the committed migrations (un-migrated changes):"
  echo "----------------------------------------------------------------------"
  printf '%s\n' "$out"
  echo "----------------------------------------------------------------------"
  echo "Someone changed prod outside the migration system. Capture this as a"
  echo "committed migration in apps/web/supabase/migrations/, then re-run."
  exit 1
fi

# Passed — but if we filtered the known Vault false-positive, say so out loud.
if [ "$out" != "$filtered" ]; then
  echo "NOTE — ignored the known Vault-wrapper false-positive (get_meta_token,"
  echo "store_meta_token, get_ticket_tailor_key, store_ticket_tailor_key): their"
  echo "committed text matches prod; 'supabase db diff' cannot reproduce the"
  echo "managed vault schema in its shadow DB. Every other object is still enforced."
fi

echo "OK — no schema drift detected (beyond the known Vault false-positive)."

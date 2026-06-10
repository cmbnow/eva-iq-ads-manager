#!/usr/bin/env bash
#
# VERSION DRIFT GUARD
# Fail if the linked (production) database has applied migration VERSIONS that
# are not committed to the repo — i.e. a migration was applied through Supabase's
# migration system but its file was never committed. Complements the schema-drift
# guard: this one is cheap/deterministic and protects the going-forward path once
# all changes flow through `supabase db push`.
#
# Run from apps/web AFTER `supabase link`. `supabase migration list --linked`
# prints a Local | Remote | Time table: "Remote" = versions applied on prod,
# "Local" = versions present as repo files. A row with a Remote version but no
# Local version = an applied migration with no committed file.
set -euo pipefail

if ! raw="$(supabase migration list --linked 2>/dev/null)"; then
  echo "::error::Could not read the remote migration list (link or credentials failed)."
  exit 1
fi

if [ -z "${raw//[[:space:]]/}" ]; then
  echo "::error::Empty migration list output — refusing to pass silently."
  exit 1
fi

# Fail safe if the table format is not what we expect (don't silently pass).
if ! printf '%s\n' "$raw" | grep -qiE 'local' \
  || ! printf '%s\n' "$raw" | grep -qiE 'remote'; then
  echo "::error::Unexpected 'migration list' format (no Local/Remote header). Failing closed."
  printf '%s\n' "$raw"
  exit 1
fi

# Normalize box-drawing separators to '|', locate the Local/Remote columns from
# the header (robust to borders/column count), then flag Remote-only rows.
drift="$(
  printf '%s\n' "$raw" \
    | sed 's/│/|/g' \
    | awk -F'|' '
        function digits(s){ gsub(/[^0-9]/,"",s); return s }
        loc==0 || rem==0 {
          for (i=1;i<=NF;i++){
            h=tolower($i); gsub(/[[:space:]]/,"",h)
            if (h=="local")  loc=i
            if (h=="remote") rem=i
          }
          if (loc>0 && rem>0) next
        }
        loc>0 && rem>0 {
          l=digits($loc); r=digits($rem)
          if (l=="" && length(r)>=14) print substr(r,1,14)
        }
      ' \
    | sort -u
)"

if [ -n "$drift" ]; then
  echo "::error::Production has applied migration version(s) with no committed file:"
  printf '  - %s\n' $drift
  echo ""
  echo "These ran through the migration system but were never committed."
  echo "Add apps/web/supabase/migrations/<version>_*.sql for each, then re-run."
  exit 1
fi

echo "OK — every applied prod migration version has a committed repo file."

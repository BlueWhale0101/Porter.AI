#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 -f test/sql/bootstrap.sql
for migration in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$migration"; done
psql -v ON_ERROR_STOP=1 -f test/sql/trip-deletion.sql

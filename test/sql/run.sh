#!/usr/bin/env bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 -f test/sql/bootstrap.sql
for migration in supabase/migrations/*.sql; do
  if [[ "$migration" == *porter_global_knowledge_expand.sql ]]; then psql -v ON_ERROR_STOP=1 -f test/sql/global-knowledge-before.sql; fi
  if [[ "$migration" == *porter_global_knowledge_contract.sql ]]; then psql -v ON_ERROR_STOP=1 -f test/sql/global-knowledge-between.sql; fi
  psql -v ON_ERROR_STOP=1 -f "$migration"
done
psql -v ON_ERROR_STOP=1 -f test/sql/global-knowledge.sql
psql -v ON_ERROR_STOP=1 -f test/sql/trip-deletion.sql
psql -v ON_ERROR_STOP=1 -f test/sql/artifact-delivery.sql

#!/usr/bin/env bash
# Applies the migration + seed to a throwaway database (with a stubbed auth schema) and runs tests/test.sql.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=almaali_test
P="psql -v ON_ERROR_STOP=1 -q ${PGHOST:+-h $PGHOST}"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB"
$P -d $DB -f tests/auth_stub.sql
$P -d $DB -f supabase/migrations/*_almaali_schema.sql
$P -d $DB -f supabase/seed.sql
$P -d $DB -f tests/test.sql
$P -d $DB -f supabase/seed_dev_users.sql   # also check the dev-user seed runs
$P -d $DB -c "select email, role from profiles where email like '%@maali.com' order by 1" -t

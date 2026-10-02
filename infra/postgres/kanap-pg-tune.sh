#!/bin/sh
# KANAP: PostgreSQL settings sized from the host's memory (plan planning/perf-scale lot 4C).
#
# Prints a configuration file to include in the server's configuration. Nothing is applied:
#
#   sh infra/postgres/kanap-pg-tune.sh                 # Postgres shares the host with KANAP
#   sh infra/postgres/kanap-pg-tune.sh --dedicated     # Postgres has the host to itself
#   sh infra/postgres/kanap-pg-tune.sh --ram-mb 8192   # size for another machine
#   --preload "<value>"   the server's current SHOW shared_preload_libraries (may be empty):
#                         the generated line keeps those libraries and adds pg_stat_statements
#
# Run it on the PostgreSQL server: it looks for the pg_stat_statements library there.
# Debian / Ubuntu (include_dir 'conf.d' is in the default postgresql.conf):
#   CURRENT=$(sudo -u postgres psql -XAtc 'SHOW shared_preload_libraries')
#   sh infra/postgres/kanap-pg-tune.sh --preload "$CURRENT" | sudo tee /etc/postgresql/16/main/conf.d/kanap.conf
#   sudo systemctl restart postgresql        # shared_buffers and shared_preload_libraries need it
#   sudo -u postgres psql -d kanap -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements'
# Other systems: add `include_dir = 'conf.d'` (or `include 'kanap.conf'`) to postgresql.conf.
#
# shared_preload_libraries is one list: a value in an included file replaces the one in
# postgresql.conf. Without --preload the line is written commented out, and PostgreSQL does not
# start when a preloaded library is missing (RHEL and derivatives ship it in the contrib package,
# postgresqlNN-contrib): the line is written commented out when the library is not found here.
#
# The rule (RAM = the host's memory; "shared" when the KANAP containers run on the same host):
#   shared_buffers         25 % of RAM dedicated, 15 % shared (10 % shared under 6 GB, where image
#                          builds on the same host need the room); at most 8 GB
#   effective_cache_size   75 % of RAM dedicated, 50 % shared (a planner hint, allocates nothing)
#   work_mem               8 MB under 6 GB of RAM, 16 MB up to 24 GB, 32 MB above
#                          (per sort or hash, per connection: a few at once per query)
#   maintenance_work_mem   5 % of RAM, between 64 MB and 1 GB (vacuum, index builds)
#   max_connections        100 unless already higher: the API's connections (DB_POOL_MAX per
#                          API process) + 15 must fit
set -eu

DEDICATED=0
RAM_MB=""
PRELOAD_SET=0
PRELOAD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dedicated) DEDICATED=1 ;;
    --ram-mb) shift; RAM_MB="$1" ;;
    --preload) shift; PRELOAD_SET=1; PRELOAD="${1:-}" ;;
    -h|--help) sed -n '2,/^set -eu/p' "$0" | sed '$d'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -z "$RAM_MB" ]; then
  RAM_MB=$(awk '/^MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo)
fi

if [ "$DEDICATED" -eq 1 ]; then
  SB=$((RAM_MB * 25 / 100)); ECS=$((RAM_MB * 75 / 100)); MODE="dedicated to PostgreSQL"
else
  SB=$((RAM_MB * 15 / 100)); ECS=$((RAM_MB * 50 / 100)); MODE="shared with the KANAP containers"
  [ "$RAM_MB" -lt 6144 ] && SB=$((RAM_MB * 10 / 100))
fi
[ "$SB" -gt 8192 ] && SB=8192
[ "$SB" -lt 128 ] && SB=128
if [ "$RAM_MB" -lt 6144 ]; then WM=8; elif [ "$RAM_MB" -le 24576 ]; then WM=16; else WM=32; fi
MWM=$((RAM_MB * 5 / 100)); [ "$MWM" -lt 64 ] && MWM=64; [ "$MWM" -gt 1024 ] && MWM=1024

# The pg_stat_statements library on this host: pg_config first, then the usual package paths.
LIB=""
if command -v pg_config >/dev/null 2>&1; then
  LIBDIR=$(pg_config --pkglibdir 2>/dev/null || true)
  if [ -n "$LIBDIR" ] && [ -f "$LIBDIR/pg_stat_statements.so" ]; then LIB="$LIBDIR/pg_stat_statements.so"; fi
fi
if [ -z "$LIB" ]; then
  for f in /usr/lib/postgresql/*/lib/pg_stat_statements.so /usr/pgsql-*/lib/pg_stat_statements.so \
           /usr/lib64/pgsql/pg_stat_statements.so /usr/local/lib/postgresql/pg_stat_statements.so; do
    if [ -f "$f" ]; then LIB="$f"; break; fi
  done
fi

# The preload list: the server's current libraries, plus pg_stat_statements.
LIST=$(printf '%s' "$PRELOAD" | tr -d " '\"")
case ",$LIST," in
  *,pg_stat_statements,*) ;;
  ,,) LIST="pg_stat_statements" ;;
  *) LIST="$LIST,pg_stat_statements" ;;
esac
PRELOAD_LINE="shared_preload_libraries = '$LIST'"
if [ -z "$LIB" ]; then
  PRELOAD_NOTE="# NOT ACTIVE: pg_stat_statements.so was not found on this host (pg_config --pkglibdir, then
# /usr/lib/postgresql/*/lib, /usr/pgsql-*/lib, /usr/lib64/pgsql). Install PostgreSQL's contrib files
# (RHEL: postgresqlNN-contrib), check  ls \"\$(pg_config --pkglibdir)/pg_stat_statements.so\", then remove the #."
  PRELOAD_LINE="#$PRELOAD_LINE"
elif [ "$PRELOAD_SET" -eq 0 ]; then
  PRELOAD_NOTE="# NOT ACTIVE: this line replaces the server's list. Run  SHOW shared_preload_libraries;  and, if it
# is not empty, add those libraries in front (e.g. 'pg_cron,pg_stat_statements'), or run this script
# again with --preload \"<value>\". Then remove the #. Library found: $LIB"
  PRELOAD_LINE="#$PRELOAD_LINE"
else
  PRELOAD_NOTE="# The server's libraries ('$PRELOAD') kept, pg_stat_statements added. Library found: $LIB"
fi

cat <<CONF
# KANAP PostgreSQL settings, generated by infra/postgres/kanap-pg-tune.sh
# Host memory: ${RAM_MB} MB, ${MODE}.
# shared_buffers and shared_preload_libraries take effect after a restart; the others after a reload.

# Memory
shared_buffers = ${SB}MB
effective_cache_size = ${ECS}MB
work_mem = ${WM}MB
maintenance_work_mem = ${MWM}MB

# Storage: SSD (use 4.0 on spinning disks)
random_page_cost = 1.1
effective_io_concurrency = 200

# Statement statistics: needs a restart, then once in the KANAP database, as a superuser:
#   CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
${PRELOAD_NOTE}
${PRELOAD_LINE}
pg_stat_statements.max = 5000
pg_stat_statements.track = top
track_io_timing = on

# Slow statements and lock waits in the server log. A statement is logged with its parameters,
# which can hold personal data (names, e-mails, comments): 0 logs the statement without them
# (PostgreSQL 13 and later; -1 logs them in full).
log_min_duration_statement = 500ms
log_parameter_max_length = 0
log_lock_waits = on

# Autovacuum: server defaults kept. The KANAP migrations make it start earlier on the
# monthly amounts tables (ALTER TABLE spend_amounts / capex_amounts SET (...)).

# Connections: keep max_connections at 100 or more, and above the API's connections
# (DB_POOL_MAX per API process) + 15.
CONF

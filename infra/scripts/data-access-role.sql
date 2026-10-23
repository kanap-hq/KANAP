-- Data-scoped access: the limited PostgreSQL role (planning/data-scoped-access/spec.md §6.2, §9.2).
--
-- Creates the role kanap_data_limited (NOLOGIN) and lets the application role take it without
-- inheriting it. This is the only step of the feature that needs a superuser or a CREATEROLE role:
-- the grants and policies of the role are set by the application itself in each database, at its
-- migrations and at its start. Restart the API afterwards, while it is quiet.
--
--   psql -v ON_ERROR_STOP=1 -v app_role=<application role> -v mode=install \
--        -f infra/scripts/data-access-role.sql -d <database>
--
-- mode=install (the default) or mode=uninstall. Idempotent: a second run leaves the same state.
-- It may run before or after the migrations.
--
-- PostgreSQL 16 and later (QA, prod, CI): run it once, on any database.
--   GRANT kanap_data_limited TO <app> WITH INHERIT FALSE, SET TRUE.
--
-- PostgreSQL 15 (dev): inheritance is a property of the role, for the whole server, so the
-- script makes the application role NOINHERIT. On PostgreSQL 15 the schema public of a database
-- belongs to pg_database_owner, and the application role creates there only through that implicit
-- membership, which NOINHERIT cuts. So the script first grants USAGE, CREATE on public directly to
-- the application role in the database it runs on. That grant is per database: run the script on
-- each database the application role owns (dev: appdb, appdb_ci, the lane copies, ...) and on
-- template1, so that a database created later (CREATE DATABASE x OWNER app) inherits the grant. A
-- copy made from a template keeps it.
--   The script refuses NOINHERIT while one of those databases lacks the direct grant, and prints
-- the command to run for each. It reads that from pg_shdepend, a shared catalog: a privilege the
-- application role holds on the schema public (fixed oid 2200) of another database. It cannot see
-- which privileges from there (only that the role is in the ACL); in the database it runs on it
-- checks USAGE and CREATE exactly. Databases the application role does not own are not affected:
-- there it never created through pg_database_owner.
--   Loop, as the server's superuser (dev):
--     for db in template1 $(psql -At -d postgres -c "SELECT datname FROM pg_database
--         WHERE datdba = 'app'::regrole ORDER BY 1"); do
--       psql -v ON_ERROR_STOP=1 -v app_role=app -v mode=install -f infra/scripts/data-access-role.sql -d "$db"
--     done
--   Every run but the last stops on the databases still missing; the last applies NOINHERIT.
--   The script also stops if the application role inherits from any other role: NOINHERIT
--   would cut those rights too.
--
-- Uninstall (mode=uninstall): DROP OWNED BY kanap_data_limited in the current database (its grants,
-- default privileges and data-access policies there), then, when no other database still holds
-- something for the role (pg_shdepend), DROP ROLE and, on PostgreSQL 15, ALTER ROLE <app> INHERIT.
-- The direct grant on public stays. Otherwise it lists the databases left: run it on each.
--   for db in $(psql -At -d postgres -c "SELECT datname FROM pg_database WHERE datallowconn ORDER BY 1"); do
--     psql -v ON_ERROR_STOP=1 -v app_role=app -v mode=uninstall -f infra/scripts/data-access-role.sql -d "$db"
--   done
--
-- On PostgreSQL 16 a CREATEROLE role that is not a member of the application role can run the
-- install (it receives the admin option on the role it creates). On PostgreSQL 15 the grant on
-- public needs a superuser or the database owner.

\set ON_ERROR_STOP on
\set QUIET on
SET lock_timeout = '5s';
SET client_min_messages = notice;

\if :{?app_role}
\else
  \echo 'data-access-role: pass the application role, for example -v app_role=app'
  SELECT 1 / 0 AS missing_app_role;
\endif
\if :{?mode}
\else
  \set mode install
\endif

SELECT set_config('kanap.da_app_role', :'app_role', false) AS da_app_role_set,
       set_config('kanap.da_mode', :'mode', false) AS da_mode_set
\gset

DO $check$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
  v_mode text := current_setting('kanap.da_mode');
BEGIN
  IF v_mode NOT IN ('install', 'uninstall') THEN
    RAISE EXCEPTION 'data-access-role: mode must be install or uninstall, not "%"', v_mode;
  END IF;
  IF to_regrole(v_app) IS NULL THEN
    RAISE EXCEPTION 'data-access-role: the application role "%" does not exist', v_app;
  END IF;
  IF v_app = 'kanap_data_limited' THEN
    RAISE EXCEPTION 'data-access-role: app_role is the application role (the one of DATABASE_URL), not the limited role';
  END IF;
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = v_app) THEN
    RAISE WARNING 'data-access-role: "%" is a superuser; KANAP removes that at its first migration, and a superuser cannot use limited access', v_app;
  END IF;
END
$check$;

SELECT current_setting('server_version_num')::int < 160000 AS is_pg15,
       :'mode' = 'install' AS is_install
\gset

\if :is_install

-- 1. The role.
DO $role$
DECLARE
  r pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'kanap_data_limited';
  IF NOT FOUND THEN
    CREATE ROLE kanap_data_limited NOLOGIN;
    RAISE NOTICE 'data-access-role: role kanap_data_limited created';
  ELSIF r.rolsuper OR r.rolbypassrls OR r.rolcanlogin THEN
    RAISE EXCEPTION 'data-access-role: kanap_data_limited exists with LOGIN, SUPERUSER or BYPASSRLS; fix it by hand (ALTER ROLE kanap_data_limited NOLOGIN NOSUPERUSER NOBYPASSRLS)';
  END IF;
END
$role$;

\if :is_pg15

-- 2. PostgreSQL 15: the direct grant on public here (its own statement, so it stays when the
-- next one stops), then NOINHERIT once every database the application role owns, and template1,
-- has it; then the membership.
DO $pg15_others$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
  v_others text;
BEGIN
  SELECT string_agg(g.rolname, ', ' ORDER BY g.rolname) INTO v_others
  FROM pg_auth_members m
  JOIN pg_roles g ON g.oid = m.roleid
  WHERE m.member = to_regrole(v_app) AND m.roleid <> to_regrole('kanap_data_limited');
  IF v_others IS NOT NULL THEN
    RAISE EXCEPTION 'data-access-role: "%" inherits from % ; NOINHERIT would cut those rights. Grant what they give directly to "%" and revoke the memberships, then rerun.',
      v_app, v_others, v_app;
  END IF;
END
$pg15_others$;

DO $pg15_grant$
BEGIN
  EXECUTE format('GRANT USAGE, CREATE ON SCHEMA public TO %I', current_setting('kanap.da_app_role'));
END
$pg15_grant$;

DO $pg15$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
  v_app_oid oid := to_regrole(current_setting('kanap.da_app_role'));
  v_limited oid := to_regrole('kanap_data_limited');
  v_missing text;
BEGIN
  SELECT string_agg(
           format('psql -v ON_ERROR_STOP=1 -v app_role=%s -v mode=install -f infra/scripts/data-access-role.sql -d %s',
                  v_app, d.datname),
           E'\n' ORDER BY d.datname)
    INTO v_missing
  FROM pg_database d
  WHERE (d.datdba = v_app_oid OR d.datname = 'template1')
    AND d.datallowconn
    AND CASE
      WHEN d.datname = current_database() THEN NOT (
        EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                WHERE n.nspname = 'public' AND a.grantee = v_app_oid AND a.privilege_type = 'CREATE')
        AND EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                    WHERE n.nspname = 'public' AND a.grantee = v_app_oid AND a.privilege_type = 'USAGE'))
      ELSE NOT EXISTS (
        SELECT 1 FROM pg_shdepend s
        WHERE s.dbid = d.oid
          AND s.classid = 'pg_namespace'::regclass
          AND s.objid = 2200
          AND s.refclassid = 'pg_authid'::regclass
          AND s.refobjid = v_app_oid
          AND s.deptype = 'a')
    END;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION E'data-access-role: granted here; NOINHERIT is not applied while these databases lack the direct grant on public. Run:\n%', v_missing;
  END IF;

  IF (SELECT rolinherit FROM pg_roles WHERE oid = v_app_oid) THEN
    EXECUTE format('ALTER ROLE %I NOINHERIT', v_app);
    RAISE NOTICE 'data-access-role: "%" is now NOINHERIT', v_app;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid = v_limited AND member = v_app_oid) THEN
    EXECUTE format('GRANT kanap_data_limited TO %I', v_app);
    RAISE NOTICE 'data-access-role: "%" is now a member of kanap_data_limited', v_app;
  END IF;
END
$pg15$;

\else

-- 2. PostgreSQL 16 and later: a membership that can be taken and is not inherited.
DO $pg16$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
BEGIN
  EXECUTE format('GRANT kanap_data_limited TO %I WITH INHERIT FALSE, SET TRUE', v_app);
END
$pg16$;

\endif

-- 3. Final state; the script fails when it is not the expected one.
DO $verify$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
BEGIN
  IF pg_has_role(v_app, 'kanap_data_limited', 'USAGE') THEN
    RAISE EXCEPTION 'data-access-role: "%" still inherits kanap_data_limited (another grant of the membership, or a superuser); limited access stays unavailable', v_app;
  END IF;
  IF NOT pg_has_role(v_app, 'kanap_data_limited', 'MEMBER') THEN
    RAISE EXCEPTION 'data-access-role: "%" is not a member of kanap_data_limited', v_app;
  END IF;
  -- PostgreSQL 15 only: there NOINHERIT is what could take CREATE away. On 16 the script changes
  -- nothing about it (and a database the application role does not own may rightly lack it).
  IF current_setting('server_version_num')::int < 160000
     AND NOT has_schema_privilege(v_app, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'data-access-role: "%" can no longer create in the schema public of %', v_app, current_database();
  END IF;
END
$verify$;

\else

-- Uninstall.
DO $uninstall$
DECLARE
  v_app text := current_setting('kanap.da_app_role');
  v_limited oid := to_regrole('kanap_data_limited');
  v_left text;
BEGIN
  IF v_limited IS NULL THEN
    RAISE NOTICE 'data-access-role: role kanap_data_limited absent, nothing to remove';
  ELSE
    DROP OWNED BY kanap_data_limited;
    SELECT string_agg(DISTINCT d.datname, ', ' ORDER BY d.datname) INTO v_left
    FROM pg_shdepend s
    JOIN pg_database d ON d.oid = s.dbid
    WHERE s.refclassid = 'pg_authid'::regclass AND s.refobjid = v_limited;
    IF v_left IS NOT NULL THEN
      RAISE NOTICE 'data-access-role: removed from %; the role still has grants or policies in: % (run this script there: the last run drops the role)',
        current_database(), v_left;
    ELSE
      DROP ROLE kanap_data_limited;
      RAISE NOTICE 'data-access-role: role kanap_data_limited dropped';
    END IF;
  END IF;
  IF to_regrole('kanap_data_limited') IS NULL
     AND current_setting('server_version_num')::int < 160000
     AND NOT (SELECT rolinherit FROM pg_roles WHERE rolname = v_app) THEN
    EXECUTE format('ALTER ROLE %I INHERIT', v_app);
    RAISE NOTICE 'data-access-role: "%" inherits again (the direct grant on public stays)', v_app;
  END IF;
END
$uninstall$;

\endif

\pset footer off
\echo 'data-access-role: final state'
SELECT
  current_setting('server_version') AS server_version,
  current_database() AS database,
  r.rolname AS app_role,
  r.rolinherit AS app_inherits,
  to_regrole('kanap_data_limited') IS NOT NULL AS limited_role_exists,
  m.member IS NOT NULL AS app_is_member,
  to_jsonb(m) ->> 'inherit_option' AS membership_inherit,
  to_jsonb(m) ->> 'set_option' AS membership_set,
  CASE WHEN to_regrole('kanap_data_limited') IS NULL THEN NULL
       ELSE pg_has_role(r.oid, 'kanap_data_limited', 'USAGE') END AS app_inherits_limited,
  has_schema_privilege(r.oid, 'public', 'CREATE') AS app_creates_in_public
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid AND m.roleid = to_regrole('kanap_data_limited')
WHERE r.rolname = :'app_role';

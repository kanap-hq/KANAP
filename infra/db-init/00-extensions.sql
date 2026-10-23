-- PostgreSQL initialization script
-- This runs when the database is first created

-- Create app user with superuser privileges (needed for extensions and migrations)
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app') THEN
        CREATE ROLE app WITH LOGIN PASSWORD 'app' SUPERUSER CREATEDB;
        RAISE NOTICE 'Created app user with superuser privileges';
    ELSE
        -- Make sure app is a superuser
        ALTER ROLE app WITH SUPERUSER;
        RAISE NOTICE 'Updated app user to superuser';
    END IF;
END
$$;

-- Create appdb database owned by app
SELECT 'CREATE DATABASE appdb OWNER app'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'appdb')\gexec

-- Install required PostgreSQL extensions
\c appdb
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Data-scoped access: the limited role, as infra/scripts/data-access-role.sql sets it on an
-- existing server. app is a superuser here; migration 1844600000000 makes it NOSUPERUSER
-- NOBYPASSRLS and leaves its inheritance as set below. On PostgreSQL 15 NOINHERIT cuts the
-- implicit pg_database_owner membership through which app creates in public: app gets a direct
-- grant in appdb and in template1 (databases created later inherit it).
\c template1
GRANT USAGE, CREATE ON SCHEMA public TO app;
\c appdb
GRANT USAGE, CREATE ON SCHEMA public TO app;
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'kanap_data_limited') THEN
        CREATE ROLE kanap_data_limited NOLOGIN;
    END IF;
    IF current_setting('server_version_num')::int < 160000 THEN
        ALTER ROLE app NOINHERIT;
        GRANT kanap_data_limited TO app;
    ELSE
        -- Built at run time: PostgreSQL 15 does not parse WITH INHERIT.
        EXECUTE 'GRANT kanap_data_limited TO app WITH INHERIT FALSE, SET TRUE';
    END IF;
END
$$;

-- One-time production step: RLS is only enforced for NON-superuser roles.
-- Railway's default postgres user is a superuser, which silently bypasses
-- every policy. Run this once against the Railway Postgres (psql or the
-- Railway data tab), pick a strong password, then update DATABASE_URL on the
-- asos and asos-worker services to connect as asos_app.
--   Verify afterwards: SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'asos_app';
CREATE ROLE asos_app LOGIN PASSWORD 'CHANGE_ME' NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO asos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO asos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO asos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO asos_app;

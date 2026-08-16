-- Append-only enforcement for audit_log, in the database.
--
-- "Immutable" and "append-only" were previously properties the application
-- merely refrained from violating: nothing stopped an UPDATE or DELETE, and the
-- seed script routinely cleared the table. A trail that the application can
-- rewrite is not evidence of anything, because the party you would be proving
-- something to has no reason to believe the application behaved.
--
-- Triggers rather than grants: REVOKE does not constrain the table owner, and
-- the application connects as the owner. A BEFORE trigger fires for everyone,
-- owner included.
--
-- Apply with:  psql "$DATABASE_URL" -f server/sql/audit_append_only.sql

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'audit_log is append-only: % is not permitted', TG_OP
    USING HINT = 'Audit entries are evidence. Correct the record by appending a new entry, never by editing history.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- TRUNCATE bypasses row-level triggers entirely, so it needs its own.
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

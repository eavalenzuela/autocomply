-- Append-only enforcement for audit_log.
--
-- Previously applied by hand from server/sql/audit_append_only.sql. That file
-- stays as documentation of *why*, but the migration sequence owns applying it:
-- a guarantee that only holds on databases where somebody remembered to run a
-- script is not a guarantee.
--
-- Triggers rather than grants: REVOKE does not constrain the table owner, and
-- the application connects as the owner. A BEFORE trigger fires for everyone.

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

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

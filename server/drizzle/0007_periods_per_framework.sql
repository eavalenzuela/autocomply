-- Assessment periods were unique-active globally: one open window across the
-- whole product. Real programmes overlap — a SOC 2 observation window runs
-- alongside a CSF or HITRUST assessment — so the rule forced closing a period
-- that was still open in order to start one that had already started.
--
-- Uniqueness is now per framework. Two concurrent windows for the same
-- framework are still meaningless, and a partial unique index enforces that
-- properly: the previous rule was a read-then-write check in the route, which
-- two concurrent requests could both pass.
--
-- No existing row can violate this: under the old rule at most one period was
-- active in total.
CREATE UNIQUE INDEX IF NOT EXISTS "assessment_periods_one_active_per_framework"
  ON "assessment_periods" ("framework") WHERE "status" = 'active';

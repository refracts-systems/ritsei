-- owner: domain_model
-- reviewed: 2026-11-21
-- generated-by: drizzle-kit 1.0.0-rc.4 --custom
-- rationale: recorded domain events are never updated or deleted (ADR-0124). The Effect Cluster host writes an aggregate's events once, under event:<sequence> keys, and never rewrites or deletes them; its state, receipts, outbox, and backfill rows under other keys keep changing and stay writable.

CREATE FUNCTION "domain_model".protect_recorded_events()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE'
    OR starts_with(OLD.key, 'event:')
    OR (TG_OP = 'UPDATE' AND starts_with(NEW.key, 'event:')) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      CONSTRAINT = 'domain_model_recorded_events_immutable',
      MESSAGE = 'recorded domain events cannot be changed or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER alchemy_domain_objects_events_immutable_trigger
BEFORE UPDATE OR DELETE ON "domain_model"."alchemy_domain_objects"
FOR EACH ROW EXECUTE FUNCTION "domain_model".protect_recorded_events();
--> statement-breakpoint
CREATE TRIGGER alchemy_domain_objects_no_truncate_trigger
BEFORE TRUNCATE ON "domain_model"."alchemy_domain_objects"
FOR EACH STATEMENT EXECUTE FUNCTION "domain_model".protect_recorded_events();

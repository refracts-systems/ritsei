-- owner: domain_model
-- reviewed: 2026-11-21
-- generated-by: drizzle-kit 1.0.0-rc.4
-- rationale: the Effect Cluster host's key-value storage, created by migration instead of by the host at runtime (ADR-0124).
-- note: the host's own SQL names the table unqualified and expects COLLATE "C" keys, which Drizzle cannot express, so the collation is added by hand below.

CREATE SCHEMA "domain_model";
--> statement-breakpoint
CREATE TABLE "domain_model"."alchemy_domain_objects" (
	"object" text COLLATE "C" NOT NULL,
	"key" text COLLATE "C" NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "alchemy_domain_objects_pkey" PRIMARY KEY("object","key")
);

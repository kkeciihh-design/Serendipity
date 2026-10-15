-- Old extracts may have omitted access restrictions. Keep their stored facts,
-- but require a full-page evaluation before showing verified opening hours.
ALTER TABLE "EvidenceFact" ADD COLUMN "evaluationVersion" INTEGER NOT NULL DEFAULT 0;

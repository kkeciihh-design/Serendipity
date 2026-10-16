-- AdvisoryState keeps the latest projected reminders, weather records and the
-- user's acknowledgement state for the current trip. It is deliberately separate
-- from immutable PlanVersion snapshots.
CREATE TABLE "AdvisoryState" (
    "tripId" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "planVersion" INTEGER NOT NULL,
    "items" TEXT NOT NULL,
    "weather" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdvisoryState_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Add per-instance weather service status. The default provider needs no key.
ALTER TABLE "AppSettings" ADD COLUMN "weatherProvider" TEXT DEFAULT 'open-meteo';
ALTER TABLE "AppSettings" ADD COLUMN "weatherStatus" TEXT DEFAULT 'not_tested';
ALTER TABLE "AppSettings" ADD COLUMN "weatherCheckedAt" DATETIME;
ALTER TABLE "AppSettings" ADD COLUMN "weatherError" TEXT;


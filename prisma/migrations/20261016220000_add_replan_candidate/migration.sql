CREATE TABLE "ReplanCandidate" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tripId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'preview',
  "payload" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ReplanCandidate_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ReplanCandidate_tripId_createdAt_idx" ON "ReplanCandidate"("tripId", "createdAt");

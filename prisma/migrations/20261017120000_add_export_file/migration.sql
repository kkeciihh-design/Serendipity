CREATE TABLE "ExportFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'mobile-html',
    "planVersion" INTEGER NOT NULL,
    "requestRevision" INTEGER NOT NULL,
    "checklistRevision" INTEGER NOT NULL,
    "executionRevision" INTEGER NOT NULL,
    "requirementUpToDate" BOOLEAN NOT NULL,
    "generatedAt" DATETIME NOT NULL,
    "options" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    CONSTRAINT "ExportFile_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ExportFile_tripId_generatedAt_idx" ON "ExportFile"("tripId", "generatedAt");

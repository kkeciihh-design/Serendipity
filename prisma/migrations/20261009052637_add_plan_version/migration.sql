-- CreateTable
CREATE TABLE "PlanVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "requestRevision" INTEGER NOT NULL,
    "requestSnapshot" TEXT NOT NULL,
    "events" TEXT NOT NULL,
    "pendingItems" TEXT NOT NULL,
    "validationResults" TEXT NOT NULL,
    "requirementUpToDate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanVersion_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Trip" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "originalRequest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currentPlanVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_currentPlanVersionId_fkey" FOREIGN KEY ("currentPlanVersionId") REFERENCES "PlanVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Trip" ("createdAt", "id", "originalRequest", "status", "title", "updatedAt") SELECT "createdAt", "id", "originalRequest", "status", "title", "updatedAt" FROM "Trip";
DROP TABLE "Trip";
ALTER TABLE "new_Trip" RENAME TO "Trip";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlanVersion_tripId_versionNumber_key" ON "PlanVersion"("tripId", "versionNumber");

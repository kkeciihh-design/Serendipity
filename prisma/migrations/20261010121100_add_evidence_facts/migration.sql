-- 阶段10：字段级信息来源证据。
CREATE TABLE "EvidenceFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "planVersionId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourcePublisher" TEXT NOT NULL,
    "sourcePublishedAt" DATETIME,
    "sourceDateStatus" TEXT,
    "extractedValue" TEXT NOT NULL,
    "searchProvider" TEXT NOT NULL,
    "searchQuery" TEXT NOT NULL,
    "retrievedAt" DATETIME NOT NULL,
    "applicableFrom" DATETIME,
    "applicableUntil" DATETIME,
    "lastRefreshAt" DATETIME,
    "lastRefreshStatus" TEXT,
    "lastRefreshError" TEXT,
    "contentQuote" TEXT NOT NULL,
    "conflictReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceFact_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EvidenceFact_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "PlanVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EvidenceFact_planVersionId_targetType_targetId_field_key" ON "EvidenceFact"("planVersionId", "targetType", "targetId", "field");
CREATE INDEX "EvidenceFact_tripId_planVersionId_idx" ON "EvidenceFact"("tripId", "planVersionId");

ALTER TABLE "AppSettings" ADD COLUMN "searchProvider" TEXT DEFAULT 'duckduckgo';
ALTER TABLE "AppSettings" ADD COLUMN "searchLanguage" TEXT DEFAULT 'en';
ALTER TABLE "AppSettings" ADD COLUMN "searchStatus" TEXT DEFAULT 'not_tested';
ALTER TABLE "AppSettings" ADD COLUMN "searchCheckedAt" DATETIME;
ALTER TABLE "AppSettings" ADD COLUMN "searchError" TEXT;

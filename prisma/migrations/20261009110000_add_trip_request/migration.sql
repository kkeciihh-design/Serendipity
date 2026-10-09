-- AddTripRequest
CREATE TABLE "TripRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "originalRequest" TEXT NOT NULL,
    "requestRevision" INTEGER NOT NULL DEFAULT 1,
    "extractedRequest" TEXT,
    "fieldSources" TEXT,
    "defaultAssumptions" TEXT,
    "pendingQuestions" TEXT,
    "confirmedRequest" TEXT,
    "confirmedRevision" INTEGER,
    "confirmedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TripRequest_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "TripRequest_tripId_key" ON "TripRequest"("tripId");

-- Existing drafts become revision 1 and are explicitly unconfirmed.
INSERT INTO "TripRequest" (
    "id",
    "tripId",
    "originalRequest",
    "requestRevision",
    "confirmedRevision",
    "confirmedAt",
    "createdAt",
    "updatedAt"
)
SELECT
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    "id",
    "originalRequest",
    1,
    NULL,
    NULL,
    "createdAt",
    "updatedAt"
FROM "Trip";

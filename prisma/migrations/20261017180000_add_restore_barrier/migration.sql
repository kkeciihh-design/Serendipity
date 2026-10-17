CREATE TABLE "InstanceState" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
  "dataGeneration" TEXT NOT NULL,
  "activeRestoreId" TEXT
);
INSERT INTO "InstanceState" ("id", "dataGeneration") VALUES ('singleton', lower(hex(randomblob(16))));
CREATE TABLE "RestoreOperation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "phase" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "ownerPid" INTEGER,
  "baselineHash" TEXT NOT NULL,
  "safetyPath" TEXT,
  "safetyHash" TEXT,
  "message" TEXT NOT NULL,
  "startedAt" TEXT NOT NULL,
  "finishedAt" TEXT
);

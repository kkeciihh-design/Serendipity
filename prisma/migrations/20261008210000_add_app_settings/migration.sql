-- DropIndex
DROP INDEX "Trip_id_key";

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "passwordHash" TEXT,
    "passwordSalt" TEXT,
    "provider" TEXT,
    "baseUrl" TEXT,
    "model" TEXT,
    "apiKeyCiphertext" TEXT,
    "apiKeyLast4" TEXT,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "basePrompt" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "connectionStatus" TEXT NOT NULL DEFAULT 'not_configured',
    "connectionCheckedAt" DATETIME,
    "connectionProvider" TEXT,
    "connectionModel" TEXT,
    "connectionError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

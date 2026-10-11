ALTER TABLE "PlanVersion" ADD COLUMN "places" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "AppSettings" ADD COLUMN "mapConfigurationCiphertext" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "mapCheckedAt" DATETIME;
ALTER TABLE "AppSettings" ADD COLUMN "mapCapabilities" TEXT;
ALTER TABLE "AppSettings" ADD COLUMN "mapProvider" TEXT NOT NULL DEFAULT 'osm';

import type { PrismaClient } from "@prisma/client";
export function openVerifiedIsolatedDatabase(base: string, dataDirectory: string): Promise<PrismaClient>;

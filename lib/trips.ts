import { businessOperation, businessTransaction } from "./business-guard";
import { Prisma, PrismaClient } from "@prisma/client";
import { z, type ZodType } from "zod";
import { getDatabaseUrl } from "./data-directory";
import { markCurrentPlanStale } from "./plan-service";
import { deriveTripTitle } from "./trip-title";

const MAX_REQUEST_LENGTH = 3000;
const MAX_TITLE_LENGTH = 80;

const countCodePoints = (text: string) => Array.from(text).length;

const requestText = z
  .string()
  .refine((text) => text.trim().length > 0, {
    message: "旅行想法不能为空。",
  })
  .refine((text) => countCodePoints(text) <= MAX_REQUEST_LENGTH, {
    message: `旅行想法最长 ${MAX_REQUEST_LENGTH} 字。`,
  });

const titleText = z
  .string()
  .transform((text) => text.trim())
  .refine((text) => text.length > 0, {
    message: "旅行标题不能为空。",
  })
  .refine((text) => countCodePoints(text) <= MAX_TITLE_LENGTH, {
    message: `旅行标题最长 ${MAX_TITLE_LENGTH} 字。`,
  });

export const createTripSchema = z.object({
  originalRequest: requestText,
});

export const updateTripSchema = z
  .object({
    title: titleText.optional(),
    originalRequest: requestText.optional(),
    expectedRequestRevision: z.number().int().min(1).optional(),
  })
  .refine((input) => input.title !== undefined || input.originalRequest !== undefined, {
    message: "请提供要修改的标题或旅行想法。",
  })
  .refine((input) => !input.originalRequest || input.expectedRequestRevision, {
    message: "修改旅行想法前，请提供当前需求修订号。",
  });

export type Trip = Prisma.TripGetPayload<{ include: { request: true } }>;
export type TripListEntry = Trip & {
  currentPlanVersion: {
    requestSnapshot: string;
    versionNumber: number;
    requestRevision: number;
    requirementUpToDate: boolean;
    /** Raw plan events, used only for the collection card stop preview. */
    events: string;
  } | null;
};

type PrismaStore = {
  trip: {
    findMany: PrismaClient["trip"]["findMany"];
    findUnique: PrismaClient["trip"]["findUnique"];
    create: PrismaClient["trip"]["create"];
    update: PrismaClient["trip"]["update"];
    delete: PrismaClient["trip"]["delete"];
  };
  tripRequest: PrismaClient["tripRequest"];
};

export class TripRevisionConflictError extends Error {
  constructor(message = "旅行想法已被其他页面修改，请刷新后查看最新修订。") {
    super(message);
    this.name = "TripRevisionConflictError";
  }
}

type PrismaGlobal = typeof globalThis & {
  serendipityPrisma?: PrismaClient;
};

const prismaGlobal = globalThis as PrismaGlobal;
const prisma =
  prismaGlobal.serendipityPrisma ??
  new PrismaClient({
    datasources: {
      db: {
        url: getDatabaseUrl(),
      },
    },
  });

if (process.env.NODE_ENV !== "production") {
  prismaGlobal.serendipityPrisma = prisma;
}

const store: PrismaStore = prisma;

export class TripNotFoundError extends Error {
  constructor() {
    super("没有找到这趟旅行。");
    this.name = "TripNotFoundError";
  }
}

export class TripValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TripValidationError";
  }
}

function parseOrThrow<T>(
  schema: ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new TripValidationError(
      result.error.issues[0]?.message ?? "输入不合法。",
    );
  }
  return result.data;
}

export const listTrips = businessOperation(async function listTrips(): Promise<TripListEntry[]> {
  return store.trip.findMany({
    include: {
      request: true,
      currentPlanVersion: {
        // `events` feeds the three stop preview tags on each collection card.
        select: { requestSnapshot: true, versionNumber: true, requestRevision: true, requirementUpToDate: true, events: true },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
  });
});

export const getTrip = businessOperation(async function getTrip(id: string): Promise<Trip | null> {
  return store.trip.findUnique({
    include: { request: true },
    where: { id },
  });
});

export const createTrip = businessOperation(async function createTrip(input: unknown): Promise<Trip> {
  const { originalRequest } = parseOrThrow(createTripSchema, input);

  return businessTransaction(prisma, (tx) => tx.trip.create({
    include: { request: true },
    data: {
      title: deriveTripTitle(originalRequest),
      originalRequest,
      status: "draft",
      request: {
        create: {
          originalRequest,
          requestRevision: 1,
        },
      },
    },
  }));
});

export const updateTrip = businessOperation(async function updateTrip(id: string, input: unknown): Promise<Trip> {
  const parsed = parseOrThrow(updateTripSchema, input);
  try {
    return await businessTransaction(prisma, async (transaction) => {
      const existing = await transaction.trip.findUnique({
        include: { request: true },
        where: { id },
      });
      if (!existing) throw new TripNotFoundError();
      // Even a same-value submission belongs to the revision the user saw.
      // Read, compare and write both copies under the same transaction.
      if (parsed.originalRequest !== undefined &&
        (!existing.request || existing.request.requestRevision !== parsed.expectedRequestRevision)) {
        throw new TripRevisionConflictError();
      }
      const originalRequestChanged = parsed.originalRequest !== undefined &&
        parsed.originalRequest !== existing.request?.originalRequest;
      const data = {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(originalRequestChanged ? { originalRequest: parsed.originalRequest } : {}),
      };
      if (originalRequestChanged) {
        const revisionUpdate = await transaction.tripRequest.updateMany({
          where: {
            tripId: id,
            requestRevision: parsed.expectedRequestRevision,
          },
          data: {
            originalRequest: parsed.originalRequest,
            extractedRequest: null,
            fieldSources: null,
            defaultAssumptions: null,
            pendingQuestions: null,
            requestRevision: { increment: 1 },
            confirmedRequest: null,
            confirmedRevision: null,
            confirmedAt: null,
          },
        });
        if (revisionUpdate.count === 0) {
          throw new TripRevisionConflictError();
        }

      }

      if (originalRequestChanged) {
        await markCurrentPlanStale(transaction, id);
      }

      return transaction.trip.update({
        include: { request: true },
        where: { id },
        data,
      });
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new TripNotFoundError();
    }
    throw error;
  }
});

export const deleteTrip = businessOperation(async function deleteTrip(id: string): Promise<Trip> {
  try {
    return await businessTransaction(prisma, (tx) => tx.trip.delete({
      include: { request: true },
      where: { id },
    }));
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new TripNotFoundError();
    }
    throw error;
  }
});

type CleanupTripRow = Prisma.TripGetPayload<{
  include: {
    request: true;
    currentPlanVersion: { select: { id: true } };
    planVersions: { select: { id: true } };
  };
}>;

const normalizeCleanupIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

export const cleanupDuplicateTrips = businessOperation(async function cleanupDuplicateTrips() {
  return businessTransaction(prisma, async (tx) => {
    const trips = await tx.trip.findMany({
      include: {
        request: true,
        currentPlanVersion: { select: { id: true } },
        planVersions: { select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    const parent = new Map<string, string>();
    const find = (id: string): string => {
      const root = parent.get(id) ?? id;
      if (root !== id) {
        const compressed = find(root);
        parent.set(id, compressed);
        return compressed;
      }
      return id;
    };
    const union = (left: string, right: string) => {
      const leftRoot = find(left), rightRoot = find(right);
      if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
    };

    const identities = new Map<string, string>();
    for (const trip of trips) {
      parent.set(trip.id, trip.id);
      const keys = [
        `title:${normalizeCleanupIdentity(trip.title)}`,
        `request:${normalizeCleanupIdentity(trip.request?.originalRequest ?? trip.originalRequest)}`,
      ];
      for (const key of keys) {
        const existing = identities.get(key);
        if (existing) union(existing, trip.id);
        else identities.set(key, trip.id);
      }
    }

    const groups = new Map<string, CleanupTripRow[]>();
    for (const trip of trips) {
      const root = find(trip.id);
      groups.set(root, [...groups.get(root) ?? [], trip]);
    }

    const deleteIds = new Set<string>();
    const keptTripIds: string[] = [];
    for (const trip of trips) {
      if (!trip.currentPlanVersion) deleteIds.add(trip.id);
    }
    for (const group of groups.values()) {
      if (group.length < 2) {
        const only = group[0];
        if (only?.currentPlanVersion) keptTripIds.push(only.id);
        continue;
      }
      const generated = group
        .filter((trip) => trip.currentPlanVersion)
        .sort((left, right) =>
          right.updatedAt.getTime() - left.updatedAt.getTime() ||
          right.planVersions.length - left.planVersions.length
        );
      const keeper = generated[0];
      if (!keeper) continue;
      keptTripIds.push(keeper.id);
      for (const trip of group) {
        if (trip.id !== keeper.id) deleteIds.add(trip.id);
      }
    }

    if (!deleteIds.size) {
      return { deletedCount: 0, deletedTripIds: [] as string[], keptTripIds };
    }
    const deleted = await tx.trip.deleteMany({ where: { id: { in: [...deleteIds] } } });
    return {
      deletedCount: deleted.count,
      deletedTripIds: [...deleteIds],
      keptTripIds: keptTripIds.filter((id) => !deleteIds.has(id)),
    };
  });
});

export async function closeTripStore() {
  await prisma.$disconnect();
}

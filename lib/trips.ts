import { Prisma, PrismaClient } from "@prisma/client";
import { z, type ZodType } from "zod";
import { getDatabaseUrl } from "./data-directory";
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
  })
  .refine(
    (input) => input.title !== undefined || input.originalRequest !== undefined,
    { message: "请提供要修改的标题或旅行想法。" },
  );

export type Trip = {
  id: string;
  title: string;
  originalRequest: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

type PrismaStore = {
  trip: {
    findMany: PrismaClient["trip"]["findMany"];
    findUnique: PrismaClient["trip"]["findUnique"];
    create: PrismaClient["trip"]["create"];
    update: PrismaClient["trip"]["update"];
    delete: PrismaClient["trip"]["delete"];
  };
};

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

export async function listTrips(): Promise<Trip[]> {
  return store.trip.findMany({
    orderBy: {
      updatedAt: "desc",
    },
  });
}

export async function getTrip(id: string): Promise<Trip | null> {
  return store.trip.findUnique({
    where: { id },
  });
}

export async function createTrip(input: unknown): Promise<Trip> {
  const { originalRequest } = parseOrThrow(createTripSchema, input);

  return store.trip.create({
    data: {
      title: deriveTripTitle(originalRequest),
      originalRequest,
      status: "draft",
    },
  });
}

export async function updateTrip(id: string, input: unknown): Promise<Trip> {
  const parsed = parseOrThrow(updateTripSchema, input);
  const data: { title?: string; originalRequest?: string } = {};

  if (parsed.title !== undefined) {
    data.title = parsed.title;
  }
  if (parsed.originalRequest !== undefined) {
    data.originalRequest = parsed.originalRequest;
  }

  try {
    return await store.trip.update({
      where: { id },
      data,
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
}

export async function deleteTrip(id: string): Promise<Trip> {
  try {
    return await store.trip.delete({
      where: { id },
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
}

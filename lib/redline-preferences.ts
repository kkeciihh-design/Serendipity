import { z } from "zod";

const seconds = z.number().int().min(0).max(14_400);
export const redlinePreferencesSchema = z.object({
  baggage: z.enum(["unknown", "none", "checked"]),
  firstVisit: z.boolean(),
  slowWalking: z.boolean(),
  securitySeconds: seconds,
  gateWalkingSeconds: seconds,
  checkInSeconds: seconds,
  bagDropSeconds: seconds,
  extraBufferSeconds: seconds.multipleOf(60),
  minimumArrivalSeconds: seconds.nullable(),
});
export type RedlinePreferences = z.infer<typeof redlinePreferencesSchema>;

export function defaultRedlinePreferences(bufferMinutes: number): RedlinePreferences {
  return { baggage: "unknown", firstVisit: false, slowWalking: false, securitySeconds: 1200,
    gateWalkingSeconds: 600, checkInSeconds: 900, bagDropSeconds: 900,
    extraBufferSeconds: bufferMinutes * 60, minimumArrivalSeconds: null };
}

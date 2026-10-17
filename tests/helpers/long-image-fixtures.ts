import { exportFixture } from "./export-fixtures";
import assets from "../../lib/attraction-assets.json";
import { placeSchema } from "../../lib/places";
export async function longImageFixture(days = 2) {
  const snapshot = await exportFixture(days);
  for (let i = 1; i <= days; i++) {
    const location = assets.locations[(i - 1) % assets.locations.length];
    const place = placeSchema.parse({ ...location.candidate, id: `public-${i}`, precision: "poi", confirmation: "user_confirmed", confirmedAt: snapshot.generatedAt, source: "OpenStreetMap / Nominatim" });
    snapshot.plan.places.push(place);
    const event = snapshot.plan.events.find((e) => e.id === `d${i}-activity`)!;
    event.placeId = place.id; event.locationName = assets.images.find((a) => a.entryId === location.entryId)!.entityName;
    event.attractionSelection = { catalogId: location.entryId, action: "keep", selectedAt: snapshot.generatedAt };
    event.note = "合成行程，时间和预算供演练；地点与许可照片使用本地已核验目录，预约和开放请到官方渠道核对。";
  }
  return snapshot;
}
